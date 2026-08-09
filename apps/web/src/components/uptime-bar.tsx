import type { StatusDay } from "@/lib/status-page";

type Quality = "none" | "up" | "degraded" | "down";

/** A day with any failed checks is not green; a fully failed day is red. */
function qualityOf(day: StatusDay): Quality {
  if (day.totalCount === 0) return "none";
  if (day.upCount === day.totalCount) return "up";
  if (day.upCount === 0) return "down";
  return "degraded";
}

function labelFor(day: StatusDay): string {
  if (day.totalCount === 0) return `${day.day}: no data`;
  return `${day.day}: ${day.upCount}/${day.totalCount} checks passed`;
}

/**
 * Pad the strip back to a fixed width with blank days.
 *
 * A monitor with three days of history should not render a three-bar stub next
 * to a neighbour showing ninety: the eye reads bar width as a time axis, and an
 * unpadded strip silently rescales it. Missing days are drawn as absent rather
 * than omitted.
 */
function padded(days: StatusDay[], window: number): (StatusDay | null)[] {
  if (days.length >= window) return days.slice(-window);
  return [...Array<null>(window - days.length).fill(null), ...days];
}

export function UptimeBar({ days, window = 90 }: { days: StatusDay[]; window?: number }) {
  const cells = padded(days, window);
  const label =
    days.length === 0
      ? "No availability history recorded yet"
      : `Daily availability over the last ${window} days`;

  return (
    <div className="strip" role="img" aria-label={label}>
      {cells.map((day, index) => (
        <div
          key={day?.day ?? `blank-${index}`}
          className="strip-bar"
          data-quality={day ? qualityOf(day) : "none"}
          title={day ? labelFor(day) : "No data"}
        />
      ))}
    </div>
  );
}
