import { describe, expect, it, vi } from "vitest";
import { assertTargetAllowed, probeHttp, type HttpProbeDeps } from "./http.js";
import type { HttpExchange, HttpRequest } from "./types.js";

/** Resolver that maps hostnames to fixed addresses; unknown names fail. */
function resolver(map: Record<string, string[]>) {
  return async (hostname: string): Promise<string[]> => {
    const found = map[hostname];
    if (!found) throw new Error(`ENOTFOUND ${hostname}`);
    return found;
  };
}

const PUBLIC = resolver({
  "example.com": ["93.184.216.34"],
  "evil.com": ["93.184.216.35"],
  "internal.example.com": ["10.0.0.5"],
});

/** Advances 10ms per call so latency is deterministic. */
function stepClock(stepMs = 10) {
  let t = 0;
  return () => {
    const current = t;
    t += stepMs;
    return current;
  };
}

function deps(
  responses: HttpExchange[] | ((req: HttpRequest) => Promise<HttpExchange>),
  resolve = PUBLIC,
): HttpProbeDeps & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;

  const transport = async (request: HttpRequest): Promise<HttpExchange> => {
    calls.push(request);
    if (queue) {
      const next = queue.shift();
      if (!next) throw new Error("transport called more times than expected");
      return next;
    }
    return responses(request);
  };

  return { transport, resolve, now: stepClock(), calls };
}

const ok = (over: Partial<HttpExchange> = {}): HttpExchange => ({
  status: 200,
  headers: { "content-type": "text/plain" },
  body: "ok",
  ...over,
});

