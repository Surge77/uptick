import { prisma } from "@uptick/db";
import { nodeResolver } from "./adapters/resolver.js";
import { nodeDnsLookup, nodeInspectCertificate, nodeTcpConnect } from "./adapters/socket.js";
import { nodeTransport } from "./adapters/transport.js";
import { loadConfig } from "./config.js";
import { evaluateAndApply } from "./incidents/pipeline.js";
import { findStaleHeartbeats, recordHeartbeatChecks } from "./jobs/heartbeat-store.js";
import { daysToRollup, pruneChecks, rollupDay } from "./jobs/ledger.js";
import { dispatchProbe } from "./watch/dispatch.js";
import {
  ensureCheckPartition,
  leaseDueMonitors,
  recordChecks,
  resolveRegionId,
} from "./watch/lease.js";
import { startWatch, type WatchPorts } from "./watch/scheduler.js";

const HEARTBEAT_SWEEP_MS = 60_000;
const LEDGER_INTERVAL_MS = 60 * 60_000;

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
    evaluateIncidents: async (monitorIds, at) => {
      const summary = await evaluateAndApply(prisma, monitorIds, at, ports.onError);
      if (summary.opened + summary.resolved + summary.severityChanged + summary.suppressed > 0) {
        log("incidents.applied", { ...summary });
      }
    },
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

  // Heartbeats are push-based, so staleness has to be looked for rather than
  // observed. Swept on the tick cadence; the grace period does the real work.
  const heartbeatTimer = setInterval(() => {
    void (async () => {
      try {
        const now = new Date();
        const result = await findStaleHeartbeats(prisma, now);
        await recordHeartbeatChecks(prisma, regionId, result, now);
        if (result.stale.length > 0) {
          log("heartbeat.stale", { count: result.stale.length });
        }
      } catch (error) {
        ports.onError("heartbeatSweep", error);
      }
    })();
  }, HEARTBEAT_SWEEP_MS);
  heartbeatTimer.unref();

  // Rollups and retention run on one instance only. Electing by region keeps
  // three workers from racing on the same upserts; the job is idempotent, so
  // this is about wasted work rather than correctness.
  const isLedgerLeader = config.region === (process.env.LEDGER_REGION ?? "fra");
  const ledgerTimer = setInterval(() => {
    if (!isLedgerLeader) return;
    void (async () => {
      try {
        const now = new Date();
        for (const day of daysToRollup(now)) {
          const summary = await rollupDay(prisma, day, now);
          log("ledger.rollup", {
            day: summary.day.toISOString().slice(0, 10),
            monitorsProcessed: summary.monitorsProcessed,
            rowsWritten: summary.rowsWritten,
          });
        }
        const dropped = await pruneChecks(prisma);
        if (dropped.length > 0) log("ledger.pruned", { partitions: dropped });
      } catch (error) {
        ports.onError("ledgerJob", error);
      }
    })();
  }, LEDGER_INTERVAL_MS);
  ledgerTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("worker.shutdown", { signal });

    // Give the in-flight tick a bounded chance to finish writing its checks.
    // Exiting immediately would discard observations already paid for.
    clearInterval(heartbeatTimer);
    clearInterval(ledgerTimer);

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
