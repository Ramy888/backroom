import { describe, expect, it } from "vitest";
import { AI_MEMBER_LIMITS, DAHAB_OPTIONS, DEFAULT_HUMAN_LIMITS, fits, otherWeekend, parseLimits, shares, type Limits } from "../src/dahab.js";

const fitAll = (human: Limits) => DAHAB_OPTIONS.filter((o) => [human, AI_MEMBER_LIMITS[2], AI_MEMBER_LIMITS[3]].every((l) => fits(o, l) === "ok")).map((o) => o.id);

describe("Dahab preset", () => {
  it("exactly one option fits everyone, before and after the human changes dates", () => {
    expect(fitAll(DEFAULT_HUMAN_LIMITS)).toEqual(["assalah-guesthouse"]);
    expect(fitAll(otherWeekend(DEFAULT_HUMAN_LIMITS))).toEqual(["eel-garden-flat"]);
    expect(otherWeekend(otherWeekend(DEFAULT_HUMAN_LIMITS))).toEqual(DEFAULT_HUMAN_LIMITS);
  });
  it("names the first reason an option fails", () => {
    const by = (id: string) => DAHAB_OPTIONS.find((o) => o.id === id)!;
    expect(fits(by("blue-hole-lodge"), DEFAULT_HUMAN_LIMITS)).toBe("over_budget");
    expect(fits(by("eel-garden-flat"), DEFAULT_HUMAN_LIMITS)).toBe("dates");
    expect(fits(by("lighthouse-camp"), AI_MEMBER_LIMITS[3])).toBe("dealbreaker");
    expect(fits(by("abu-galum-camp"), { ...AI_MEMBER_LIMITS[2], weekends: ["nov-20-22"] })).toBe("dealbreaker");
  });
  it("splits the total so the shares sum exactly", () => {
    const s = shares(DAHAB_OPTIONS.find((o) => o.id === "assalah-guesthouse")!, [1, 2, 3]);
    expect(s.reduce((n, x) => n + x.amount, 0)).toBe(3100 * 3);
    expect(shares({ ...DAHAB_OPTIONS[0]!, pricePerPerson: 1001 }, [1, 2]).map((x) => x.amount)).toEqual([1001, 1001]);
  });
  it("validates limits from the form", () => {
    expect(parseLimits('{"budget":3500,"weekends":["nov-13-15"],"dealbreaker":"none"}')).toEqual(DEFAULT_HUMAN_LIMITS);
    expect(() => parseLimits({ budget: 50, weekends: ["nov-13-15"], dealbreaker: "none" })).toThrow("budget");
    expect(() => parseLimits({ budget: 3000, weekends: ["dec-1"], dealbreaker: "none" })).toThrow("weekends");
    expect(() => parseLimits({ budget: 3000, weekends: [], dealbreaker: "none" })).toThrow("weekends");
    expect(() => parseLimits({ budget: 3000, weekends: ["nov-6-8"], dealbreaker: "pets" })).toThrow("dealbreaker");
  });
});
