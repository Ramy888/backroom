import { describe, expect, it } from "vitest";
import { tallyRound, approvalsComplete, MAX_ROUNDS } from "../src/plan.js";

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
