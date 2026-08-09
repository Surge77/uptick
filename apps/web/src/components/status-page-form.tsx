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
    <form action={formAction} className="form">
      {state?.error && !state.ok && <div className="banner banner-error">{state.error}</div>}
      {state?.ok && <div className="banner banner-ok">Saved.</div>}

      <div>
        <label className="label" htmlFor="title">
          Title
        </label>
        <input id="title" name="title" className="input" defaultValue={defaults.title} required />
        {errors.title && <div className="error">{errors.title}</div>}
      </div>

      <div>
        <label className="label" htmlFor="slug">
          Public URL
        </label>
        <div className="row" style={{ gap: "0.4rem" }}>
          <span className="small dim">/status/</span>
          <input id="slug" name="slug" className="input" defaultValue={defaults.slug} required />
        </div>
        {errors.slug && <div className="error">{errors.slug}</div>}
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          className="input"
          defaultValue={defaults.description}
          rows={3}
          style={{ resize: "vertical" }}
        />
      </div>

      <label className="check">
        <input type="checkbox" name="isPublic" defaultChecked={defaults.isPublic} />
        Publicly visible
      </label>

      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
