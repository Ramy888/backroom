import { describe, expect, it } from "vitest";
import { phaseKind, resolveNight, resolveVote, winner, nextPhase, MAX_CYCLES, type Seat } from "../src/rules.js";

// Fixed 6-seat ruleset (docs/designs/backroom.md M12): wolves 1 (visitor) and 2, seer 3, villagers 4-6.
const seats = (): Seat[] => [
  { seat: 1, role: "wolf", alive: true, visitor: true },
  { seat: 2, role: "wolf", alive: true },
  { seat: 3, role: "seer", alive: true },
  { seat: 4, role: "villager", alive: true },
  { seat: 5, role: "villager", alive: true },
  { seat: 6, role: "villager", alive: true },
];

describe("phase sequence", () => {
  it("cycles night → day → vote", () => {
    expect([1, 2, 3, 4].map(phaseKind)).toEqual(["night", "day", "vote", "night"]);
  });
  it("ends at dawn after the last cycle's vote", () => {
    expect(nextPhase(MAX_CYCLES * 3)).toBe("dawn");
    expect(nextPhase(1)).toBe(2);
  });
});

describe("night", () => {
  it("kills the wolves' agreed target and records the seer's vision", () => {
    const r = resolveNight(seats(), { kills: { 1: 4, 2: 4 }, seerCheck: 2 });
    expect(r.eliminated).toBe(4);
    expect(r.vision).toEqual({ seer: 3, target: 2, isWolf: true });
  });
  it("when wolves disagree, the visitor's wolf (Wolf 1) decides", () => {
    expect(resolveNight(seats(), { kills: { 1: 5, 2: 6 } }).eliminated).toBe(5);
  });
  it("an abstaining wolf defers to the other; both abstaining kills nobody", () => {
    expect(resolveNight(seats(), { kills: { 2: 6 } }).eliminated).toBe(6);
    expect(resolveNight(seats(), { kills: {} }).eliminated).toBeNull();
  });
  it("ignores kills on fellow wolves or dead seats, and seer checks on self or the dead", () => {
    const s = seats(); s[4]!.alive = false;
    const r = resolveNight(s, { kills: { 1: 2, 2: 5 }, seerCheck: 3 });
    expect(r.eliminated).toBeNull();
    expect(r.vision).toBeNull();
  });
  it("a dead seer gets no vision", () => {
    const s = seats(); s[2]!.alive = false;
    expect(resolveNight(s, { kills: {}, seerCheck: 1 }).vision).toBeNull();
  });
});

describe("vote", () => {
  it("plurality eliminates", () => {
    expect(resolveVote(seats(), { 1: 4, 2: 4, 3: 1, 4: 1, 5: 4 })).toBe(4);
  });
  it("a tie, or no votes, eliminates nobody", () => {
    expect(resolveVote(seats(), { 1: 4, 2: 4, 3: 1, 4: 1 })).toBeNull();
    expect(resolveVote(seats(), {})).toBeNull();
  });
  it("dead voters and votes for dead or unknown seats don't count", () => {
    const s = seats(); s[5]!.alive = false;
    expect(resolveVote(s, { 6: 3, 1: 6, 2: 9, 4: 3 })).toBe(3);
  });
});

describe("win check", () => {
  it("wolves win at parity", () => {
    const s = seats(); for (const i of [2, 3, 4]) s[i]!.alive = false;
    expect(winner(s)).toBe("wolves");
  });
  it("village wins when the last wolf dies", () => {
    const s = seats(); s[0]!.alive = false; s[1]!.alive = false;
    expect(winner(s)).toBe("village");
  });
  it("no winner while wolves are outnumbered", () => {
    expect(winner(seats())).toBeNull();
  });
});
