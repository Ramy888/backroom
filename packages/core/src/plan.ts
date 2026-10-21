// Plan negotiation tally (V2/V4/O5): consensus needs every member to accept the same proposal on the limits
// version they currently hold; approvals count once per member for the current candidate generation only.
export const MAX_ROUNDS = 5;

export type PlanSeat = { seat: number; seatVersion: number };
export type PlanVote = { seat: number; proposalId: string; vote: "accept" | "reject" | "counter"; limitsVersion: number };

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
