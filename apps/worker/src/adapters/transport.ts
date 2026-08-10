import {
  MAX_BODY_BYTES,
  type HttpExchange,
  type HttpRequest,
  type HttpTransport,
} from "@uptick/core";
import { Agent, request as undiciRequest } from "undici";
import { pinnedLookup } from "./pinned-lookup.js";

/**
 * Node adapter for the `HttpTransport` port.
 *
 * Three clauses of the port contract are security-critical and easy to violate
 * by accident:
 *
 *  1. Redirects must NOT be followed here. `undici.request` does not follow
 *     them unless a redirect interceptor is installed, so this adapter simply
 *     never installs one. That is easy to undo by accident, which is why
 *     `transport.integration.test.ts` asserts against a real local server that
 *     a 302 comes back as a 302: if undici ever followed it, `probeHttp` would
 *     never observe hop 2 and the per-hop SSRF re-check would be bypassed —
 *     while every fake-injected unit test still passed.
 *  2. The body is read incrementally and the stream is destroyed at
 *     `MAX_BODY_BYTES`. Buffering first and truncating after is too late: the
 *     memory is already allocated, so a hostile target streaming an endless
 *     response takes the worker down for every tenant.
 *  3. The connection is pinned to `req.pinnedAddresses` with a custom lookup,
 *     so undici never re-resolves the hostname the guard already validated.
 *
 * The Agent is per-request because the pin is per-request. Sharing one would
 * mean either sharing a pin across targets or keying a pool by address set, and
 * a probe opens one connection per interval anyway — keep-alive across a 60s
 * gap saves nothing real.
 */
export const nodeTransport: HttpTransport = async (req: HttpRequest): Promise<HttpExchange> => {
  const startedAt = performance.now();
  let ttfbMs: number | null = null;

  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(req.pinnedAddresses) } });

  try {
    const response = await undiciRequest(req.url, {
      method: req.method as never,
      headers: req.headers,
      body: req.body,
      headersTimeout: req.timeoutMs,
      bodyTimeout: req.timeoutMs,
      dispatcher,
    });

    ttfbMs = Math.round(performance.now() - startedAt);

    const body = await readCapped(response.body);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    }

    return {
      status: response.statusCode,
      headers,
      body,
      location: headers.location ?? null,
      timings: { ttfbMs },
    };
  } finally {
    // `destroy`, not `close`: everything wanted from the response has been read
    // by now, and `close` waits for requests to finish — including the endless
    // body this adapter deliberately abandons at MAX_BODY_BYTES. A leaked Agent
    // holds its sockets and timers, once per check per monitor.
    await dispatcher.destroy();
  }
};

/**
 * Read a response body, aborting once the cap is reached.
 *
 * Destroying the stream matters as much as the size check: without it the
 * remote keeps sending and the socket stays open for the full timeout.
 */
async function readCapped(
  stream: AsyncIterable<Buffer> & { destroy?: () => void },
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    total += chunk.length;
    if (total >= MAX_BODY_BYTES) {
      chunks.push(chunk.subarray(0, chunk.length - (total - MAX_BODY_BYTES)));
      stream.destroy?.();
      break;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
