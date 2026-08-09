"use client";

import type { ActionResult } from "@/lib/action-result";
import { useActionState } from "react";

export interface PickableMonitor {
  id: string;
  name: string;
  selected: boolean;
}

/**
 * Choose which monitors a status page publishes.
 *
 * Submits repeated `monitorId` checkbox values; the server intersects them
 * with the org's own monitors, so this list is a convenience rather than the
 * authority on what may be published.
 */
export function ComponentPicker({
  action,
  monitors,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  monitors: PickableMonitor[];
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction}>
      {monitors.length === 0 ? (
        <p className="small muted">This organization has no monitors yet.</p>
      ) : (
        <div className="stack" style={{ gap: "0.5rem", marginBottom: "1.1rem" }}>
          {monitors.map((monitor) => (
            <label key={monitor.id} className="check">
              <input
                type="checkbox"
                name="monitorId"
                value={monitor.id}
                defaultChecked={monitor.selected}
              />
              {monitor.name}
            </label>
          ))}
        </div>
      )}

      {state?.error && !state.ok && (
        <div className="banner banner-error" style={{ marginBottom: "0.7rem" }}>
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div className="banner banner-ok" style={{ marginBottom: "0.7rem" }}>
          Components updated.
        </div>
      )}

      <button type="submit" className="btn btn-sm" disabled={pending || monitors.length === 0}>
        {pending ? "Saving…" : "Save components"}
      </button>
    </form>
  );
}
