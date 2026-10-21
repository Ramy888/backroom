import { describe, expect, it } from "vitest";
import { permsFor, type CircleView } from "../src/perms.js";

const circle: CircleView = {
  visitor: "visitor",
  seats: [
    { seat: 1, user: "a1", role: "wolf", visitor: true },
    { seat: 2, user: "a2", role: "wolf" },
    { seat: 3, user: "a3", role: "seer" },
    { seat: 4, user: "a4", role: "villager" },
  ],
};

describe("permission matrix (the product's guarantee lives here)", () => {
  it("is frozen: any change to who-reads-what must be deliberate", () => {
    const all = {
      public: permsFor("public", circle),
      secretWolf1: permsFor("secret", circle, 1),
      secretSeer: permsFor("secret", circle, 3),
      nightWolf: permsFor("night", circle, 2),
      nightSeer: permsFor("night", circle, 3),
      vision: permsFor("vision", circle, 3),
      den: permsFor("den", circle),
      turnlogVisitorSeat: permsFor("turnlog", circle, 1),
      turnlogOther: permsFor("turnlog", circle, 4),
      receipt: permsFor("receipt", circle),
    };
    expect(all).toMatchInlineSnapshot(`
      {
        "den": [
          "read("user:a1")",
          "read("user:a2")",
          "read("user:visitor")",
        ],
        "nightSeer": [
          "read("user:a3")",
        ],
        "nightWolf": [
          "read("user:a1")",
          "read("user:a2")",
          "read("user:visitor")",
        ],
        "public": [
          "read("user:a1")",
          "read("user:a2")",
          "read("user:a3")",
          "read("user:a4")",
          "read("user:visitor")",
        ],
        "receipt": [
          "read("any")",
        ],
        "secretSeer": [
          "read("user:a3")",
        ],
        "secretWolf1": [
          "read("user:a1")",
          "read("user:visitor")",
        ],
        "turnlogOther": [],
        "turnlogVisitorSeat": [
          "read("user:visitor")",
        ],
        "vision": [
          "read("user:a3")",
        ],
      }
    `);
  });
  it("never grants any client write or update", () => {
    for (const t of ["public", "secret", "night", "vision", "den", "turnlog", "receipt"] as const) {
      for (const p of permsFor(t, circle, t === "vision" ? 3 : 1)) expect(p.startsWith("read(")).toBe(true);
    }
  });
  it("vision is seer-only and refuses a non-seer seat", () => {
    expect(() => permsFor("vision", circle, 1)).toThrow();
  });
  it("seat-scoped tables require a seat that exists", () => {
    expect(() => permsFor("secret", circle)).toThrow();
    expect(() => permsFor("night", circle, 9)).toThrow();
  });
});
