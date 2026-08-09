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
  const color = barColor(budget);

  return (
    <div className="card-pad">
      <div className="row-baseline" style={{ marginBottom: "0.6rem" }}>
        <span style={{ fontWeight: 600 }}>
          <span className="num">{budget.objective}%</span>{" "}
          <span className="dim" style={{ fontWeight: 400 }}>
            over {budget.windowDays} days
          </span>
        </span>
        <span className="push metric" style={{ color, fontSize: "0.875rem", fontWeight: 600 }}>
          {budget.exhausted
            ? `over by ${formatDuration(budget.consumedMs - budget.allowedMs)}`
            : `${formatDuration(budget.remainingMs)} left`}
        </span>
      </div>

      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${filled}%`, background: color }} />
      </div>

      <div className="small dim metric" style={{ marginTop: "0.55rem" }}>
        {formatDuration(budget.consumedMs)} used of {formatDuration(budget.allowedMs)} ·{" "}
        {Math.round(budget.consumedFraction * 100)}% of budget
      </div>
    </div>
  );
}
