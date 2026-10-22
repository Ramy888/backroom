import { describe, expect, it } from "vitest";
import { classifyCall, foreignRows } from "../src/classify.js";

const own = new Set(["c1-s1-secret"]);

describe("forbidden-read classifier (V6)", () => {
  it("a read of the seat's own granted row is allowed", () => {
    expect(classifyCall({ table: "secrets", rowId: "c1-s1-secret" }, own)).toBe("allowed");
  });
  it("naming another seat's protected row is an attempt", () => {
    expect(classifyCall({ table: "secrets", rowId: "c1-s3-secret" }, own)).toBe("attempt");
    expect(classifyCall({ table: "visions", rowId: "c1-p1-vision" }, own)).toBe("attempt");
  });
  it("any list or query on a protected table is an attempt", () => {
    expect(classifyCall({ table: "night_actions" }, own)).toBe("attempt");
    expect(classifyCall({ table: "den" }, own)).toBe("attempt");
  });
  it("public tables are never attempts", () => {
    expect(classifyCall({ table: "moves" }, own)).toBe("allowed");
    expect(classifyCall({ table: "seats", rowId: "x" }, own)).toBe("allowed");
  });
  it("counts returned rows whose own permissions never granted this seat's user", () => {
    const row = (...perms: string[]) => ({ $permissions: perms });
    // A partner wolf's den row is shared by permission, so it is not foreign; a row granted only to seat 3 is.
    expect(foreignRows([row('read("user:c1-a1")', 'read("user:c1-a6")'), row('read("user:c1-a3")')], "c1-a1")).toBe(1);
    expect(foreignRows([row('read("any")'), row('read("users")')], "c1-a1")).toBe(0);
    expect(foreignRows([row('read("user:c1-a10")')], "c1-a1")).toBe(1); // prefix match is not a grant
    expect(foreignRows([], "c1-a1")).toBe(0);
  });
});
