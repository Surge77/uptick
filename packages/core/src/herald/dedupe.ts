/**
 * Notification deduplication and routing decisions.
 *
 * The single most important property in this file: an alert is keyed to an
 * incident STATE TRANSITION, never to a check. Ten consecutive failed probes
 * are one transition, so they produce one alert. Keying on the check is how
 * monitoring products become the thing people mute.
 */

export type NotificationKind = "OPENED" | "ESCALATED" | "DOWNGRADED" | "RESOLVED" | "ESCALATION";

export interface DedupeInput {
  incidentId: string;
  channelId: string;
  kind: NotificationKind;
  /** Escalation tier. Distinguishes repeat pages for the same incident. */
  level?: number;
}

/**
 * Build the value stored in `Notification.dedupeKey`, which carries a UNIQUE
 * constraint.
 *
 * Enforcing at-most-once in the database rather than in application code means
 * the guarantee survives a crash between "decide to send" and "record sent",
 * and survives two workers evaluating the same incident concurrently. An
 * in-memory guard survives neither.
 */
export function dedupeKey(input: DedupeInput): string {
  const level = input.level ?? 0;
  return `${input.incidentId}:${input.kind}:${level}`;
}

export interface QuietHours {
  /** Minutes from UTC midnight, inclusive. */
  startMinute: number;
  /** Minutes from UTC midnight, exclusive. May be less than start (overnight). */
  endMinute: number;
}

/** Minutes elapsed since UTC midnight. */
export function minutesOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

/**
 * Whether an instant falls inside quiet hours.
 *
 * Windows that wrap midnight (22:00 to 06:00) are the normal case, not the
 * exception, so they are handled directly rather than requiring the caller to
 * split them.
 */
export function inQuietHours(at: Date, quiet: QuietHours | null): boolean {
  if (!quiet) return false;
  const minute = minutesOfDay(at);

  if (quiet.startMinute === quiet.endMinute) return false;

  return quiet.startMinute < quiet.endMinute
    ? minute >= quiet.startMinute && minute < quiet.endMinute
    : minute >= quiet.startMinute || minute < quiet.endMinute;
}

export interface RoutingChannel {
  id: string;
  tier: number;
  enabled: boolean;
  verified: boolean;
  quietHours?: QuietHours | null;
}

export interface RoutingInput {
  kind: NotificationKind;
  channels: readonly RoutingChannel[];
  /** Current escalation tier of the incident. */
  level: number;
  now: Date;
}

export interface RoutingDecision {
  channelId: string;
  send: boolean;
  reason: string | null;
}

/**
 * Decide which channels should receive a notification.
 *
 * Quiet hours suppress a page but never a RESOLVED notice. Being told at 3am
 * that something is fixed costs nothing; being left believing a service is
 * still down until morning costs a great deal.
 */
export function routeNotification(input: RoutingInput): RoutingDecision[] {
  return input.channels.map((channel) => {
    if (!channel.enabled) {
      return { channelId: channel.id, send: false, reason: "channel disabled" };
    }
    if (!channel.verified) {
      // An unverified channel is an unconfirmed address. Sending to it turns
      // Uptick into an open relay for whoever typed it in.
      return { channelId: channel.id, send: false, reason: "channel not verified" };
    }
    if (channel.tier > input.level) {
      return { channelId: channel.id, send: false, reason: "higher tier not yet reached" };
    }
    if (input.kind !== "RESOLVED" && inQuietHours(input.now, channel.quietHours ?? null)) {
      return { channelId: channel.id, send: false, reason: "quiet hours" };
    }
    return { channelId: channel.id, send: true, reason: null };
  });
}

export interface EscalationInput {
  openedAt: Date;
  ackedAt: Date | null;
  resolvedAt: Date | null;
  currentLevel: number;
  /** Minutes of no acknowledgement before moving to the next tier. */
  stepMinutes: number;
  maxLevel: number;
  now: Date;
}

/**
 * Next escalation tier for an unacknowledged incident, or null to stay put.
 *
 * Acknowledgement stops escalation permanently: a human has taken it, and
 * paging the next tier anyway is how an on-call rotation loses trust in the
 * tool. Resolution obviously stops it too.
 */
export function nextEscalationLevel(input: EscalationInput): number | null {
  if (input.ackedAt !== null || input.resolvedAt !== null) return null;
  if (input.currentLevel >= input.maxLevel) return null;
  if (input.stepMinutes <= 0) return null;

  const elapsedMinutes = (input.now.getTime() - input.openedAt.getTime()) / 60_000;
  const earned = Math.floor(elapsedMinutes / input.stepMinutes);
  if (earned <= input.currentLevel) return null;

  return Math.min(earned, input.maxLevel);
}
