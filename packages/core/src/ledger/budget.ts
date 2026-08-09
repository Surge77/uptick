import { computeUptime, type IncidentPeriod } from "./sla.js";
import type { Interval } from "../time.js";

export interface BudgetInput {
  window: Interval;
  /** Target availability as a percentage, e.g. 99.9. */
  objective: number;
  incidents: readonly IncidentPeriod[];
  maintenance: readonly Interval[];
  countDegraded: boolean;
}

export interface BudgetResult {
  /** Downtime the objective permits over this window, in ms. */
  allowedMs: number;
  consumedMs: number;
  remainingMs: number;
  /** Share of the budget used, 0–1. Above 1 means the objective is missed. */
  consumedFraction: number;
  uptimePercent: number;
  exhausted: boolean;
}

/**
 * How much unavailability a target still permits.
 *
 * Expressed as a budget rather than a bare percentage because that is the
 * decision operators actually make: "99.9% over 30 days" is abstract, while
 * "you have 4 minutes left this month" tells you whether to ship on a Friday.
 *
 * Maintenance is excluded from the measured window by computeUptime, so
 * planned work does not spend the budget.
 */
export function computeErrorBudget(input: BudgetInput): BudgetResult {
  const uptime = computeUptime({
    window: input.window,
    incidents: input.incidents,
    maintenance: input.maintenance,
    countDegraded: input.countDegraded,
  });

  const objective = clampObjective(input.objective);
  const allowedMs = (uptime.measuredMs * (100 - objective)) / 100;
  const consumedMs = uptime.downtimeMs;
  const remainingMs = Math.max(0, allowedMs - consumedMs);

  // A 100% objective allows no downtime at all, so any outage exhausts it and
  // the fraction would otherwise divide by zero.
  const consumedFraction = allowedMs === 0 ? (consumedMs > 0 ? 1 : 0) : consumedMs / allowedMs;

  return {
    allowedMs,
    consumedMs,
    remainingMs,
    consumedFraction,
    uptimePercent: uptime.uptimePercent,
    exhausted: consumedMs >= allowedMs,
  };
}

function clampObjective(objective: number): number {
  if (!Number.isFinite(objective)) return 100;
  return Math.min(100, Math.max(0, objective));
}

/** Budget burn relative to a uniform spend across the window. */
export function burnRate(result: BudgetResult, elapsedFraction: number): number {
  if (elapsedFraction <= 0) return 0;
  return result.consumedFraction / elapsedFraction;
}
