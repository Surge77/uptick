export interface ChartGeometry {
  /** SVG path for the line itself. */
  line: string;
  /** Same path closed along the baseline, for the gradient fill. */
  area: string;
  min: number;
  max: number;
}

export interface ChartOptions {
  width: number;
  height: number;
  /** Vertical breathing room so the stroke is not clipped at the extremes. */
  padding?: number;
  /**
   * Force the vertical range instead of deriving it from these values.
   *
   * Required when two series share a chart: scaled independently, a p50 line
   * and a p95 line both fill the full height and the gap between them — the
   * whole point of plotting them together — disappears.
   */
  domain?: { min: number; max: number };
}

function scaleY(value: number, min: number, max: number, height: number, padding: number): number {
  const span = max - min;
  const usable = height - padding * 2;
  // A flat series has no span to divide by; draw it down the middle rather
  // than at the top, which is what a naive 0/0 would produce.
  if (span === 0) return height / 2;
  return padding + (1 - (value - min) / span) * usable;
}

/**
 * Build line and area paths for a sparkline.
 *
 * Deliberately renders a fixed-width viewBox and lets the SVG scale, so the
 * same series looks identical in a table row and a detail panel. Returns null
 * for an empty series so callers render an explicit "no data" state rather
 * than an empty chart, which would read as a flat, healthy line.
 */
export function buildChart(values: readonly number[], options: ChartOptions): ChartGeometry | null {
  if (values.length === 0) return null;

  const { width, height } = options;
  const padding = options.padding ?? 2;

  const min = options.domain?.min ?? Math.min(...values);
  const max = options.domain?.max ?? Math.max(...values);

  // A single sample has no horizontal extent; draw it as a flat line across
  // the full width so it still reads as a series.
  const step = values.length === 1 ? 0 : width / (values.length - 1);

  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index * step;
    return { x, y: scaleY(value, min, max, height, padding) };
  });

  const first = points[0];
  if (!first) return null;

  const line =
    values.length === 1
      ? `M 0 ${first.y.toFixed(2)} L ${width} ${first.y.toFixed(2)}`
      : points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
          .join(" ");

  const last = points[points.length - 1];
  const area = `${line} L ${(last?.x ?? width).toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;

  return { line, area, min, max };
}

/** Rounded, unit-aware latency label. Keeps axis text short. */
export function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
}

/**
 * Availability over the trailing `days` of a rollup series.
 *
 * Used only for the at-a-glance summary tiles. Contractual availability still
 * comes from incident durations via computeUptime — check ratios drift the
 * moment an interval changes — so these two numbers answer different
 * questions and are labelled accordingly.
 */
export function ratioUptime(
  days: readonly { upCount: number; totalCount: number }[],
  window: number,
): number | null {
  const recent = days.slice(-window);
  const total = recent.reduce((sum, d) => sum + d.totalCount, 0);
  if (total === 0) return null;
  const up = recent.reduce((sum, d) => sum + d.upCount, 0);
  return (up / total) * 100;
}

/**
 * Availability across several components over the same trailing window.
 *
 * Each component's own trailing slice is taken before summing, so a component
 * with a short history is not compared against a different span than its
 * neighbours. Checks are pooled rather than averaging per-component
 * percentages: a busy API and a quiet marketing page should not carry equal
 * weight in a single headline number.
 */
export function aggregateUptime(
  components: readonly (readonly { upCount: number; totalCount: number }[])[],
  window: number,
): number | null {
  let up = 0;
  let total = 0;

  for (const days of components) {
    for (const day of days.slice(-window)) {
      up += day.upCount;
      total += day.totalCount;
    }
  }

  return total === 0 ? null : (up / total) * 100;
}
