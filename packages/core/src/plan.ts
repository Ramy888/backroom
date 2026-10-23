// Plan negotiation tally (V2/V4/O5): consensus needs every member to accept the same proposal on the limits
// version they currently hold; approvals count once per member for the current candidate generation only.
export const MAX_ROUNDS = 5;

export type PlanSeat = { seat: number; seatVersion: number };
export type PlanVote = { seat: number; proposalId: string; vote: "accept" | "reject" | "counter"; limitsVersion: number; acceptable?: string[] };

// Approval voting (T16): each agent posts every option that fits its own limits. Consensus is the cheapest option in
// every member's fresh set; a set cast on an older limitsVersion is invalidated (V2). The resolver needs no limits.
export function commonChoice(seats: PlanSeat[], votes: PlanVote[], priceOf: (id: string) => number) {
  const version = new Map(seats.map((s) => [s.seat, s.seatVersion]));
  const stale = votes.filter((v) => version.get(v.seat) !== v.limitsVersion).map((v) => v.seat);
  const fresh = votes.filter((v) => !stale.includes(v.seat));
  if (seats.some((s) => !fresh.find((v) => v.seat === s.seat))) return { status: "continue" as const, proposalId: null, stale };
  const common = fresh.map((v) => new Set(v.acceptable ?? [])).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  if (!common.size) return { status: "continue" as const, proposalId: null, stale };
  const [best] = [...common].sort((a, b) => priceOf(a) - priceOf(b) || a.localeCompare(b));
  return { status: "consensus" as const, proposalId: best!, stale };
}

export function tallyRound(seats: PlanSeat[], votes: PlanVote[], round: number) {
  if (round > MAX_ROUNDS) return { status: "no-consensus" as const, proposalId: null, stale: [] as number[] };
  const version = new Map(seats.map((s) => [s.seat, s.seatVersion]));
  const stale = votes.filter((v) => version.get(v.seat) !== v.limitsVersion).map((v) => v.seat);
  const fresh = votes.filter((v) => !stale.includes(v.seat));
  const accepted = new Set(fresh.filter((v) => v.vote === "accept").map((v) => v.proposalId));
  const allAccept = fresh.length === seats.length && fresh.every((v) => v.vote === "accept") && accepted.size === 1;
  return allAccept
    ? { status: "consensus" as const, proposalId: [...accepted][0]!, stale }
    : { status: "continue" as const, proposalId: null, stale };
}

export const approvalsComplete = (approvals: { seat: number; generation: number }[], generation: number, members: number[]) => {
  const approved = new Set(approvals.filter((a) => a.generation === generation).map((a) => a.seat));
  return members.every((m) => approved.has(m)) && approvals.filter((a) => a.generation === generation).length === members.length;
};
