/** Worker configuration, parsed and validated once at startup. */

export interface WorkerConfig {
  /** Region slug this instance probes from. Must match a `Region.slug` row. */
  region: string;
  tickMs: number;
  /** Maximum probes in flight at once across the whole tick. */
  concurrency: number;
  /** Monitors claimed per tick. */
  batchSize: number;
  /** Default probe timeout when a monitor does not set one. */
  defaultTimeoutMs: number;
  shutdownGraceMs: number;
}

export const DEFAULTS = {
  tickMs: 10_000,
  concurrency: 50,
  batchSize: 200,
  defaultTimeoutMs: 10_000,
  shutdownGraceMs: 15_000,
} as const;

export class ConfigError extends Error {}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${key} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Build config from the environment.
 *
 * `REGION` has no default. A worker that silently probes as the wrong region
 * corrupts quorum — two instances both reporting as `fra` look like agreement
 * when they are one machine, which is exactly the false confidence quorum
 * exists to prevent.
 */
export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const region = env.REGION?.trim();
  if (!region) {
    throw new ConfigError("REGION is required and must match a Region.slug row");
  }

  const config: WorkerConfig = {
    region,
    tickMs: readInt(env, "WATCH_TICK_MS", DEFAULTS.tickMs),
    concurrency: readInt(env, "WATCH_CONCURRENCY", DEFAULTS.concurrency),
    batchSize: readInt(env, "WATCH_BATCH_SIZE", DEFAULTS.batchSize),
    defaultTimeoutMs: readInt(env, "PROBE_TIMEOUT_MS", DEFAULTS.defaultTimeoutMs),
    shutdownGraceMs: readInt(env, "SHUTDOWN_GRACE_MS", DEFAULTS.shutdownGraceMs),
  };

  // A batch larger than the pool can absorb within one tick just grows the
  // lease hold time, which delays other workers without increasing throughput.
  if (config.batchSize < config.concurrency) {
    throw new ConfigError(
      `WATCH_BATCH_SIZE (${config.batchSize}) must be >= WATCH_CONCURRENCY (${config.concurrency})`,
    );
  }

  return config;
}
