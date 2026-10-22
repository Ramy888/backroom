import { describe, expect, it } from "vitest";
import { receiptSnapshot } from "../src/receipt.js";

const circle = "6ad9d9e900369e8053e7", visitor = "6ad9aaaa0011visitor9";
const u = (n: number) => `read("user:${circle}-a${n}")`, v = `read("user:${visitor}")`;
const input = {
  circleId: circle, visitor, visitorSeat: 6, winner: "wolves", phases: 3, endedAt: "2026-10-22T10:00:00.000Z", lang: "en" as const,
  seats: [1, 2, 3, 4, 5, 6].map((n) => ({ seat: n, name: n === 6 ? "Your wolf" : `Seat ${n}`, alive: n !== 3 })),
  // After the reveal: seats 1-5 carry the visitor grant added at game end; seat 6 had it all along.
  secrets: [1, 2, 3, 4, 5, 6].map((n) => ({ $id: `${circle}-s${n}-secret`, seat: n, role: n === 3 ? "seer" : n === 2 || n === 6 ? "wolf" : "villager", $permissions: [u(n), v] })),
  logs: [{ classified: "attempt", foreign: 0 }, { classified: "attempt", foreign: 0 }, { classified: "allowed", foreign: 0 }],
  deploy: { deployId: "6ada73ebed30031fdf80", commit: "2524020" },
};

describe("receiptSnapshot", () => {
  it("replaces every user id with a seat label and keeps the during-play permissions", () => {
    const snap = receiptSnapshot(input);
    expect(snap.rows.find((r) => r.seat === 3)).toEqual({ row: "…-s3-secret", seat: 3, role: "seer", readableBy: ["seat 3"] });
    expect(snap.rows.find((r) => r.seat === 6)!.readableBy).toEqual(["seat 6", "visitor"]);
    expect(snap.forbiddenReads).toEqual({ attempted: 2, returned: 0 });
  });
  it("never contains a user id or the circle id", () => {
    const json = JSON.stringify(receiptSnapshot(input));
    expect(json).not.toContain(visitor);
    expect(json).not.toContain(circle);
    expect(json).not.toContain("user:");
  });
  it("labels an unexpected grant instead of leaking it", () => {
    const odd = { ...input, secrets: [{ ...input.secrets[0]!, $permissions: [u(1), 'read("user:someone-else")'] }] };
    expect(receiptSnapshot(odd).rows[0]!.readableBy).toEqual(["another user", "seat 1"]);
    const pub = { ...input, secrets: [{ ...input.secrets[0]!, $permissions: ['read("any")'] }] };
    expect(receiptSnapshot(pub).rows[0]!.readableBy).toEqual(["anyone"]);
  });
  it("refuses to build a receipt that would leak an id through any other field", () => {
    expect(() => receiptSnapshot({ ...input, seats: [{ seat: 1, name: circle, alive: true }] })).toThrow("leak");
  });
});
