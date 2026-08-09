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
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          This organization has no monitors yet.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.4rem", marginBottom: "1rem" }}>
          {monitors.map((monitor) => (
            <label
              key={monitor.id}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem" }}
            >
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
        <div style={{ color: "var(--down)", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div style={{ color: "var(--up)", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
          Components updated.
        </div>
      )}

      <button
        type="submit"
        disabled={pending || monitors.length === 0}
        style={{
          padding: "0.45rem 0.9rem",
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          color: "var(--text)",
          fontSize: "0.85rem",
          cursor: pending ? "wait" : "pointer",
        }}
      >
        {pending ? "Saving…" : "Save components"}
      </button>
    </form>
  );
}
