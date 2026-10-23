// The Plan preset (M1): one seeded Dahab weekend, 1 human + 2 AI members, each with private limits. One source for
// the options seed, the agents' prompts and the tests. Limits are sized so exactly one option fits everyone, and
// the human's "change my dates" (the other weekend) makes a different single option fit: a re-plan that converges.
export type Weekend = "nov-6-8" | "nov-13-15" | "nov-20-22";
export type Dealbreaker = "none" | "no-camping" | "needs-wifi";
export type Limits = { budget: number; weekends: Weekend[]; dealbreaker: Dealbreaker };
export type DahabOption = { id: string; title: string; titleAr: string; weekend: Weekend; pricePerPerson: number; tags: string[]; location: [number, number] };

export const WEEKENDS: Weekend[] = ["nov-6-8", "nov-13-15", "nov-20-22"];
export const DEALBREAKERS: Dealbreaker[] = ["none", "no-camping", "needs-wifi"];

export const DAHAB_OPTIONS: DahabOption[] = [
  { id: "lighthouse-camp", title: "Lighthouse beach camp", titleAr: "كامب الفنار على البحر", weekend: "nov-6-8", pricePerPerson: 2400, tags: ["camping"], location: [34.5197, 28.4996] },
  { id: "eel-garden-flat", title: "Eel Garden apartment", titleAr: "شقة إيل جاردن", weekend: "nov-6-8", pricePerPerson: 2900, tags: ["wifi"], location: [34.5226, 28.5076] },
  { id: "lagoon-kite-hotel", title: "Lagoon kite hotel", titleAr: "فندق الكايت عند اللاجون", weekend: "nov-6-8", pricePerPerson: 6800, tags: ["wifi", "kite"], location: [34.4949, 28.4527] },
  { id: "assalah-guesthouse", title: "Assalah guesthouse", titleAr: "بيت ضيافة العصلة", weekend: "nov-13-15", pricePerPerson: 3100, tags: ["wifi"], location: [34.5180, 28.5126] },
  { id: "blue-hole-lodge", title: "Blue Hole dive lodge", titleAr: "لودج الغطس عند البلو هول", weekend: "nov-13-15", pricePerPerson: 5200, tags: ["wifi", "diving"], location: [34.5385, 28.5719] },
  { id: "abu-galum-camp", title: "Ras Abu Galum Bedouin camp", titleAr: "كامب بدوي في رأس أبو جالوم", weekend: "nov-20-22", pricePerPerson: 1900, tags: ["camping"], location: [34.5467, 28.6231] },
  { id: "mashraba-studios", title: "Mashraba studios", titleAr: "استوديوهات المشربة", weekend: "nov-20-22", pricePerPerson: 3700, tags: ["wifi"], location: [34.5232, 28.4934] },
];

// Seat 1 is the visitor (their agent reads these from their own secrets row); seats 2-3 are AI members.
export const PLAN_SEATS = [{ seat: 1, name: "Your agent" }, { seat: 2, name: "Karim" }, { seat: 3, name: "Om Fatma" }] as const;
export const DEFAULT_HUMAN_LIMITS: Limits = { budget: 3500, weekends: ["nov-13-15"], dealbreaker: "none" };
export const AI_MEMBER_LIMITS: Record<2 | 3, Limits> = {
  2: { budget: 4000, weekends: ["nov-6-8", "nov-13-15"], dealbreaker: "needs-wifi" },
  3: { budget: 3500, weekends: ["nov-6-8", "nov-13-15", "nov-20-22"], dealbreaker: "no-camping" },
};
// "Change my dates" moves the human to the other weekend the AI members can both make.
export const otherWeekend = (l: Limits): Limits => ({ ...l, weekends: l.weekends.includes("nov-13-15") ? ["nov-6-8"] : ["nov-13-15"] });

export function fits(o: DahabOption, l: Limits): "ok" | "over_budget" | "dates" | "dealbreaker" {
  if (!l.weekends.includes(o.weekend)) return "dates";
  if (o.pricePerPerson > l.budget) return "over_budget";
  if ((l.dealbreaker === "no-camping" && o.tags.includes("camping")) || (l.dealbreaker === "needs-wifi" && !o.tags.includes("wifi"))) return "dealbreaker";
  return "ok";
}

// Equal shares per member, in EGP; the remainder goes to the first seats so the parts sum to the total.
export function shares(o: DahabOption, seats: number[]) {
  const total = o.pricePerPerson * seats.length, base = Math.floor(total / seats.length), extra = total - base * seats.length;
  return seats.map((seat, i) => ({ seat, amount: base + (i < extra ? 1 : 0) }));
}

export function parseLimits(raw: unknown): Limits {
  const l = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<Limits>;
  const budget = Number(l?.budget);
  if (!Number.isInteger(budget) || budget < 1000 || budget > 10000) throw new Error("budget must be a whole number from 1000 to 10000");
  const weekends = Array.isArray(l?.weekends) ? [...new Set(l.weekends)].filter((w): w is Weekend => WEEKENDS.includes(w as Weekend)) : [];
  if (!weekends.length || weekends.length !== l.weekends!.length) throw new Error("weekends must be one or more of " + WEEKENDS.join(", "));
  if (!DEALBREAKERS.includes(l?.dealbreaker as Dealbreaker)) throw new Error("dealbreaker must be one of " + DEALBREAKERS.join(", "));
  return { budget, weekends, dealbreaker: l.dealbreaker as Dealbreaker };
}
