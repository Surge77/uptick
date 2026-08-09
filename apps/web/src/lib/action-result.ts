import type { z } from "zod";

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** First message per field, so a form shows one error under each input. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) {
      out[key] = issue.message;
    }
  }
  return out;
}

export function invalid(error: z.ZodError): ActionResult {
  return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(error) };
}
