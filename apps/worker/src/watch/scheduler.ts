import type { ProbeResult } from "@uptick/core";

/**
 * The scheduler tick, expressed against ports so it can be tested without a
 * database or a network.
 */

export interface LeasedMonitor {
  id: string;
  name: string;
  type: "HTTP" | "TCP" | "ICMP" | "SSL" | "DNS" | "HEARTBEAT";
  target: string;
  intervalSec: number;
  timeoutMs: number;
}

export interface CheckRecord {
  monitorId: string;
  result: ProbeResult;
  nextCheckAt: Date;
}

export interface WatchPorts {
  /**
   * Claim due monitors and advance their `nextCheckAt` in ONE transaction.
   *
   * The lease and the advance must be atomic. If they are split, a crash
   * between them re-runs the same monitors, and a concurrent worker sees rows
   * that look due but are already in flight.
   */
  leaseDueMonitors(limit: number, now: Date): Promise<LeasedMonitor[]>;
  runProbe(monitor: LeasedMonitor): Promise<ProbeResult>;
  recordChecks(records: readonly CheckRecord[]): Promise<void>;
  /** Create the partition covering `at` if absent. Idempotent. */
  ensurePartition(at: Date): Promise<void>;
  now(): Date;
  onError(context: string, error: unknown): void;
}

export interface TickSummary {
  leased: number;
  succeeded: number;
  failed: number;
  errored: number;
  durationMs: number;
}

/**
 * Next due time for a monitor.
 *
 * Anchored to *now* rather than to the previous due time. Anchoring to the
 * schedule causes a worker that falls behind to immediately fire every missed
 * check in a burst, which hammers a target that may already be struggling.
 */
export function computeNextCheckAt(now: Date, intervalSec: number): Date {
  const safeInterval = Math.max(1, Math.floor(intervalSec));
  return new Date(now.getTime() + safeInterval * 1000);
}

/** Run probes with at most `concurrency` in flight, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Execute one scheduler tick.
 *
 * Never throws: a tick that fails must not take the process down, because the
 * next tick may well succeed and a dead worker stops monitoring entirely.
 */
export async function runTick(
  ports: WatchPorts,
  options: { batchSize: number; concurrency: number },
): Promise<TickSummary> {
  const startedAt = ports.now();
  const summary: TickSummary = {
    leased: 0,
    succeeded: 0,
    failed: 0,
    errored: 0,
    durationMs: 0,
  };

  try {
    // Cheap and idempotent. Doing it every tick means a month boundary can
    // never arrive without somewhere to write.
    await ports.ensurePartition(startedAt);
  } catch (error) {
    ports.onError("ensurePartition", error);
  }

  let monitors: LeasedMonitor[];
  try {
    monitors = await ports.leaseDueMonitors(options.batchSize, startedAt);
  } catch (error) {
    ports.onError("leaseDueMonitors", error);
    summary.durationMs = ports.now().getTime() - startedAt.getTime();
    return summary;
  }

  summary.leased = monitors.length;
  if (monitors.length === 0) {
    summary.durationMs = ports.now().getTime() - startedAt.getTime();
    return summary;
  }

  const records = await mapWithConcurrency(
    monitors,
    options.concurrency,
    async (monitor): Promise<CheckRecord> => {
      try {
        const result = await ports.runProbe(monitor);
        if (result.ok) summary.succeeded += 1;
        else summary.failed += 1;
        return {
          monitorId: monitor.id,
          result,
          nextCheckAt: computeNextCheckAt(ports.now(), monitor.intervalSec),
        };
      } catch (error) {
        // A probe that throws is still an observation: the target could not be
        // checked. Dropping it would leave a hole in the record and let the
        // verdict machine conclude from stale data.
        summary.errored += 1;
        ports.onError(`probe ${monitor.id}`, error);
        return {
          monitorId: monitor.id,
          result: {
            ok: false,
            statusCode: null,
            latencyMs: 0,
            error: error instanceof Error ? error.message : String(error),
            dnsMs: null,
            connectMs: null,
            tlsMs: null,
            ttfbMs: null,
          },
          nextCheckAt: computeNextCheckAt(ports.now(), monitor.intervalSec),
        };
      }
    },
  );

  try {
    await ports.recordChecks(records);
  } catch (error) {
    ports.onError("recordChecks", error);
  }

  summary.durationMs = ports.now().getTime() - startedAt.getTime();
  return summary;
}

/**
 * Drive `runTick` on an interval until stopped.
 *
 * Ticks never overlap. If one runs long, the next starts after it finishes
 * rather than concurrently — overlapping ticks would double the effective
 * concurrency limit and defeat the pool.
 */
export function startWatch(
  ports: WatchPorts,
  options: { tickMs: number; batchSize: number; concurrency: number },
  onTick?: (summary: TickSummary) => void,
): { stop: () => Promise<void> } {
  let stopped = false;
  let active: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const loop = async (): Promise<void> => {
    if (stopped) return;
    const summary = await runTick(ports, options);
    onTick?.(summary);
    if (stopped) return;

    // Subtract the tick's own duration so the cadence stays even under load.
    const delay = Math.max(0, options.tickMs - summary.durationMs);
    timer = setTimeout(() => {
      active = loop();
    }, delay);
  };

  active = loop();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Wait for the in-flight tick so its checks are written before exit.
      await active;
    },
  };
}
