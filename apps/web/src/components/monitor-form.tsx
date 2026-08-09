"use client";

import type { ActionResult } from "@/lib/monitor-actions";
import { useActionState } from "react";

export interface MonitorDefaults {
  name: string;
  type: string;
  target: string;
  method: string;
  intervalSec: number;
  timeoutMs: number;
  degradedMs: number;
}

export const EMPTY_MONITOR: MonitorDefaults = {
  name: "",
  type: "HTTP",
  target: "",
  method: "GET",
  intervalSec: 60,
  timeoutMs: 10_000,
  degradedMs: 2_000,
};

const MONITOR_TYPES = ["HTTP", "TCP", "ICMP", "SSL", "DNS", "HEARTBEAT"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

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

function Field({
  name,
  label,
  error,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle} htmlFor={name}>
        {label}
      </label>
      {children}
      {error && (
        <div style={{ color: "var(--down)", fontSize: "0.78rem", marginTop: "0.3rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function MonitorForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  defaults: MonitorDefaults;
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

      <Field name="name" label="Name" error={errors.name}>
        <input id="name" name="name" defaultValue={defaults.name} style={field} required />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <Field name="type" label="Type" error={errors.type}>
          <select id="type" name="type" defaultValue={defaults.type} style={field}>
            {MONITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field name="method" label="Method" error={errors.method}>
          <select id="method" name="method" defaultValue={defaults.method} style={field}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field name="target" label="Target" error={errors.target}>
        <input
          id="target"
          name="target"
          defaultValue={defaults.target}
          style={field}
          placeholder="https://example.com/health"
          required
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
        <Field name="intervalSec" label="Interval (s)" error={errors.intervalSec}>
          <input
            id="intervalSec"
            name="intervalSec"
            type="number"
            min={10}
            max={86400}
            defaultValue={defaults.intervalSec}
            style={field}
          />
        </Field>

        <Field name="timeoutMs" label="Timeout (ms)" error={errors.timeoutMs}>
          <input
            id="timeoutMs"
            name="timeoutMs"
            type="number"
            min={500}
            max={60000}
            defaultValue={defaults.timeoutMs}
            style={field}
          />
        </Field>

        <Field name="degradedMs" label="Degraded above (ms)" error={errors.degradedMs}>
          <input
            id="degradedMs"
            name="degradedMs"
            type="number"
            min={1}
            max={60000}
            defaultValue={defaults.degradedMs}
            style={field}
          />
        </Field>
      </div>

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
