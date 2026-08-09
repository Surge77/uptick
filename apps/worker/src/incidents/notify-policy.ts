import type { NotificationKind } from "@uptick/core";

/**
 * Whether a persisted transition should page, given dependency suppression.
 *
 * Only the opening alert is withheld. A resolution, escalation, or downgrade
 * still goes out even when the outage was attributed upstream — otherwise an
 * incident that paged nobody also never visibly closes, and whoever is
 * watching the root cause never learns the dependent service recovered.
 */
export function shouldNotify(kind: NotificationKind, isDependencySuppressed: boolean): boolean {
  if (!isDependencySuppressed) return true;
  return kind !== "OPENED";
}
