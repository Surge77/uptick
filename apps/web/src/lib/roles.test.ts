import { describe, expect, it } from "vitest";
import { canWrite } from "./roles";

describe("canWrite", () => {
  it("allows owners to change monitors", () => {
    expect(canWrite("OWNER")).toBe(true);
  });

  it("allows admins to change monitors", () => {
    expect(canWrite("ADMIN")).toBe(true);
  });

  it("denies members, who have read-only access", () => {
    expect(canWrite("MEMBER")).toBe(false);
  });
});
