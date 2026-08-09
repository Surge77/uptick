"use client";

import type { ActionResult } from "@/lib/action-result";
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
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
      {error && <div className="error">{error}</div>}
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
    <form action={formAction} className="form">
      {state?.error && !state.ok && <div className="banner banner-error">{state.error}</div>}

      <Field name="name" label="Name" error={errors.name}>
        <input id="name" name="name" className="input" defaultValue={defaults.name} required />
      </Field>

      <div className="grid-2">
        <Field name="type" label="Type" error={errors.type}>
          <select id="type" name="type" className="input" defaultValue={defaults.type}>
            {MONITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field name="method" label="Method" error={errors.method}>
          <select id="method" name="method" className="input" defaultValue={defaults.method}>
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
          className="input"
          defaultValue={defaults.target}
          placeholder="https://example.com/health"
          required
        />
      </Field>

      <div className="grid-3">
        <Field name="intervalSec" label="Interval (s)" error={errors.intervalSec}>
          <input
            id="intervalSec"
            name="intervalSec"
            className="input"
            type="number"
            min={10}
            max={86400}
            defaultValue={defaults.intervalSec}
          />
        </Field>

        <Field name="timeoutMs" label="Timeout (ms)" error={errors.timeoutMs}>
          <input
            id="timeoutMs"
            name="timeoutMs"
            className="input"
            type="number"
            min={500}
            max={60000}
            defaultValue={defaults.timeoutMs}
          />
        </Field>

        <Field name="degradedMs" label="Degraded above (ms)" error={errors.degradedMs}>
          <input
            id="degradedMs"
            name="degradedMs"
            className="input"
            type="number"
            min={1}
            max={60000}
            defaultValue={defaults.degradedMs}
          />
        </Field>
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
