import type { MonitorState } from "@uptick/db";

export function StateDot({ state }: { state: MonitorState }) {
  return <span className="dot" data-state={state} aria-hidden />;
}

export function StateBadge({ state }: { state: MonitorState }) {
  return (
    <span className="badge" data-state={state}>
      <StateDot state={state} />
      {state}
    </span>
  );
}

export function Panel({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {hint && (
        <div className="small" style={{ marginTop: "0.35rem" }}>
          {hint}
        </div>
      )}
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
