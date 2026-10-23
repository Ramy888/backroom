// Plan resolver (T16): deterministic, no LLM in its path, and it never reads secrets. Rounds of structured votes
// (V2: each carries the limitsVersion its agent read) reach consensus; the agreed option becomes an immutable
// candidate (V4) and a staged commit transaction that updates every member's seats row. The human's approve commits
// it. If the human changed a limit in between, that seats row moved and the commit gets 409 transaction_conflict
// from the database itself: re-plan (at most 3). An expired transaction is re-staged once, then the plan expires.
import { Client, TablesDB, Query, AppwriteException } from "node-appwrite";
import {
  DAHAB_OPTIONS, MAX_ROUNDS, commonChoice, dispatchId, permsFor, seatRowId, shares, turnId,
  DATABASE_ID as DB, type CircleView, type PlanVote, type Role,
} from "@backroom/core";
import type { Job } from "./resolver.js";

export type PlanResolverDeps = {
  endpoint: string; project: string; key: string;
  fire: (job: Job) => Promise<void>;
  ttlSeconds?: number; // the approval window: 300 s in production, shorter in tests
  resendAfterMs?: number;
  now?: () => number;
};
export type CommitOutcome = "committed" | "conflict" | "stalled" | "expired" | "restaged" | "stale";

const MAX_REPLANS = 3;
export const candidateId = (circle: string, generation: number) => `${circle}-g${generation}`;

