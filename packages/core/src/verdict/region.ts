import type { Observation, RegionVerdict, VerdictPolicy } from "./types.js";

/**
 * Fold one region's recent observations into the state that region alone
 * would support.
 *
 * Observations must be ordered oldest to newest. Only the trailing run matters:
 * a monitor that failed twice an hour ago and has succeeded since is UP, and
 * the historical failures must not count toward the confirmation threshold.
 */
export function foldRegion(
  regionSlug: string,
  observations: readonly Observation[],
  policy: VerdictPolicy,
): RegionVerdict {
  if (observations.length === 0) {
    return {
      regionSlug,
      state: "PENDING",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastObservedAt: null,
      lastError: null,
    };
  }

  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  let consecutiveSlow = 0;

  // Walk backwards from the newest observation; stop at the first result that
  // breaks the run.
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    const obs = observations[i]!;
    if (obs.ok) {
      if (consecutiveFailures > 0) break;
      consecutiveSuccesses += 1;
    } else {
      if (consecutiveSuccesses > 0) break;
      consecutiveFailures += 1;
    }
  }

  if (consecutiveFailures === 0 && policy.degradedMs !== null) {
    for (let i = observations.length - 1; i >= 0; i -= 1) {
      const obs = observations[i]!;
      if (!obs.ok) break;
      if (obs.latencyMs !== null && obs.latencyMs > policy.degradedMs) {
        consecutiveSlow += 1;
      } else {
        break;
      }
    }
  }

  const latest = observations[observations.length - 1]!;

  // A slow-but-successful run is only DEGRADED once it is as well established
  // as an outage would need to be. Otherwise one slow response would flip the
  // status on every latency spike.
  let state: RegionVerdict["state"];
  if (consecutiveFailures >= policy.confirmThreshold) {
    state = "DOWN";
  } else if (consecutiveSlow >= policy.confirmThreshold) {
    state = "DEGRADED";
  } else if (consecutiveSuccesses >= policy.recoverThreshold) {
    state = "UP";
  } else {
    state = "PENDING";
  }

  return {
    regionSlug,
    state,
    consecutiveFailures,
    consecutiveSuccesses,
    lastObservedAt: latest.ts,
    lastError: latest.ok ? null : (latest.error ?? null),
  };
}

/**
 * Group observations by region and fold each independently.
 *
 * Regions are evaluated separately because quorum is meaningless otherwise:
 * merging all observations into one stream would let a single region's
 * failures satisfy the confirmation threshold on their own.
 */
export function foldRegions(
  observations: readonly Observation[],
  policy: VerdictPolicy,
): RegionVerdict[] {
  const byRegion = new Map<string, Observation[]>();

  for (const obs of observations) {
    const existing = byRegion.get(obs.regionSlug);
    if (existing) {
      existing.push(obs);
    } else {
      byRegion.set(obs.regionSlug, [obs]);
    }
  }

  return [...byRegion.entries()]
    .map(([slug, obs]) => {
      const ordered = [...obs].sort((a, b) => a.ts.getTime() - b.ts.getTime());
      return foldRegion(slug, ordered, policy);
    })
    .sort((a, b) => a.regionSlug.localeCompare(b.regionSlug));
}
