import {
  MAX_BODY_BYTES,
  type HttpExchange,
  type HttpRequest,
  type HttpTransport,
} from "@uptick/core";
import { request as undiciRequest } from "undici";

/**
 * Node adapter for the `HttpTransport` port.
 *
 * Two clauses of the port contract are security-critical and easy to violate
 * by accident:
 *
 *  1. `maxRedirections: 0`. undici must NOT follow redirects itself. If it
 *     does, `probeHttp` never observes hop 2 and the per-hop SSRF re-check is
 *     bypassed entirely — while every unit test still passes, because those
 *     inject a fake transport. This single option is the difference between a
 *     working guard and a decorative one.
 *  2. The body is read incrementally and the stream is destroyed at
 *     `MAX_BODY_BYTES`. Buffering first and truncating after is too late: the
 *     memory is already allocated, so a hostile target streaming an endless
 *     response takes the worker down for every tenant.
 */
export const nodeTransport: HttpTransport = async (req: HttpRequest): Promise<HttpExchange> => {
  const startedAt = performance.now();
  let ttfbMs: number | null = null;

  const response = await undiciRequest(req.url, {
    method: req.method as never,
    headers: req.headers,
    body: req.body,
    maxRedirections: 0,
    headersTimeout: req.timeoutMs,
    bodyTimeout: req.timeoutMs,
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
