import { resolveAllowedTarget } from "@uptick/core";
import { Agent, request as undiciRequest } from "undici";
import type { DeliveryDeps, PostRequest } from "../herald/channels.js";
import { pinnedLookup } from "./pinned-lookup.js";
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
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * There is deliberately no way to post without a pin. The email endpoint below
 * is a first-party constant and could not be rebound, but an "unpinned" branch
 * is the kind of convenience that a later user-supplied URL quietly reuses.
 */
async function post(request: PostRequest): Promise<number> {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(request.pinnedAddresses) } });

  try {
    const response = await undiciRequest(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
      headersTimeout: DELIVERY_TIMEOUT_MS,
      bodyTimeout: DELIVERY_TIMEOUT_MS,
      dispatcher,
    });
    // Drain so the socket is released before the dispatcher goes away.
    await response.body.text().catch(() => undefined);
    return response.statusCode;
  } finally {
    await dispatcher.destroy();
  }
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Email channel is not configured (RESEND_API_KEY / ALERT_FROM_EMAIL)");
  }

  const target = await resolveAllowedTarget(RESEND_ENDPOINT, nodeResolver);
  if (!target.allowed) throw new Error(`Email provider unreachable: ${target.reason}`);

  const status = await post({
    url: RESEND_ENDPOINT,
    body: { from, to, subject, text },
    headers: { authorization: `Bearer ${apiKey}` },
    pinnedAddresses: target.addresses,
  });

  if (status < 200 || status >= 300) {
    // Never include the key or the response body: both can carry the address
    // and the credential into logs.
    throw new Error(`Email provider rejected the delivery with status ${status}`);
  }
}

export const nodeDeliveryDeps: DeliveryDeps = { post, sendEmail, resolve: nodeResolver };
