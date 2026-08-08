/**
 * Heartbeat staleness rules.
 *
 * Pure, and separated from `heartbeat-store.ts` for the same reason
 * `packages/core` is separated from Prisma: the rule about when silence
 * becomes an alert is worth testing exhaustively, and needs no database.
 *
 * Heartbeat monitors are push-based: the job calls us. There is nothing for the
 * scheduler to probe, so the alert condition is silence, and silence has to be
 * looked for rather than observed.
 */

export interface HeartbeatSweepResult {
  checked: number;
  stale: string[];
}

export interface HeartbeatRecord {
  monitorId: string;
  graceSec: number;
  lastPingAt: Date | null;
}

/**
 * Whether a heartbeat has gone silent past its grace period.
 *
 * A heartbeat that has NEVER pinged is not stale: a monitor created five
 * minutes ago whose job runs nightly would otherwise alert immediately, before
 * the job has had any opportunity to run. Staleness is measured from the last
 * ping; absence of a first ping is simply "not yet reporting".
 */
export function isHeartbeatStale(record: HeartbeatRecord, now: Date): boolean {
  if (record.lastPingAt === null) return false;
  const deadline = record.lastPingAt.getTime() + record.graceSec * 1000;
  return now.getTime() > deadline;
}

/** Select the stale heartbeats from a set of records. */
export function selectStale(records: readonly HeartbeatRecord[], now: Date): HeartbeatSweepResult {
  return {
    checked: records.length,
    stale: records.filter((r) => isHeartbeatStale(r, now)).map((r) => r.monitorId),
  };
}
