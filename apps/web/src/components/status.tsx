import type { MonitorState } from "@uptick/db";

const STATE_COLOR: Record<MonitorState, string> = {
  UP: "var(--up)",
  DEGRADED: "var(--degraded)",
  DOWN: "var(--down)",
  PENDING: "var(--muted)",
  PAUSED: "var(--muted)",
};

export function StateDot({ state }: { state: MonitorState }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "9px",
        height: "9px",
        borderRadius: "50%",
        background: STATE_COLOR[state],
      }}
    />
  );
}

export function StateBadge({ state }: { state: MonitorState }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        color: STATE_COLOR[state],
        fontSize: "0.8rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      <StateDot state={state} />
      {state}
    </span>
  );
}

export function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

export function relativeTime(value: Date | null): string {
  if (!value) return "never";
  const deltaSec = Math.round((Date.now() - value.getTime()) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)}h ago`;
  return `${Math.round(deltaSec / 86_400)}d ago`;
}

export function duration(start: Date, end: Date | null): string {
  const ms = (end?.getTime() ?? Date.now()) - start.getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ${min % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
