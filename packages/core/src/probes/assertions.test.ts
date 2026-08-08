import { describe, expect, it } from "vitest";
import {
  evaluateAssertions,
  isPatternSafe,
  readJsonPath,
  statusMatches,
  summarizeFailures,
} from "./assertions.js";
import type { ResponseFacts } from "./types.js";

const facts = (over: Partial<ResponseFacts> = {}): ResponseFacts => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: '{"status":"ok","data":{"count":3},"flag":true,"nothing":null}',
  latencyMs: 100,
  ...over,
});

describe("statusMatches", () => {
  const cases: Array<[number, number | string | undefined, boolean]> = [
    [200, undefined, true],
    [204, undefined, true],
    [299, undefined, true],
    [300, undefined, false],
    [199, undefined, false],
    [404, undefined, false],
    [204, 204, true],
    [200, 204, false],
    [201, "2xx", true],
    [301, "3xx", true],
    [404, "4xx", true],
    [503, "5xx", true],
    [200, "4xx", false],
    [418, "418", true],
    [418, "419", false],
    [200, "banana", false],
    [200, "6xx", false],
    [201, "2XX", true],
  ];

  it.each(cases)("status %i against %s is %s", (status, expected, result) => {
    expect(statusMatches(status, expected)).toBe(result);
  });

  it("accepts any 2xx by default rather than pinning 200", () => {
    // Pinning 200 produces a false outage the first time an endpoint answers
    // 204 or 206.
    expect(statusMatches(204, undefined)).toBe(true);
  });
});

describe("readJsonPath", () => {
  const value = { data: { user: { name: "ada" }, list: [1, 2] }, top: 1 };

  it("reads a top-level key", () => {
    expect(readJsonPath(value, "top")).toBe(1);
  });

  it("reads a nested key", () => {
    expect(readJsonPath(value, "data.user.name")).toBe("ada");
  });

  it("returns undefined for a missing key", () => {
    expect(readJsonPath(value, "data.missing")).toBeUndefined();
  });

  it("returns undefined when a hop is not an object", () => {
    expect(readJsonPath(value, "top.deeper")).toBeUndefined();
  });

  it("returns undefined when traversing through null", () => {
    expect(readJsonPath({ a: null }, "a.b")).toBeUndefined();
  });

  it("returns the whole value for an empty path", () => {
    expect(readJsonPath(value, "")).toBe(value);
  });
});

