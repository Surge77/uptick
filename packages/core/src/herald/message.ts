import { formatDuration } from "../time.js";
import type { NotificationKind } from "./dedupe.js";

/** Channel-agnostic message construction. Transport formatting lives elsewhere. */

export interface AlertContext {
  kind: NotificationKind;
  monitorName: string;
  monitorTarget: string;
  severity: "DEGRADED" | "DOWN";
  cause: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
  failingRegions: readonly string[];
  level: number;
  /** Absolute URL of the incident in the dashboard, when known. */
  incidentUrl?: string | null;
  now: Date;
}

export interface AlertMessage {
  /** One line, suitable for an email subject or push title. */
  title: string;
  /** Plain text body. Channel adapters may re-render this. */
  body: string;
  /** Severity colour hint for chat channels, as a hex string. */
  color: string;
}

const COLORS = {
  DOWN: "#dc2626",
  DEGRADED: "#f59e0b",
  RESOLVED: "#16a34a",
} as const;

function verb(kind: NotificationKind, severity: "DEGRADED" | "DOWN"): string {
  switch (kind) {
    case "OPENED":
      return severity === "DOWN" ? "is DOWN" : "is DEGRADED";
    case "ESCALATED":
      return "has worsened to DOWN";
    case "DOWNGRADED":
      return "has improved to DEGRADED";
    case "RESOLVED":
      return "has RECOVERED";
    case "ESCALATION":
      return "is STILL DOWN and unacknowledged";
  }
}

/**
 * Build an alert message.
 *
 * The duration is included on every non-opening notification because "the API
 * is down" and "the API has been down for 40 minutes" prompt very different
 * responses, and the reader should not have to work it out from timestamps.
 */
export function buildAlert(context: AlertContext): AlertMessage {
  const title = `${context.monitorName} ${verb(context.kind, context.severity)}`;

  const lines: string[] = [`Monitor: ${context.monitorName}`, `Target: ${context.monitorTarget}`];

  if (context.kind === "RESOLVED") {
    const end = context.resolvedAt ?? context.now;
    lines.push(`Duration: ${formatDuration(end.getTime() - context.startedAt.getTime())}`);
    lines.push(`Resolved: ${end.toISOString()}`);
  } else {
    lines.push(`Severity: ${context.severity}`);
    if (context.cause) lines.push(`Cause: ${context.cause}`);
    if (context.failingRegions.length > 0) {
      lines.push(`Failing regions: ${context.failingRegions.join(", ")}`);
    }
    lines.push(`Started: ${context.startedAt.toISOString()}`);
    const elapsed = context.now.getTime() - context.startedAt.getTime();
    if (elapsed > 0) lines.push(`Ongoing for: ${formatDuration(elapsed)}`);
  }

  if (context.kind === "ESCALATION") {
    lines.push(`Escalation level: ${context.level} (no acknowledgement received)`);
  }

  if (context.incidentUrl) lines.push(`Details: ${context.incidentUrl}`);

  const color =
    context.kind === "RESOLVED"
      ? COLORS.RESOLVED
      : context.severity === "DOWN"
        ? COLORS.DOWN
        : COLORS.DEGRADED;

  return { title, body: lines.join("\n"), color };
}
