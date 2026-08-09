import { buildChart, formatMs } from "@/lib/chart";

export interface LatencyPoint {
  day: string;
  p50: number | null;
  p95: number | null;
}

const WIDTH = 720;
const HEIGHT = 180;
const GRID_LINES = [0.25, 0.5, 0.75];

/**
 * Response-time history for a monitor.
 *
 * p50 and p95 are drawn together rather than on separate charts: the gap
 * between them is the interesting signal. A p50 that stays flat while p95
 * climbs is a tail-latency problem hitting a minority of requests, and
 * splitting the series across two panels hides exactly that. Both are scaled
 * against one shared domain for the same reason.
 */
export function LatencyChart({ points }: { points: LatencyPoint[] }) {
  const p95 = points.map((p) => p.p95).filter((v): v is number => v !== null);
  const p50 = points.map((p) => p.p50).filter((v): v is number => v !== null);
  const combined = [...p95, ...p50];

  if (combined.length === 0) {
    return (
      <div className="empty">
        <div style={{ fontWeight: 600, color: "var(--text)" }}>No latency history</div>
        <div className="small" style={{ marginTop: "0.35rem" }}>
          Rollups are written once a full day of checks has completed.
        </div>
      </div>
    );
  }

  const domain = { min: Math.min(...combined), max: Math.max(...combined) };
  const options = { width: WIDTH, height: HEIGHT, padding: 10, domain };

  const upper = buildChart(p95, options);
  const lower = buildChart(p50, options);

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="chart-svg"
        role="img"
        aria-label={`Response time over ${points.length} days`}
      >
        <defs>
          <linearGradient id="latency-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--phosphor)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--phosphor)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {GRID_LINES.map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={WIDTH}
            y1={HEIGHT * fraction}
            y2={HEIGHT * fraction}
            stroke="var(--border)"
            strokeDasharray="3 6"
          />
        ))}

        {upper && <path d={upper.area} fill="url(#latency-fill)" />}
        {upper && (
          <path
            d={upper.line}
            fill="none"
            stroke="var(--phosphor)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        )}
        {lower && (
          <path
            d={lower.line}
            fill="none"
            stroke="var(--text-dim)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        )}
      </svg>

      <div className="chart-axis">
        <span>{formatMs(domain.max)}</span>
        <span>{formatMs(domain.min)}</span>
      </div>

      <div className="chart-legend">
        <span className="legend-item">
          <i style={{ background: "var(--phosphor)" }} /> p95
        </span>
        <span className="legend-item">
          <i style={{ background: "var(--text-dim)" }} /> p50
        </span>
        <span className="push small dim">{points.length} days</span>
      </div>
    </div>
  );
}