describe("evaluateAssertions", () => {
  it("passes with no assertions on a 200", () => {
    expect(evaluateAssertions(facts(), {})).toEqual([]);
  });

  it("fails on an unexpected status", () => {
    const failures = evaluateAssertions(facts({ statusCode: 500 }), {});
    expect(failures).toHaveLength(1);
    expect(failures[0]!.assertion).toBe("expectedStatus");
    expect(failures[0]!.detail).toContain("500");
  });

  it("passes bodyContains when present", () => {
    expect(evaluateAssertions(facts(), { bodyContains: '"status":"ok"' })).toEqual([]);
  });

  it("fails bodyContains when absent", () => {
    const failures = evaluateAssertions(facts(), { bodyContains: "healthy" });
    expect(failures[0]!.assertion).toBe("bodyContains");
  });

  it("fails bodyNotContains when the forbidden text is present", () => {
    const failures = evaluateAssertions(facts({ body: "fatal error" }), {
      bodyNotContains: "error",
    });
    expect(failures[0]!.assertion).toBe("bodyNotContains");
  });

  it("passes bodyNotContains when the text is absent", () => {
    expect(evaluateAssertions(facts({ body: "all good" }), { bodyNotContains: "error" })).toEqual(
      [],
    );
  });

  it("passes bodyMatches on a matching pattern", () => {
    expect(evaluateAssertions(facts(), { bodyMatches: '"status"\\s*:\\s*"ok"' })).toEqual([]);
  });

  it("fails bodyMatches on a non-matching pattern", () => {
    const failures = evaluateAssertions(facts(), { bodyMatches: "^never$" });
    expect(failures[0]!.assertion).toBe("bodyMatches");
  });

  it("reports an invalid regex as a configuration problem, not a crash", () => {
    const failures = evaluateAssertions(facts(), { bodyMatches: "([unclosed" });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toContain("Invalid regular expression");
  });

  describe("jsonPath", () => {
    it("passes when the value matches", () => {
      expect(evaluateAssertions(facts(), { jsonPath: "status", jsonEquals: "ok" })).toEqual([]);
    });

    it("passes on a nested numeric value", () => {
      expect(evaluateAssertions(facts(), { jsonPath: "data.count", jsonEquals: 3 })).toEqual([]);
    });

    it("passes on a boolean value", () => {
      expect(evaluateAssertions(facts(), { jsonPath: "flag", jsonEquals: true })).toEqual([]);
    });

    it("passes on an explicit null value", () => {
      expect(evaluateAssertions(facts(), { jsonPath: "nothing", jsonEquals: null })).toEqual([]);
    });

    it("fails when the value differs", () => {
      const failures = evaluateAssertions(facts(), { jsonPath: "status", jsonEquals: "degraded" });
      expect(failures[0]!.detail).toContain("degraded");
    });

    it("fails when the body is not JSON", () => {
      const failures = evaluateAssertions(facts({ body: "<html>" }), {
        jsonPath: "status",
        jsonEquals: "ok",
      });
      expect(failures).toHaveLength(1);
      expect(failures[0]!.detail).toContain("not valid JSON");
    });
  });

  describe("headerEquals", () => {
    it("matches a header case-insensitively", () => {
      // RFC 9110 header names are case-insensitive; a verbatim comparison would
      // fail against a compliant server.
      expect(
        evaluateAssertions(facts(), { headerEquals: { "Content-Type": "application/json" } }),
      ).toEqual([]);
    });

    it("fails on a differing value", () => {
      const failures = evaluateAssertions(facts(), {
        headerEquals: { "content-type": "text/html" },
      });
      expect(failures[0]!.assertion).toBe("headerEquals");
    });

    it("fails on a missing header", () => {
      const failures = evaluateAssertions(facts(), { headerEquals: { "x-version": "2" } });
      expect(failures[0]!.detail).toContain("null");
    });
  });

  describe("maxLatencyMs", () => {
    it("passes under the limit", () => {
      expect(evaluateAssertions(facts({ latencyMs: 100 }), { maxLatencyMs: 200 })).toEqual([]);
    });

    it("passes exactly on the limit", () => {
      expect(evaluateAssertions(facts({ latencyMs: 200 }), { maxLatencyMs: 200 })).toEqual([]);
    });

    it("fails over the limit", () => {
      const failures = evaluateAssertions(facts({ latencyMs: 201 }), { maxLatencyMs: 200 });
      expect(failures[0]!.assertion).toBe("maxLatencyMs");
    });
  });

  it("collects every failure rather than stopping at the first", () => {
    // An incident cause should say what actually went wrong, not just the
    // first thing checked.
    const failures = evaluateAssertions(facts({ statusCode: 500, body: "boom", latencyMs: 999 }), {
      expectedStatus: 200,
      bodyContains: "ok",
      maxLatencyMs: 100,
    });
    expect(failures).toHaveLength(3);
    expect(failures.map((f) => f.assertion)).toEqual([
      "expectedStatus",
      "bodyContains",
      "maxLatencyMs",
    ]);
  });
});

describe("summarizeFailures", () => {
  it("returns null for no failures", () => {
    expect(summarizeFailures([])).toBeNull();
  });

  it("returns the detail verbatim for one failure", () => {
    expect(summarizeFailures([{ assertion: "a", detail: "boom" }])).toBe("boom");
  });

  it("counts the remainder for several failures", () => {
    expect(
      summarizeFailures([
        { assertion: "a", detail: "boom" },
        { assertion: "b", detail: "bang" },
        { assertion: "c", detail: "crash" },
      ]),
    ).toBe("boom (and 2 more)");
  });
});

describe("isPatternSafe", () => {
  const unsafe = ["^(a+)+$", "(a*)*", "(a+)*b", "(a|aa)+", "(x|y|xy)*", "a".repeat(600)];

  it.each(unsafe)("rejects %s", (pattern) => {
    expect(isPatternSafe(pattern)).toBe(false);
  });

  const safe = ["^ok$", "status.*healthy", "[0-9]{3}", "(foo|bar)", "a+b+"];

  it.each(safe)("accepts %s", (pattern) => {
    expect(isPatternSafe(pattern)).toBe(true);
  });
});

describe("ReDoS protection", () => {
  it("refuses a catastrophic pattern instead of running it", () => {
    // Node cannot time out a regex. On a shared worker, one tenant's (a+)+
    // against a large body pins the event loop and silently stops every other
    // tenant's checks - which for an uptime product looks like "all is well".
    const failures = evaluateAssertions(
      { statusCode: 200, headers: {}, body: "a".repeat(200) + "b", latencyMs: 1 },
      { bodyMatches: "^(a+)+$" },
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]!.detail).toContain("backtracking");
  });
});
