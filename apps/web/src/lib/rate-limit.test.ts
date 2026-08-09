import { describe, expect, it } from "vitest";
import { slideWindow, type WindowState } from "./rate-limit";

const LIMIT = 10;
const WINDOW = 60_000;
const T0 = 1_000_000;

function drain(state: WindowState | undefined, now: number, times: number): WindowState {
  let s = state;
  for (let i = 0; i < times; i += 1) {
    s = slideWindow(s, now, LIMIT, WINDOW).state;
  }
  if (!s) throw new Error("no state");
  return s;
}

describe("slideWindow", () => {
  it("allows a fresh key", () => {
    const result = slideWindow(undefined, T0, LIMIT, WINDOW);
    expect(result.allowed).toBe(true);
    expect(result.state.current).toBe(1);
  });

  it("blocks once the limit is reached within one window", () => {
    const state = drain(undefined, T0, LIMIT);
    const result = slideWindow(state, T0 + 1, LIMIT, WINDOW);
    expect(result.allowed).toBe(false);
  });

  it("does not admit a double burst across the window boundary", () => {
    // Fill the first window, then fire another full burst just past the
    // boundary. A fixed window would admit all ten; the slide still weights
    // the previous window at ~98%, so only the sliver that has decayed is
    // admitted and the rest are refused.
    let state: WindowState | undefined = drain(undefined, T0, LIMIT);
    let admitted = 0;
    for (let i = 0; i < LIMIT; i += 1) {
      const result = slideWindow(state, T0 + WINDOW + 1_000, LIMIT, WINDOW);
      state = result.state;
      if (result.allowed) admitted += 1;
    }
    expect(admitted).toBeLessThanOrEqual(1);
  });

  it("recovers capacity as the previous window ages out", () => {
    const state = drain(undefined, T0, LIMIT);
    // 90% through the next window, the old burst carries only 10% weight.
    const result = slideWindow(state, T0 + WINDOW + WINDOW * 0.9, LIMIT, WINDOW);
    expect(result.allowed).toBe(true);
  });

  it("fully resets after two idle windows", () => {
    const state = drain(undefined, T0, LIMIT);
    const later = T0 + WINDOW * 2 + 1;
    const result = slideWindow(state, later, LIMIT, WINDOW);
    expect(result.allowed).toBe(true);
    expect(result.state.previous).toBe(0);
    expect(result.state.current).toBe(1);
  });

  it("treats each state independently of wall-clock start alignment", () => {
    // Start mid-window at an arbitrary epoch; behaviour must be identical.
    const offset = 12_345;
    const state = drain(undefined, T0 + offset, LIMIT);
    expect(slideWindow(state, T0 + offset + 1, LIMIT, WINDOW).allowed).toBe(false);
  });

  it("does not mutate the caller's state object", () => {
    const original = slideWindow(undefined, T0, LIMIT, WINDOW).state;
    const snapshot = { ...original };
    slideWindow(original, T0 + 10, LIMIT, WINDOW);
    expect(original).toEqual(snapshot);
  });
});
