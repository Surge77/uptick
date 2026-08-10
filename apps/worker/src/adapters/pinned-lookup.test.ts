import { describe, expect, it } from "vitest";
import { pinnedLookup } from "./pinned-lookup.js";

/**
 * These tests are the whole DNS-rebinding defence, stated as behaviour.
 *
 * The hostname passed in below never resolves anywhere. If a lookup ever
 * returns an address for it, the address came from the pin — which is exactly
 * the property that must hold, because the alternative is a second DNS query
 * whose answer the monitored host chooses.
 */
const HOSTNAME = "rebind.invalid";

function callAll(pins: readonly string[]): Array<{ address: string; family: number }> {
  const lookup = pinnedLookup(pins);
  let captured: unknown;
  lookup(HOSTNAME, { all: true }, (error, addresses) => {
    if (error) throw error;
    captured = addresses;
  });
  return captured as Array<{ address: string; family: number }>;
}

describe("pinnedLookup", () => {
  it("returns every pinned address with its family when asked for all", () => {
    expect(callAll(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("returns a single address and family when not asked for all", () => {
    const lookup = pinnedLookup(["93.184.216.34", "8.8.8.8"]);
    let seen: [string, number | undefined] | null = null;
    lookup(HOSTNAME, {}, (error, address, family) => {
      if (error) throw error;
      seen = [address as string, family];
    });
    expect(seen).toEqual(["93.184.216.34", 4]);
  });

  it("ignores the hostname entirely, so DNS cannot answer a second time", () => {
    // The rebinding window is closed by never asking again, not by asking and
    // re-checking: a re-check races the very answer it is checking.
    expect(callAll(["93.184.216.34"])).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses an empty pin instead of falling back to DNS", () => {
    // Empty means no address was ever validated. Resolving here would silently
    // restore the unguarded connect this module exists to remove.
    expect(() => pinnedLookup([])).toThrow(/no validated address/i);
  });

  it("refuses a pin that is not an IP address", () => {
    expect(() => pinnedLookup(["example.com"])).toThrow(/not an IP address/i);
  });
});
