import { prisma } from "@uptick/db";
import { nodeResolver } from "./adapters/resolver.js";
import { nodeDnsLookup, nodeInspectCertificate, nodeTcpConnect } from "./adapters/socket.js";
import { nodeTransport } from "./adapters/transport.js";
import { loadConfig } from "./config.js";
import { dispatchProbe } from "./watch/dispatch.js";
import {
  ensureCheckPartition,
  leaseDueMonitors,
  recordChecks,
  resolveRegionId,
} from "./watch/lease.js";
import { startWatch, type WatchPorts } from "./watch/scheduler.js";

function log(event: string, fields: Record<string, unknown> = {}): void {
  // Structured single-line JSON so Railway's log search is usable.
  console.warn(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const regionId = await resolveRegionId(prisma, config.region);

  log("worker.start", {
    region: config.region,
    tickMs: config.tickMs,
    concurrency: config.concurrency,
    batchSize: config.batchSize,
  });

  const probeDeps = {
    transport: nodeTransport,
    resolve: nodeResolver,
    connect: nodeTcpConnect,
    inspect: nodeInspectCertificate,
    lookup: nodeDnsLookup,
    now: () => performance.now(),
    clock: () => new Date(),
  };

  const ports: WatchPorts = {
    leaseDueMonitors: (limit, now) => leaseDueMonitors(prisma, limit, now),
    runProbe: (monitor) => dispatchProbe(monitor, probeDeps),
    recordChecks: (records) => recordChecks(prisma, regionId, records),
    ensurePartition: (at) => ensureCheckPartition(prisma, at),
    now: () => new Date(),
    onError: (context, error) => {
      log("worker.error", {
        context,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  };

  const watch = startWatch(ports, config, (summary) => {
    // Quiet when idle; every tick that did work is worth a line.
    if (summary.leased > 0 || summary.errored > 0) {
      log("watch.tick", { region: config.region, ...summary });
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker.shutdown", { signal });

    // Give the in-flight tick a bounded chance to finish writing its checks.
    // Exiting immediately would discard observations already paid for.
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, config.shutdownGraceMs).unref();
    });
    await Promise.race([watch.stop(), timeout]);
    await prisma.$disconnect();
    log("worker.stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log("worker.fatal", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
