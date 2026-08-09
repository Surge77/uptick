import { describe, expect, it, vi } from "vitest";
import type { ProbeResult } from "@uptick/core";
import {
  computeNextCheckAt,
  mapWithConcurrency,
  runTick,
  startWatch,
  type LeasedMonitor,
  type WatchPorts,
} from "./scheduler.js";

const NOW = new Date("2026-01-01T00:00:00Z");

const okResult: ProbeResult = {
  ok: true,
  statusCode: 200,
  latencyMs: 50,
  error: null,
  dnsMs: null,
  connectMs: null,
  tlsMs: null,
  ttfbMs: null,
};

function monitor(id: string, over: Partial<LeasedMonitor> = {}): LeasedMonitor {
  return {
    id,
    name: `monitor-${id}`,
    type: "HTTP",
    target: "https://example.com",
    intervalSec: 60,
    timeoutMs: 5000,
    ...over,
  };
}

function ports(over: Partial<WatchPorts> = {}) {
  const recorded: Parameters<WatchPorts["recordChecks"]>[0][] = [];
  const errors: Array<{ context: string; error: unknown }> = [];

  const base: WatchPorts = {
    leaseDueMonitors: async () => [],
    runProbe: async () => okResult,
    recordChecks: async (records) => {
      recorded.push(records);
    },
    evaluateIncidents: async () => {},
    ensurePartition: async () => {},
    now: () => NOW,
    onError: (context, error) => errors.push({ context, error }),
    ...over,
  };
  return { ports: base, recorded, errors };
}

describe("computeNextCheckAt", () => {
  it("adds the interval to now", () => {
    expect(computeNextCheckAt(NOW, 60).toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("anchors to now rather than to the previous schedule", () => {
    // Anchoring to the schedule makes a worker that fell behind fire every
    // missed check at once, hammering a target that may already be struggling.
    const late = new Date("2026-01-01T00:10:00Z");
    expect(computeNextCheckAt(late, 60).toISOString()).toBe("2026-01-01T00:11:00.000Z");
  });

  it("clamps a zero or negative interval to one second", () => {
    expect(computeNextCheckAt(NOW, 0).getTime()).toBe(NOW.getTime() + 1000);
    expect(computeNextCheckAt(NOW, -5).getTime()).toBe(NOW.getTime() + 1000);
  });

  it("truncates a fractional interval", () => {
    expect(computeNextCheckAt(NOW, 1.9).getTime()).toBe(NOW.getTime() + 1000);
  });
});

describe("mapWithConcurrency", () => {
  it("returns an empty array for no items", async () => {
    expect(await mapWithConcurrency([], 5, async (x) => x)).toEqual([]);
  });

  it("preserves input order despite out-of-order completion", async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms / 10));
      return ms;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      },
    );

    expect(peak).toBeLessThanOrEqual(4);
  });

  it("treats a zero limit as one rather than stalling", async () => {
    expect(await mapWithConcurrency([1, 2], 0, async (x) => x * 2)).toEqual([2, 4]);
  });
});

