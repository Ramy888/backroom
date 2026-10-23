import { describe, expect, it } from "vitest";
import { commonChoice, tallyRound, approvalsComplete, MAX_ROUNDS } from "../src/plan.js";

const seats = [{ seat: 1, seatVersion: 2 }, { seat: 2, seatVersion: 1 }, { seat: 3, seatVersion: 1 }];

describe("plan tally (V2/V4/O5)", () => {
  it("consensus when every member accepts the same proposal on fresh limits", () => {
    const r = tallyRound(seats, [
      { seat: 1, proposalId: "p1", vote: "accept", limitsVersion: 2 },
      { seat: 2, proposalId: "p1", vote: "accept", limitsVersion: 1 },
      { seat: 3, proposalId: "p1", vote: "accept", limitsVersion: 1 },
    ], 1);
    expect(r).toEqual({ status: "consensus", proposalId: "p1", stale: [] });
  });
  it("a vote cast on an older limits version is stale and blocks consensus", () => {
    const r = tallyRound(seats, [
      { seat: 1, proposalId: "p1", vote: "accept", limitsVersion: 1 },
      { seat: 2, proposalId: "p1", vote: "accept", limitsVersion: 1 },
      { seat: 3, proposalId: "p1", vote: "accept", limitsVersion: 1 },
    ], 1);
    expect(r).toEqual({ status: "continue", proposalId: null, stale: [1] });
  });
  it("any reject or split proposal continues the negotiation", () => {
    const r = tallyRound(seats, [
      { seat: 1, proposalId: "p1", vote: "accept", limitsVersion: 2 },
      { seat: 2, proposalId: "p2", vote: "accept", limitsVersion: 1 },
      { seat: 3, proposalId: "p1", vote: "reject", limitsVersion: 1 },
    ], 2);
    expect(r.status).toBe("continue");
  });
  it("gives up after the last round", () => {
    expect(tallyRound(seats, [], MAX_ROUNDS + 1).status).toBe("no-consensus");
  });
  it("approvals count only for the current generation, once per member", () => {
    const members = [1, 2, 3];
    expect(approvalsComplete([{ seat: 1, generation: 3 }, { seat: 2, generation: 3 }, { seat: 3, generation: 3 }], 3, members)).toBe(true);
    expect(approvalsComplete([{ seat: 1, generation: 3 }, { seat: 2, generation: 2 }, { seat: 3, generation: 3 }], 3, members)).toBe(false);
    expect(approvalsComplete([{ seat: 1, generation: 3 }, { seat: 1, generation: 3 }, { seat: 3, generation: 3 }], 3, members)).toBe(false);
  });
});

describe("commonChoice (approval voting)", () => {
  const seats = [{ seat: 1, seatVersion: 1 }, { seat: 2, seatVersion: 0 }, { seat: 3, seatVersion: 0 }];
  const price = (id: string) => ({ a: 3100, b: 2900, c: 2400 })[id] ?? 9999;
  const v = (seat: number, acceptable: string[], limitsVersion = seat === 1 ? 1 : 0) => ({ seat, proposalId: acceptable[0] ?? "a", vote: "accept" as const, limitsVersion, acceptable });
  it("picks the cheapest option in everyone's fresh set", () => {
    expect(commonChoice(seats, [v(1, ["a", "b"]), v(2, ["a", "b", "c"]), v(3, ["b", "a"])], price)).toMatchObject({ status: "consensus", proposalId: "b" });
  });
  it("invalidates a set cast on an older limits version", () => {
    const out = commonChoice(seats, [v(1, ["a"], 0), v(2, ["a"]), v(3, ["a"])], price);
    expect(out).toMatchObject({ status: "continue", stale: [1] });
  });
  it("continues when someone has not voted or the sets do not meet", () => {
    expect(commonChoice(seats, [v(1, ["a"]), v(2, ["a"])], price).status).toBe("continue");
    expect(commonChoice(seats, [v(1, ["a"]), v(2, ["b"]), v(3, ["a", "b"])], price).status).toBe("continue");
    expect(commonChoice(seats, [v(1, []), v(2, ["a"]), v(3, ["a"])], price).status).toBe("continue");
  });
  it("breaks a price tie by id, so every run agrees", () => {
    const tie = (id: string) => (id === "x" || id === "y" ? 100 : 999);
    expect(commonChoice(seats, [v(1, ["y", "x"]), v(2, ["x", "y"]), v(3, ["y", "x"])], tie).proposalId).toBe("x");
  });
});
