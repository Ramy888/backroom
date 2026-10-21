import { describe, expect, it } from "vitest";
import { turnId, closeId, seatRowId, secretId, agentUserId, dispatchId, approvalId, candidateId, parseTurnId } from "../src/ids.js";

describe("deterministic ids", () => {
  it("same inputs give the same id, so a duplicate create collides", () => {
    expect(turnId("c91", 3, 2)).toBe(turnId("c91", 3, 2));
  });
  it("differs per seat and phase", () => {
    expect(turnId("c91", 3, 2)).not.toBe(turnId("c91", 3, 4));
    expect(turnId("c91", 3, 2)).not.toBe(turnId("c91", 4, 2));
  });
  it("fits Appwrite's 36-char [a-zA-Z0-9._-] id rule", () => {
    for (const id of [turnId("abcdefghijklmnopqrst", 8, 6), closeId("abcdefghijklmnopqrst", 8)]) {
      expect(id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/);
    }
  });
});

describe("derived ids", () => {
  const c = "abcdefghijklmnopqrst"; // ID.unique() length
  it("all fit Appwrite's id rule", () => {
    for (const id of [seatRowId(c, 6), secretId(c, 6), agentUserId(c, 6), dispatchId(turnId(c, 12, 6), "resolve"), approvalId(c, 9, 3), candidateId(c, 9)]) {
      expect(id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/);
    }
  });
  it("outbox ids differ per op for the same turn", () => {
    expect(dispatchId(turnId(c, 2, 1), "turn")).not.toBe(dispatchId(turnId(c, 2, 1), "resolve"));
  });
  it("parseTurnId round-trips and rejects anything else", () => {
    expect(parseTurnId(turnId(c, 12, 6))).toEqual({ circle: c, phase: 12, seat: 6 });
    expect(() => parseTurnId(`${c}-p1-close`)).toThrow();
  });
});
