// Fixed 6-seat Werewolf ruleset (docs/designs/backroom.md M12). Pure functions: the resolver feeds rows in,
// writes the returned outcome in one transaction. Phases cycle night → day (sequential speech) → vote.
export type Role = "wolf" | "seer" | "villager";
export type Seat = { seat: number; role: Role; alive: boolean; visitor?: boolean };
export type PhaseKind = "night" | "day" | "vote";
export type Vision = { seer: number; target: number; isWolf: boolean };

export const MAX_CYCLES = 4; // V3 bound: 4 nights + 4 days, then "dawn" and the village wins

export const phaseKind = (phase: number): PhaseKind => (["vote", "night", "day"] as const)[phase % 3]!;
export const nextPhase = (phase: number): number | "dawn" => (phase >= MAX_CYCLES * 3 ? "dawn" : phase + 1);

const living = (seats: Seat[], n: number) => seats.find((s) => s.seat === n && s.alive);

export function resolveNight(seats: Seat[], night: { kills: Record<number, number>; seerCheck?: number }) {
  const wolves = seats.filter((s) => s.role === "wolf" && s.alive).sort((a, b) => Number(!!b.visitor) - Number(!!a.visitor) || a.seat - b.seat);
  const validTarget = (t: number | undefined) => (t != null && living(seats, t)?.role !== "wolf" && living(seats, t) ? t : null);
  // Wolf 1 (the visitor's wolf, else the lowest seat) decides on disagreement; an abstaining wolf defers.
  const picks = wolves.map((w) => validTarget(night.kills[w.seat])).filter((t): t is number => t != null);
  const eliminated = picks[0] ?? null;

  const seer = seats.find((s) => s.role === "seer" && s.alive);
  const target = night.seerCheck;
  const vision: Vision | null = seer && target != null && target !== seer.seat && living(seats, target)
    ? { seer: seer.seat, target, isWolf: living(seats, target)!.role === "wolf" }
    : null;
  return { eliminated, vision };
}

export function resolveVote(seats: Seat[], votes: Record<number, number>): number | null {
  const tally = new Map<number, number>();
  for (const [voter, target] of Object.entries(votes)) {
    if (living(seats, Number(voter)) && living(seats, target)) tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0]![1])) return null; // tie or no votes: nobody leaves
  return ranked[0]![0];
}

export function winner(seats: Seat[]): "wolves" | "village" | null {
  const wolves = seats.filter((s) => s.alive && s.role === "wolf").length;
  const others = seats.filter((s) => s.alive && s.role !== "wolf").length;
  if (wolves === 0) return "village";
  return wolves >= others ? "wolves" : null;
}
