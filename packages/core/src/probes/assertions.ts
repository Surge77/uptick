import type { HttpAssertions, ResponseFacts } from "./types.js";

/** Longest user-supplied pattern accepted. */
export const MAX_PATTERN_LENGTH = 512;

/**
 * Reject patterns whose shape permits catastrophic backtracking.
 *
 * Node cannot time out a regex, and this runs on the shared worker event loop:
 * one tenant's `^(a+)+$` against a 50KB body pins the process and silently
 * stops every other tenant's checks. For an uptime product that is the worst
 * failure mode there is, because it looks exactly like "everything is fine".
 *
 * A shape check is conservative, not exhaustive - it rejects nested quantifiers
 * and quantified alternations, which covers the classic exponential cases.
 */
export function isPatternSafe(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  // (a+)+ / (a*)* / (a+)* - a quantified group whose body is itself quantified.
  if (/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern)) return false;
  // (a|aa)+ - a quantified alternation.
  if (/\([^)]*\|[^)]*\)\s*[+*{]/.test(pattern)) return false;
  return true;
}

export interface AssertionFailure {
  assertion: string;
  detail: string;
}

/** Read a dot path out of parsed JSON. Returns undefined if any hop is absent. */
export function readJsonPath(value: unknown, path: string): unknown {
  const segments = path.split(".").filter((s) => s.length > 0);
  let current: unknown = value;

  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Whether a status code satisfies an expectation.
 *
 * Accepts an exact code (`204`) or a class (`2xx`). A monitor that only says
 * "should be up" wants any success, not specifically 200 — pinning the exact
 * code produces false outages the first time an endpoint returns 204 or 206.
 */
export function statusMatches(status: number, expected: number | string | undefined): boolean {
  if (expected === undefined) return status >= 200 && status < 300;
  if (typeof expected === "number") return status === expected;

  const normalized = expected.trim().toLowerCase();
  if (/^\d{3}$/.test(normalized)) return status === Number(normalized);

  const classMatch = /^([1-5])xx$/.exec(normalized);
  if (classMatch) {
    const hundreds = Number(classMatch[1]);
    return Math.floor(status / 100) === hundreds;
  }
  return false;
}

/**
 * Evaluate every assertion against a response.
 *
 * All failures are collected rather than short-circuiting, so an incident's
 * cause can say what actually went wrong instead of only the first thing
 * checked.
 */
export function evaluateAssertions(
  facts: ResponseFacts,
  assertions: HttpAssertions,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];

  if (!statusMatches(facts.statusCode, assertions.expectedStatus)) {
    failures.push({
      assertion: "expectedStatus",
      detail: `Expected ${assertions.expectedStatus ?? "2xx"}, got ${facts.statusCode}`,
    });
  }

  if (assertions.bodyContains !== undefined && !facts.body.includes(assertions.bodyContains)) {
    failures.push({
      assertion: "bodyContains",
      detail: `Body does not contain ${JSON.stringify(assertions.bodyContains)}`,
    });
  }

  if (assertions.bodyNotContains !== undefined && facts.body.includes(assertions.bodyNotContains)) {
    failures.push({
      assertion: "bodyNotContains",
      detail: `Body contains forbidden ${JSON.stringify(assertions.bodyNotContains)}`,
    });
  }

  if (assertions.bodyMatches !== undefined) {
    if (!isPatternSafe(assertions.bodyMatches)) {
      failures.push({
        assertion: "bodyMatches",
        detail: "Pattern rejected: nested quantifiers risk catastrophic backtracking",
      });
    } else
      try {
        if (!new RegExp(assertions.bodyMatches).test(facts.body)) {
          failures.push({
            assertion: "bodyMatches",
            detail: `Body does not match /${assertions.bodyMatches}/`,
          });
        }
      } catch {
        // A malformed pattern is a configuration error, not an outage. Reporting
        // it as a failed assertion surfaces it without paging as if the service
        // were down for a different reason.
        failures.push({
          assertion: "bodyMatches",
          detail: `Invalid regular expression: ${assertions.bodyMatches}`,
        });
      }
  }

  if (assertions.jsonPath !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(facts.body);
    } catch {
      failures.push({ assertion: "jsonPath", detail: "Response body is not valid JSON" });
      parsed = undefined;
    }

    if (parsed !== undefined) {
      const actual = readJsonPath(parsed, assertions.jsonPath);
      const expected = assertions.jsonEquals;
      if (actual !== expected) {
        failures.push({
          assertion: "jsonPath",
          detail: `${assertions.jsonPath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        });
      }
    }
  }

  if (assertions.headerEquals) {
    for (const [name, expected] of Object.entries(assertions.headerEquals)) {
      // Header names are case-insensitive per RFC 9110; comparing them
      // verbatim would make assertions fail against a compliant server.
      const actual = facts.headers[name.toLowerCase()];
      if (actual !== expected) {
        failures.push({
          assertion: "headerEquals",
          detail: `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`,
        });
      }
    }
  }

  if (assertions.maxLatencyMs !== undefined && facts.latencyMs > assertions.maxLatencyMs) {
    failures.push({
      assertion: "maxLatencyMs",
      detail: `Took ${facts.latencyMs}ms, limit ${assertions.maxLatencyMs}ms`,
    });
  }

  return failures;
}

/** One-line summary of why a probe failed, for `Incident.cause`. */
export function summarizeFailures(failures: readonly AssertionFailure[]): string | null {
  if (failures.length === 0) return null;
  if (failures.length === 1) return failures[0]!.detail;
  return `${failures[0]!.detail} (and ${failures.length - 1} more)`;
}
