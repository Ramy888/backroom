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
  it("counts rows returned that the seat was not granted", () => {
    expect(foreignRows([{ $id: "c1-s1-secret" }, { $id: "c1-s3-secret" }], own)).toBe(1);
    expect(foreignRows([], own)).toBe(0);
  });
});
