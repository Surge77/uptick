import type { MonitorBudget } from "@/lib/queries";
import { formatDuration } from "@uptick/core";

/** Amber once most of the budget is gone, red once it is overspent. */
const WARN_FRACTION = 0.75;

function barColor(budget: MonitorBudget): string {
  if (budget.exhausted) return "var(--down)";
  if (budget.consumedFraction >= WARN_FRACTION) return "var(--degraded)";
  return "var(--up)";
}

export function BudgetMeter({ budget }: { budget: MonitorBudget }) {
  const filled = Math.min(100, Math.max(0, budget.consumedFraction * 100));

  return (
    <div style={{ padding: "1rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>
          {budget.objective}% over {budget.windowDays} days
        </span>
        <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: barColor(budget) }}>
          {budget.exhausted
            ? `over by ${formatDuration(budget.consumedMs - budget.allowedMs)}`
            : `${formatDuration(budget.remainingMs)} left`}
        </span>
      </div>

      <div
        style={{
          height: "8px",
          borderRadius: "4px",
          background: "var(--bg)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${filled}%`, height: "100%", background: barColor(budget) }} />
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--muted)" }}>
        {formatDuration(budget.consumedMs)} used of {formatDuration(budget.allowedMs)} ·{" "}
        {Math.round(budget.consumedFraction * 100)}% of budget
      </div>
    </div>
  );
}
