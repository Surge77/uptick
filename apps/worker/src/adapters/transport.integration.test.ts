import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "@uptick/core";
import { nodeTransport } from "./transport.js";

/**
 * Integration tests for the HTTP transport against a real local server.
 *
 * These exist because the transport is the one component whose correctness
 * cannot be established with an injected fake: it IS the adapter, and the SSRF
 * guarantee depends on how it behaves with a real socket.
 */
let server: Server;
let base: string;
let port: number;

/**
 * The server listens on loopback, which the deny-list forbids — so these tests
 * hand the pin directly rather than going through the guard. That is the point:
 * this file tests the adapter's socket behaviour, and the guard is tested where
 * the guard lives.
 */
const PIN = ["127.0.0.1"];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/final" });
      res.end();
      return;
    }
    if (req.url === "/final") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("arrived");
      return;
    }
    if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "text/plain" });
      // Never ends on its own: only a client-side cap stops this.
      const chunk = "x".repeat(64 * 1024);
      const pump = (): void => {
        if (res.writableEnded) return;
        if (res.write(chunk)) setImmediate(pump);
        else res.once("drain", pump);
      };
      pump();
      return;
    }
    res.writeHead(200, { "x-custom": "yes" });
    res.end("ok");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no address");
  port = address.port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("nodeTransport", () => {
  it("returns a normal response with lower-cased headers", async () => {
    const result = await nodeTransport({
      url: `${base}/`,
      method: "GET",
      headers: {},
      timeoutMs: 5000,
      pinnedAddresses: PIN,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe("ok");
    expect(result.headers["x-custom"]).toBe("yes");
  });

  it("does NOT follow redirects, so probeHttp can re-check each hop", async () => {
    // The single most important assertion about this adapter. If undici ever
    // follows redirects here, the per-hop SSRF check silently stops running
    // and every fake-injected unit test still passes.
    const result = await nodeTransport({
      url: `${base}/redirect`,
      method: "GET",
      headers: {},
      timeoutMs: 5000,
      pinnedAddresses: PIN,
    });

    expect(result.status).toBe(302);
    expect(result.location).toBe("/final");
    expect(result.body).toBe("");
  });

  it("caps an endless response body instead of exhausting memory", async () => {
    const result = await nodeTransport({
      url: `${base}/huge`,
      method: "GET",
      headers: {},
      timeoutMs: 10_000,
      pinnedAddresses: PIN,
    });

    expect(result.body.length).toBe(MAX_BODY_BYTES);
  });

  it("connects to the pinned address and never asks DNS", async () => {
    // `.invalid` is reserved and resolves nowhere, so a response can only mean
    // the socket used the pin. This is the DNS-rebinding defence proved against
    // a real socket rather than a fake: no second lookup exists to poison.
    const result = await nodeTransport({
      url: `http://rebind.invalid:${port}/`,
      method: "GET",
      headers: {},
      timeoutMs: 5000,
      pinnedAddresses: PIN,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe("ok");
  });

  it("refuses to connect when nothing was pinned", async () => {
    // An empty pin means no address was validated. Falling back to DNS here
    // would restore exactly the unguarded connect the pin removes.
    await expect(
      nodeTransport({
        url: `${base}/`,
        method: "GET",
        headers: {},
        timeoutMs: 5000,
        pinnedAddresses: [],
      }),
    ).rejects.toThrow(/no validated address/i);
  });

  it("records time to first byte", async () => {
    const result = await nodeTransport({
      url: `${base}/`,
      method: "GET",
      headers: {},
      timeoutMs: 5000,
      pinnedAddresses: PIN,
    });
    expect(result.timings?.ttfbMs).toBeGreaterThanOrEqual(0);
  });
});
