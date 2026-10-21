import { describe, expect, it } from "vitest";
import { TABLES } from "../src/schema.js";

describe("schema", () => {
  it("stays within the M6 limit of 14 tables", () => {
    expect(TABLES.length).toBeLessThanOrEqual(14);
  });
  it("table ids are unique and every index references real columns", () => {
    expect(new Set(TABLES.map((t) => t.id)).size).toBe(TABLES.length);
    for (const t of TABLES) {
      const keys = new Set(t.columns.map((c) => c.key));
      for (const i of t.indexes) for (const a of i.attributes) expect(keys.has(a), `${t.id}.${i.key} → ${a}`).toBe(true);
    }
  });
  it("every circle-scoped table can be queried by circle (R14: no unindexed scans)", () => {
    for (const t of TABLES.filter((t) => t.columns.some((c) => c.key === "circleId"))) {
      expect(t.indexes.some((i) => i.attributes[0] === "circleId"), t.id).toBe(true);
    }
  });
  it("only the options catalog is public; secrets carry no public column", () => {
    expect(TABLES.filter((t) => t.publicRead).map((t) => t.id)).toEqual(["options"]);
    expect(TABLES.find((t) => t.id === "seats")!.columns.some((c) => c.key === "role")).toBe(false);
  });
});