describe("runTick", () => {
  const options = { batchSize: 10, concurrency: 4 };

  it("does nothing when no monitors are due", async () => {
    const runProbe = vi.fn(async () => okResult);
    const { ports: p, recorded } = ports({ runProbe });

    const summary = await runTick(p, options);

    expect(summary.leased).toBe(0);
    expect(runProbe).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("probes every leased monitor and records the results", async () => {
    const { ports: p, recorded } = ports({
      leaseDueMonitors: async () => [monitor("a"), monitor("b")],
    });

    const summary = await runTick(p, options);

    expect(summary.leased).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(recorded[0]).toHaveLength(2);
  });

  it("counts failed probes separately from errored ones", async () => {
    const { ports: p } = ports({
      leaseDueMonitors: async () => [monitor("a"), monitor("b")],
      runProbe: async (m) => (m.id === "a" ? okResult : { ...okResult, ok: false }),
    });

    const summary = await runTick(p, options);

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(0);
  });

  it("records a check even when the probe throws", async () => {
    // A probe that throws is still an observation: the target could not be
    // checked. Dropping it would leave a gap and let the verdict machine
    // conclude from stale data.
    const {
      ports: p,
      recorded,
      errors,
    } = ports({
      leaseDueMonitors: async () => [monitor("a")],
      runProbe: async () => {
        throw new Error("boom");
      },
    });

    const summary = await runTick(p, options);

    expect(summary.errored).toBe(1);
    expect(recorded[0]).toHaveLength(1);
    expect(recorded[0]![0]!.result.ok).toBe(false);
    expect(recorded[0]![0]!.result.error).toBe("boom");
    expect(errors[0]!.context).toContain("probe a");
  });

  it("survives a lease failure without throwing", async () => {
    // A failing tick must never take the process down: the next tick may
    // succeed, and a dead worker stops monitoring entirely.
    const { ports: p, errors } = ports({
      leaseDueMonitors: async () => {
        throw new Error("connection lost");
      },
    });

    const summary = await runTick(p, options);

    expect(summary.leased).toBe(0);
    expect(errors[0]!.context).toBe("leaseDueMonitors");
  });

  it("survives a write failure without throwing", async () => {
    const { ports: p, errors } = ports({
      leaseDueMonitors: async () => [monitor("a")],
      recordChecks: async () => {
        throw new Error("write failed");
      },
    });

    const summary = await runTick(p, options);

    expect(summary.succeeded).toBe(1);
    expect(errors[0]!.context).toBe("recordChecks");
  });

  it("continues when partition creation fails", async () => {
    const { ports: p, errors } = ports({
      ensurePartition: async () => {
        throw new Error("permission denied");
      },
      leaseDueMonitors: async () => [monitor("a")],
    });

    const summary = await runTick(p, options);

    expect(summary.succeeded).toBe(1);
    expect(errors[0]!.context).toBe("ensurePartition");
  });

  it("ensures the partition before leasing so a month boundary cannot surprise it", async () => {
    const order: string[] = [];
    const { ports: p } = ports({
      ensurePartition: async () => {
        order.push("partition");
      },
      leaseDueMonitors: async () => {
        order.push("lease");
        return [];
      },
    });

    await runTick(p, options);
    expect(order).toEqual(["partition", "lease"]);
  });

  it("asks for no more than the batch size", async () => {
    const lease = vi.fn(async () => []);
    const { ports: p } = ports({ leaseDueMonitors: lease });

    await runTick(p, { batchSize: 25, concurrency: 4 });
    expect(lease).toHaveBeenCalledWith(25, NOW);
  });

  it("evaluates incidents for the monitors it probed", async () => {
    const seen: string[][] = [];
    const { ports: p } = ports({
      leaseDueMonitors: async () => [monitor("a"), monitor("b")],
      evaluateIncidents: async (ids) => {
        seen.push([...ids]);
      },
    });

    await runTick(p, options);
    expect(seen).toEqual([["a", "b"]]);
  });

  it("does not evaluate when the checks failed to persist", async () => {
    // Concluding from observations that were never written would open an
    // incident with no supporting checks behind it.
    const evaluateIncidents = vi.fn(async () => {});
    const { ports: p } = ports({
      leaseDueMonitors: async () => [monitor("a")],
      recordChecks: async () => {
        throw new Error("write failed");
      },
      evaluateIncidents,
    });

    await runTick(p, options);
    expect(evaluateIncidents).not.toHaveBeenCalled();
  });

  it("survives an evaluation failure without throwing", async () => {
    const { ports: p, errors } = ports({
      leaseDueMonitors: async () => [monitor("a")],
      evaluateIncidents: async () => {
        throw new Error("evaluation exploded");
      },
    });

    const summary = await runTick(p, options);
    expect(summary.succeeded).toBe(1);
    expect(errors[0]!.context).toBe("evaluateIncidents");
  });

  it("schedules the next check from each monitor's own interval", async () => {
    const { ports: p, recorded } = ports({
      leaseDueMonitors: async () => [
        monitor("a", { intervalSec: 30 }),
        monitor("b", { intervalSec: 300 }),
      ],
    });

    await runTick(p, options);

    const [first, second] = recorded[0]!;
    expect(first!.nextCheckAt.getTime()).toBe(NOW.getTime() + 30_000);
    expect(second!.nextCheckAt.getTime()).toBe(NOW.getTime() + 300_000);
  });
});

describe("startWatch", () => {
  it("runs an initial tick immediately", async () => {
    const lease = vi.fn(async () => []);
    const { ports: p } = ports({ leaseDueMonitors: lease });

    const watch = startWatch(p, { tickMs: 10_000, batchSize: 10, concurrency: 4 });
    await watch.stop();

    expect(lease).toHaveBeenCalledTimes(1);
  });

  it("stops cleanly and runs no further ticks", async () => {
    const lease = vi.fn(async () => []);
    const { ports: p } = ports({ leaseDueMonitors: lease });

    const watch = startWatch(p, { tickMs: 1, batchSize: 10, concurrency: 4 });
    await watch.stop();
    const callsAtStop = lease.mock.calls.length;

    await new Promise((r) => setTimeout(r, 20));
    expect(lease.mock.calls.length).toBe(callsAtStop);
  });

  it("waits for the in-flight tick so its checks are written before exit", async () => {
    let finished = false;
    const { ports: p } = ports({
      leaseDueMonitors: async () => [monitor("a")],
      recordChecks: async () => {
        await new Promise((r) => setTimeout(r, 20));
        finished = true;
      },
    });

    const watch = startWatch(p, { tickMs: 10_000, batchSize: 10, concurrency: 4 });
    await watch.stop();

    expect(finished).toBe(true);
  });

  it("reports each tick to the observer", async () => {
    const onTick = vi.fn();
    const { ports: p } = ports({ leaseDueMonitors: async () => [monitor("a")] });

    const watch = startWatch(p, { tickMs: 10_000, batchSize: 10, concurrency: 4 }, onTick);
    await watch.stop();

    expect(onTick).toHaveBeenCalledWith(expect.objectContaining({ leased: 1, succeeded: 1 }));
  });
});
