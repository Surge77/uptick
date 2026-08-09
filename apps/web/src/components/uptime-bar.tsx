import type { StatusDay } from "@/lib/status-page";

const BAR_COLOR = {
  none: "var(--border)",
  up: "var(--up)",
  degraded: "var(--degraded)",
  down: "var(--down)",
} as const;

/** A day with any failed checks is not green; a fully failed day is red. */
function colorFor(day: StatusDay): string {
  if (day.totalCount === 0) return BAR_COLOR.none;
  if (day.upCount === day.totalCount) return BAR_COLOR.up;
  if (day.upCount === 0) return BAR_COLOR.down;
  return BAR_COLOR.degraded;
}

function labelFor(day: StatusDay): string {
  if (day.totalCount === 0) return `${day.day}: no data`;
  return `${day.day}: ${day.upCount}/${day.totalCount} checks passed`;
}

export function UptimeBar({ days }: { days: StatusDay[] }) {
  if (days.length === 0) {
    return <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>No history yet</div>;
  }

  return (
    <div style={{ display: "flex", gap: "2px", alignItems: "stretch", height: "26px" }}>
      {days.map((day) => (
        <div
          key={day.day}
          title={labelFor(day)}
          style={{
            flex: "1 1 3px",
            minWidth: "3px",
            borderRadius: "2px",
            background: colorFor(day),
          }}
        />
      ))}
    </div>
  );
}
