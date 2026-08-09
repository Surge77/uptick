import { buildChart } from "@/lib/chart";

let gradientSeq = 0;

/**
 * Compact latency trend for a list row.
 *
 * `preserveAspectRatio="none"` lets one fixed viewBox stretch to whatever width
 * the column gets, so every row's series is sampled identically and rows stay
 * visually comparable down the column.
 */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  tone = "var(--phosphor)",
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  const chart = buildChart(values, { width, height, padding: 3 });

  if (!chart) {
    return <div className="spark-empty" aria-hidden />;
  }

  gradientSeq += 1;
  const gradientId = `spark-${gradientSeq}`;

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Latency trend over ${values.length} days`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.32" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={chart.area} fill={`url(#${gradientId})`} />
      <path
        d={chart.line}
        fill="none"
        stroke={tone}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