export function planResolver(deps: PlanResolverDeps) {
  const db = new TablesDB(new Client().setEndpoint(deps.endpoint).setProject(deps.project).setKey(deps.key));
  const now = deps.now ?? Date.now;
  const list = async (tableId: string, ...queries: string[]) => (await db.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(100)] })).rows;
  const circleRow = (id: string) => db.getRow({ databaseId: DB, tableId: "circles", rowId: id });

  async function view(circle: string): Promise<{ view: CircleView; seats: { seat: number; seatVersion: number }[] }> {
    const c = await circleRow(circle);
    const seats = await list("seats", Query.equal("circleId", circle), Query.orderAsc("seat"));
    return {
      view: { visitor: c.visitor, seats: seats.map((s) => ({ seat: s.seat, user: s.agentUserId, role: "villager" as Role, visitor: s.seat === c.visitorSeat })) },
      seats: seats.map((s) => ({ seat: s.seat as number, seatVersion: (s.seatVersion ?? 0) as number })),
    };
  }

  // Opens round `phase`: one plan turn (and its outbox row) per member, in one transaction. Turn ids are
  // deterministic, so a second resolver run racing this one gets 409 and stops (the lock).
  async function openRound(circle: string, phase: number): Promise<boolean> {
    const { view: v, seats } = await view(circle);
    const tx = await db.createTransaction({ ttl: 60 });
    try {
      for (const { seat } of seats) {
        const id = turnId(circle, phase, seat);
        const pub = permsFor("public", v);
        await db.createRow({ databaseId: DB, tableId: "turns", rowId: id, transactionId: tx.$id, permissions: pub,
          data: { circleId: circle, phase, seat, kind: "plan", status: "pending", perms: JSON.stringify({ result: pub, log: permsFor("turnlog", v, seat) }) } });
        await db.createRow({ databaseId: DB, tableId: "dispatches", rowId: dispatchId(id, "turn"), transactionId: tx.$id, permissions: [],
          data: { circleId: circle, op: "turn", payload: JSON.stringify({ op: "turn", turnId: id }), status: "pending" } });
      }
      await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circle, transactionId: tx.$id, data: { phase, planState: "negotiating", txId: null } });
      await db.updateTransaction({ transactionId: tx.$id, commit: true });
    } catch (e) {
      await db.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => {});
      if (e instanceof AppwriteException && e.code === 409) return false;
      throw e;
    }
    for (const { seat } of seats) {
      const id = turnId(circle, phase, seat);
      // V3: the per-circle execution budget is enforced by the database.
      const capped = await db.incrementRowColumn({ databaseId: DB, tableId: "circles", rowId: circle, column: "executions", value: 1, max: 60 }).then(() => false, () => true);
      if (capped) { await end(circle, "stalled"); return true; }
      await deps.fire({ op: "turn", turnId: id });
      await db.updateRow({ databaseId: DB, tableId: "dispatches", rowId: dispatchId(id, "turn"), data: { status: "sent" } });
    }
    return true;
  }

  const end = (circle: string, planState: "committed" | "stalled" | "expired") =>
    db.updateRow({ databaseId: DB, tableId: "circles", rowId: circle, data: { planState, status: "ended", winner: planState === "committed" ? "planned" : "stalled", txId: null } });

  // Publishes the agreed option as generation `generation` and stages its commit. Members can read the candidate
  // before approving (V4); the staged transaction holds an update to every member's seats row.
  async function stage(circle: string, generation: number, optionId: string): Promise<boolean> {
    const { view: v, seats } = await view(circle);
    const option = DAHAB_OPTIONS.find((o) => o.id === optionId)!;
    const created = await db.createRow({ databaseId: DB, tableId: "plan_candidates", rowId: candidateId(circle, generation), permissions: permsFor("public", v),
      data: { circleId: circle, generation, optionId, shares: JSON.stringify(shares(option, seats.map((s) => s.seat))), committed: false } })
      .then(() => true, (e) => { if (e instanceof AppwriteException && e.code === 409) return false; throw e; });
    if (!created) return false; // another run already published this generation
    const tx = await db.createTransaction({ ttl: deps.ttlSeconds ?? 300 });
    for (const s of seats) await db.updateRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(circle, s.seat), transactionId: tx.$id, data: { seatVersion: s.seatVersion } });
    await db.updateRow({ databaseId: DB, tableId: "plan_candidates", rowId: candidateId(circle, generation), transactionId: tx.$id, data: { committed: true } });
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circle, data: { generation, planState: "awaiting", txId: tx.$id } });
    return true;
  }

  async function resendPending(circle: string) {
    const cutoff = new Date(now() - (deps.resendAfterMs ?? 30_000)).toISOString();
    for (const d of await list("dispatches", Query.equal("circleId", circle), Query.equal("status", "pending"), Query.lessThan("$createdAt", cutoff))) {
      await deps.fire({ op: d.op, ...JSON.parse(d.payload) } as Job); // the payload alone carries no op
      await db.updateRow({ databaseId: DB, tableId: "dispatches", rowId: d.$id, data: { status: "sent" } });
    }
  }

  return {
    start: (circle: string) => openRound(circle, 1),

    // Called after each plan turn. Closes the round once every member has voted.
    async resolve(circle: string, phase: number): Promise<"waiting" | "staged" | "next-round" | "stalled" | "stale"> {
      await resendPending(circle);
      const c = await circleRow(circle);
      if (c.kind !== "plan" || c.status !== "active" || c.planState !== "negotiating" || c.phase !== phase) return "stale";
      const turns = await list("turns", Query.equal("circleId", circle), Query.equal("phase", phase));
      if (turns.some((t) => t.status === "pending")) return "waiting";
      const { seats } = await view(circle);
      // Each member's latest vote across rounds; a vote cast on an older limitsVersion is invalidated (V2).
      const latest = new Map<number, PlanVote>();
      for (const m of await list("moves", Query.equal("circleId", circle), Query.equal("kind", "plan-vote"), Query.orderAsc("phase")))
        latest.set(m.seat, { seat: m.seat, proposalId: m.proposalId, vote: m.vote, limitsVersion: m.limitsVersion ?? 0, acceptable: m.text ? String(m.text).split(",") : [] });
      const price = (id: string) => DAHAB_OPTIONS.find((o) => o.id === id)?.pricePerPerson ?? Infinity;
      const tally = commonChoice(seats, [...latest.values()], price);
      if (tally.status === "consensus") return (await stage(circle, (c.generation ?? 0) + 1, tally.proposalId!)) ? "staged" : "waiting";
      if (phase >= MAX_ROUNDS * ((c.replans ?? 0) + 1)) { await end(circle, "stalled"); return "stalled"; } // 5 rounds per negotiation
      return (await openRound(circle, phase + 1)) ? "next-round" : "waiting";
    },

    // The human's approval commits the staged transaction; the database decides whether it still holds.
    async commit(circle: string, generation: number): Promise<CommitOutcome> {
      const c = await circleRow(circle);
      if (c.planState !== "awaiting" || c.generation !== generation || !c.txId) return "stale";
      try {
        await db.updateTransaction({ transactionId: c.txId, commit: true });
        await end(circle, "committed");
        return "committed";
      } catch (e) {
        await db.updateTransaction({ transactionId: c.txId, rollback: true }).catch(() => {}); // never assume the server discarded it
        if (!(e instanceof AppwriteException)) throw e;
        if (e.type === "transaction_conflict") {
          if ((c.replans ?? 0) >= MAX_REPLANS) { await end(circle, "stalled"); return "stalled"; }
          await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circle, data: { replans: (c.replans ?? 0) + 1 } });
          await openRound(circle, c.phase + 1);
          return "conflict";
        }
        // Anything else means the staged transaction is gone (its TTL ran out): re-stage once per plan, then give up.
        // The marker's deterministic id makes "once" hold even if two approvals race here.
        const first = await db.createRow({ databaseId: DB, tableId: "meta", rowId: `${circle}-restaged`, data: { n: 1 }, permissions: [] }).then(() => true, () => false);
        if (!first) { await end(circle, "expired"); return "expired"; }
        const current = await db.getRow({ databaseId: DB, tableId: "plan_candidates", rowId: candidateId(circle, generation) });
        await stage(circle, generation + 1, current.optionId);
        return "restaged";
      }
    },
  };
}