describe("assertTargetAllowed", () => {
  it("allows a public host", async () => {
    expect(await assertTargetAllowed("https://example.com/", PUBLIC)).toBeNull();
  });

  it("blocks a host that resolves to a private address", async () => {
    // The core guarantee: the hostname looks fine, the resolved address does not.
    const reason = await assertTargetAllowed("https://internal.example.com/", PUBLIC);
    expect(reason).toContain("10.0.0.5");
    expect(reason).toContain("private");
  });

  it("blocks when ANY resolved address is private", async () => {
    // A name with one public and one private A record must be refused. Checking
    // only the first would make blocking depend on resolver ordering.
    const mixed = resolver({ "mixed.com": ["93.184.216.34", "127.0.0.1"] });
    const reason = await assertTargetAllowed("https://mixed.com/", mixed);
    expect(reason).toContain("127.0.0.1");
  });

  it("reports a resolution failure rather than proceeding", async () => {
    const reason = await assertTargetAllowed("https://nowhere.com/", PUBLIC);
    expect(reason).toContain("DNS resolution failed");
  });

  it("refuses a host that resolves to nothing", async () => {
    const empty = resolver({ "empty.com": [] });
    const reason = await assertTargetAllowed("https://empty.com/", empty);
    expect(reason).toContain("no addresses");
  });

  it("rejects a disallowed protocol before resolving", async () => {
    const resolve = vi.fn(async () => ["93.184.216.34"]);
    const reason = await assertTargetAllowed("file:///etc/passwd", resolve);
    expect(reason).toContain("Protocol not allowed");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a literal private address without resolving", async () => {
    const resolve = vi.fn(async () => []);
    expect(await assertTargetAllowed("http://169.254.169.254/", resolve)).toContain("metadata");
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("probeHttp", () => {
  const base = { url: "https://example.com/health", timeoutMs: 5000 };

  it("succeeds on a 200", async () => {
    const d = deps([ok()]);
    const result = await probeHttp(base, d);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it("fails when an assertion fails but still records the status", async () => {
    const d = deps([ok({ status: 503, body: "down" })]);
    const result = await probeHttp(base, d);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error).toContain("503");
  });

  it("passes assertions through to the evaluator", async () => {
    const d = deps([ok({ body: '{"status":"ok"}' })]);
    const result = await probeHttp(
      { ...base, assertions: { jsonPath: "status", jsonEquals: "ok" } },
      d,
    );
    expect(result.ok).toBe(true);
  });

  it("sends the configured method, headers and body", async () => {
    const d = deps([ok()]);
    await probeHttp({ ...base, method: "POST", headers: { "x-token": "abc" }, body: "payload" }, d);

    expect(d.calls[0]!.method).toBe("POST");
    expect(d.calls[0]!.headers).toEqual({ "x-token": "abc" });
    expect(d.calls[0]!.body).toBe("payload");
  });

  it("records transport errors as a failure rather than throwing", async () => {
    const d = deps(async () => {
      throw new Error("ETIMEDOUT");
    });
    const result = await probeHttp(base, d);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("ETIMEDOUT");
    expect(result.statusCode).toBeNull();
  });

  it("carries per-phase timings through", async () => {
    const d = deps([ok({ timings: { dnsMs: 5, connectMs: 12, tlsMs: 30, ttfbMs: 88 } })]);
    const result = await probeHttp(base, d);

    expect(result.dnsMs).toBe(5);
    expect(result.tlsMs).toBe(30);
    expect(result.ttfbMs).toBe(88);
  });

  it("reports null timings when the transport supplies none", async () => {
    const result = await probeHttp(base, deps([ok()]));
    expect(result.dnsMs).toBeNull();
  });

  describe("redirects", () => {
    it("follows a redirect and reports the final response", async () => {
      const d = deps([
        ok({ status: 302, location: "https://example.com/final" }),
        ok({ status: 200, body: "arrived" }),
      ]);
      const result = await probeHttp(base, d);

      expect(result.ok).toBe(true);
      expect(d.calls.map((c) => c.url)).toEqual([
        "https://example.com/health",
        "https://example.com/final",
      ]);
    });

    it("resolves a relative redirect against the current URL", async () => {
      const d = deps([ok({ status: 301, location: "/moved" }), ok()]);
      await probeHttp(base, d);
      expect(d.calls[1]!.url).toBe("https://example.com/moved");
    });

    it("RE-VALIDATES the target on every redirect hop", async () => {
      // The bypass this closes: a public first hop redirecting to cloud
      // metadata. Validating only the initial URL would let this through.
      const d = deps([ok({ status: 302, location: "http://169.254.169.254/latest/meta-data/" })]);
      const result = await probeHttp({ ...base, url: "http://example.com/health" }, d);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("metadata");
      expect(d.calls).toHaveLength(1);
    });

    it("refuses an https to http downgrade", async () => {
      // Otherwise a monitored host can have its request replayed in plaintext.
      const d = deps([ok({ status: 302, location: "http://example.com/insecure" })]);
      const result = await probeHttp(base, d);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("downgrade");
      expect(d.calls).toHaveLength(1);
    });

    it("strips credential headers when the redirect crosses origin", async () => {
      // An open redirect on the monitored host would otherwise hand the user's
      // production bearer token to whatever origin it points at.
      const d = deps([ok({ status: 302, location: "https://evil.com/collect" }), ok()]);
      await probeHttp(
        { ...base, headers: { Authorization: "Bearer secret", "X-Trace": "keep" } },
        d,
      );

      expect(d.calls[0]!.headers).toHaveProperty("Authorization");
      expect(d.calls[1]!.headers).not.toHaveProperty("Authorization");
      expect(d.calls[1]!.headers["X-Trace"]).toBe("keep");
    });

    it("keeps credential headers on a same-origin redirect", async () => {
      const d = deps([ok({ status: 302, location: "https://example.com/next" }), ok()]);
      await probeHttp({ ...base, headers: { Authorization: "Bearer secret" } }, d);
      expect(d.calls[1]!.headers).toHaveProperty("Authorization");
    });

    it("converts a 303 to GET and drops the body", async () => {
      // RFC 9110. Preserving the method replays the user's POST body at the
      // redirect target.
      const d = deps([ok({ status: 303, location: "https://example.com/done" }), ok()]);
      await probeHttp({ ...base, method: "POST", body: "payload" }, d);

      expect(d.calls[1]!.method).toBe("GET");
      expect(d.calls[1]!.body).toBeUndefined();
    });

    it("preserves the method on a 307", async () => {
      const d = deps([ok({ status: 307, location: "https://example.com/done" }), ok()]);
      await probeHttp({ ...base, method: "POST", body: "payload" }, d);

      expect(d.calls[1]!.method).toBe("POST");
      expect(d.calls[1]!.body).toBe("payload");
    });

    it("blocks a redirect to a host that resolves privately", async () => {
      const d = deps([ok({ status: 307, location: "https://internal.example.com/" })]);
      const result = await probeHttp(base, d);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("10.0.0.5");
    });

    it("blocks a redirect to a disallowed protocol", async () => {
      const d = deps([ok({ status: 302, location: "file:///etc/passwd" })]);
      const result = await probeHttp(base, d);
      expect(result.error).toContain("Protocol not allowed");
    });

    it("caps the redirect chain instead of looping forever", async () => {
      const d = deps(async () => ok({ status: 302, location: "https://example.com/loop" }));
      const result = await probeHttp({ ...base, maxRedirects: 3 }, d);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Too many redirects");
      expect(d.calls).toHaveLength(4);
    });

    it("rejects an unparseable redirect location", async () => {
      const d = deps([ok({ status: 302, location: "http://[malformed" })]);
      const result = await probeHttp(base, d);
      expect(result.error).toContain("Invalid redirect location");
    });

    it("does not follow a redirect status with no location header", async () => {
      const d = deps([ok({ status: 302, location: null })]);
      const result = await probeHttp({ ...base, assertions: { expectedStatus: "3xx" } }, d);

      expect(result.ok).toBe(true);
      expect(result.statusCode).toBe(302);
      expect(d.calls).toHaveLength(1);
    });

    it("follows every redirect status it should", async () => {
      for (const status of [301, 302, 303, 307, 308]) {
        const d = deps([ok({ status, location: "https://example.com/next" }), ok()]);
        await probeHttp(base, d);
        expect(d.calls).toHaveLength(2);
      }
    });
  });

  it("refuses the initial target when it resolves privately", async () => {
    const d = deps([ok()]);
    const result = await probeHttp({ ...base, url: "https://internal.example.com/" }, d);

    expect(result.ok).toBe(false);
    expect(d.calls).toHaveLength(0);
  });
});
