import { request as undiciRequest } from "undici";
import type { DeliveryDeps } from "../herald/channels.js";
import { nodeResolver } from "./resolver.js";

/**
 * Node adapters for notification delivery.
 *
 * The Resend client is constructed per call rather than at module load. A
 * module-level client throws during CI builds, where no key is present, and a
 * missing key must degrade to a clear delivery error rather than a crash at
 * import time.
 */

const DELIVERY_TIMEOUT_MS = 10_000;

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<number> {
  const response = await undiciRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    headersTimeout: DELIVERY_TIMEOUT_MS,
    bodyTimeout: DELIVERY_TIMEOUT_MS,
  });
  // Drain so the socket is released back to the pool.
  await response.body.text().catch(() => undefined);
  return response.statusCode;
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Email channel is not configured (RESEND_API_KEY / ALERT_FROM_EMAIL)");
  }

  const status = await post(
    "https://api.resend.com/emails",
    { from, to, subject, text },
    { authorization: `Bearer ${apiKey}` },
  );

  if (status < 200 || status >= 300) {
    // Never include the key or the response body: both can carry the address
    // and the credential into logs.
    throw new Error(`Email provider rejected the delivery with status ${status}`);
  }
}

export const nodeDeliveryDeps: DeliveryDeps = { post, sendEmail, resolve: nodeResolver };
