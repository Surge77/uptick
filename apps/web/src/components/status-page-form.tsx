"use client";

import type { ActionResult } from "@/lib/action-result";
import { useActionState } from "react";

export interface StatusPageDefaults {
  title: string;
  slug: string;
  description: string;
  isPublic: boolean;
}

export const EMPTY_STATUS_PAGE: StatusPageDefaults = {
  title: "",
  slug: "",
  description: "",
  isPublic: true,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.65rem",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "0.9rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "var(--muted)",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.3rem",
};

export function StatusPageForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  defaults: StatusPageDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} style={{ display: "grid", gap: "1rem", maxWidth: "620px" }}>
      {state?.error && !state.ok && (
        <div
          style={{
            border: "1px solid var(--down)",
            color: "var(--down)",
            borderRadius: "6px",
            padding: "0.6rem 0.8rem",
            fontSize: "0.85rem",
          }}
        >
          {state.error}
        </div>
      )}
      {state?.ok && <div style={{ color: "var(--up)", fontSize: "0.85rem" }}>Saved.</div>}

      <div>
        <label style={labelStyle} htmlFor="title">
          Title
        </label>
        <input id="title" name="title" defaultValue={defaults.title} style={field} required />
        {errors.title && (
          <div style={{ color: "var(--down)", fontSize: "0.78rem" }}>{errors.title}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="slug">
          Public URL
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>/status/</span>
          <input id="slug" name="slug" defaultValue={defaults.slug} style={field} required />
        </div>
        {errors.slug && (
          <div style={{ color: "var(--down)", fontSize: "0.78rem" }}>{errors.slug}</div>
        )}
      </div>

      <div>
        <label style={labelStyle} htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={defaults.description}
          rows={3}
          style={{ ...field, resize: "vertical" }}
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
        <input type="checkbox" name="isPublic" defaultChecked={defaults.isPublic} />
        Publicly visible
      </label>

      <div>
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: "0.55rem 1.1rem",
            background: "var(--accent)",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
