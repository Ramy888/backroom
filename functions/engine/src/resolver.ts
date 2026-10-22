// engine op=resolve: the one trusted reader. Deterministic code, no LLM in its path (R11). It opens phases,
// advances sequential day speech (M2), closes night/vote with claim → one transaction (O3), and re-sends outbox
// rows a crash left pending (V1). Every id it writes is deterministic, so a duplicate run collides (409) and exits.
import { Client, TablesDB, Query, AppwriteException } from "node-appwrite";
import {
  closeId, dispatchId, nextPhase, permsFor, phaseKind, resolveNight, resolveVote, seatRowId, turnId, winner,
  DATABASE_ID as DB, type CircleView, type Seat,
} from "@backroom/core";

export type Job = { op: "turn"; turnId: string } | { op: "resolve"; circleId: string; phase: number } | { op: "start"; circleId: string };
export type ResolverDeps = {
  endpoint: string;
  project: string;
  resolverKey: string; // scopes: rows.read, rows.write, execution.write
  fire: (job: Job) => Promise<void>; // async createExecution of the engine Function
  resendAfterMs?: number; // V1: pending outbox rows older than this are re-sent (30 s in production)
  staleClaimMs?: number; // O3: a claimed close older than this is resumed (60 s in production)
  now?: () => number;
};

const MAX_COMMIT_RETRIES = 3;

export function resolver(deps: ResolverDeps) {
  const db = new TablesDB(new Client().setEndpoint(deps.endpoint).setProject(deps.project).setKey(deps.resolverKey));
  const now = deps.now ?? Date.now;
  const list = async (tableId: string, ...queries: string[]) =>
    (await db.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(100)] })).rows;

  async function load(circleId: string) {
    const circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId });
    const seatRows = await list("seats", Query.equal("circleId", circleId), Query.orderAsc("seat"));
    const roles = new Map((await list("secrets", Query.equal("circleId", circleId))).map((s) => [s.seat as number, s.role as Seat["role"]]));
    const seats: Seat[] = seatRows.map((s) => ({ seat: s.seat, role: roles.get(s.seat)!, alive: s.alive !== false, visitor: s.seat === circle.visitorSeat }));
    const view: CircleView = { visitor: circle.visitor, seats: seatRows.map((s) => ({ seat: s.seat, user: s.agentUserId, role: roles.get(s.seat)!, visitor: s.seat === circle.visitorSeat })) };
    return { circleRow: circle, seats, view };
  }

  // Stages one turn (and, for AI work, its outbox row) inside a transaction. Villager night turns finish at once,
  // so a row's existence or timing never reveals who holds a night role (V5).
  async function stageTurn(tx: string, s: { circle: string; view: CircleView; seats: Seat[] }, phase: number, seat: number) {
    const kind = phaseKind(phase);
    const id = turnId(s.circle, phase, seat);
    const role = s.seats.find((x) => x.seat === seat)!.role;
    const rowPerms = kind === "night" ? permsFor("night", s.view, seat) : permsFor("public", s.view);
    const perms = JSON.stringify({ result: rowPerms, log: permsFor("turnlog", s.view, seat) });
    const instant = kind === "night" && role === "villager";
    await db.createRow({ databaseId: DB, tableId: "turns", rowId: id, transactionId: tx, permissions: rowPerms,
      data: { circleId: s.circle, phase, seat, kind, status: instant ? "done" : "pending", perms } });
    if (instant) return null;
    await db.createRow({ databaseId: DB, tableId: "dispatches", rowId: dispatchId(id, "turn"), transactionId: tx, permissions: [],
      data: { circleId: s.circle, op: "turn", payload: JSON.stringify({ turnId: id }), status: "pending" } });
    return id;
  }

  async function stagePhaseOpen(tx: string, s: { circle: string; view: CircleView; seats: Seat[] }, phase: number) {
    const living = s.seats.filter((x) => x.alive).map((x) => x.seat);
    const kind = phaseKind(phase);
    const seatsToOpen = kind === "day" ? living.slice(0, 1) : living; // day speech is one seat at a time (M2)
    const fired: string[] = [];
    for (const seat of seatsToOpen) { const id = await stageTurn(tx, s, phase, seat); if (id) fired.push(id); }
    return fired;
  }

  async function fireTurns(circleId: string, ids: string[]) {
    for (const id of ids) {
      // V3: at most 60 executions per circle, enforced by the database, not by this code.
      const capped = await db.incrementRowColumn({ databaseId: DB, tableId: "circles", rowId: circleId, column: "executions", value: 1, max: 60 })
        .then(() => false).catch(() => true);
      if (capped) { await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { status: "ended", winner: "stalled" } }); await reveal(circleId); return; }
      await deps.fire({ op: "turn", turnId: id });
      await db.updateRow({ databaseId: DB, tableId: "dispatches", rowId: dispatchId(id, "turn"), data: { status: "sent" } });
    }
  }

  // 1b: once a Werewolf game ends, its visitor may read that circle's role rows, and only those: den talk, night
  // actions and prompts keep their permissions. Idempotent (a retry or "Continue" may call it again).
  async function reveal(circleId: string) {
    const circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId });
    if (circle.kind !== "werewolf" || circle.status !== "ended") return circle.status as string;
    const grant = `read("user:${circle.visitor}")`;
    for (const r of await list("secrets", Query.equal("circleId", circleId)))
      if (!r.$permissions.includes(grant)) await db.updateRow({ databaseId: DB, tableId: "secrets", rowId: r.$id, permissions: [...r.$permissions, grant] });
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { status: "revealed" } });
    return "revealed";
  }

  async function resendPending(circleId: string) {
    const cutoff = new Date(now() - (deps.resendAfterMs ?? 30_000)).toISOString();
    for (const d of await list("dispatches", Query.equal("circleId", circleId), Query.equal("status", "pending"), Query.lessThan("$createdAt", cutoff))) {
      await deps.fire(JSON.parse(d.payload) as Job);
      await db.updateRow({ databaseId: DB, tableId: "dispatches", rowId: d.$id, data: { status: "sent" } });
    }
  }

  async function transact<T>(work: (tx: string) => Promise<T>): Promise<T | "conflict" | "duplicate"> {
    const tx = await db.createTransaction({ ttl: 60 });
    try {
      const out = await work(tx.$id);
      await db.updateTransaction({ transactionId: tx.$id, commit: true });
      return out;
    } catch (e) {
      await db.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => {});
      if (e instanceof AppwriteException && e.type === "transaction_conflict") return "conflict";
      if (e instanceof AppwriteException && e.code === 409) return "duplicate"; // deterministic id already exists
      throw e;
    }
  }

  return {
    // Starts a game at phase 1 (night 1). Called by api setup after the circle rows exist.
    async start(circleId: string) {
      const s = { circle: circleId, ...(await load(circleId)) };
      const fired = await transact(async (tx) => {
        await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { phase: 1 }, transactionId: tx });
        return stagePhaseOpen(tx, s, 1);
      });
      if (Array.isArray(fired)) await fireTurns(circleId, fired);
    },

    async resolve(circleId: string, phase: number): Promise<"waiting" | "advanced" | "ended" | "stale"> {
      await resendPending(circleId);
      for (let attempt = 0; attempt < MAX_COMMIT_RETRIES; attempt++) {
        const s = { circle: circleId, ...(await load(circleId)) };
        if (s.circleRow.status !== "active" || s.circleRow.phase !== phase) return "stale";
        const kind = phaseKind(phase);
        const turns = await list("turns", Query.equal("circleId", circleId), Query.equal("phase", phase));
        if (turns.some((t) => t.status === "pending")) return "waiting";

        if (kind === "day") {
          const spoken = new Set(turns.map((t) => t.seat as number));
          const next = s.seats.find((x) => x.alive && !spoken.has(x.seat));
          if (next) {
            const fired = await transact((tx) => stageTurn(tx, s, phase, next.seat));
            if (fired === "duplicate") return "waiting";
            if (fired === "conflict") continue;
            if (fired) await fireTurns(circleId, [fired]);
            return "waiting";
          }
        }

        // Claim the close (O3). A fresh claim by another run means it is resolving; a stale one is resumed.
        const cid = closeId(circleId, phase);
        const claimed = await db.createRow({ databaseId: DB, tableId: "phases", rowId: cid, permissions: permsFor("public", s.view),
          data: { circleId, phase, kind, status: "claimed", claimedAt: new Date(now()).toISOString() } }).then(() => true).catch(async (e) => {
          if (!(e instanceof AppwriteException && e.code === 409)) throw e;
          const row = await db.getRow({ databaseId: DB, tableId: "phases", rowId: cid });
          return row.status === "claimed" && now() - Date.parse(row.claimedAt) > (deps.staleClaimMs ?? 60_000);
        });
        if (!claimed) return "waiting";

        let eliminated: number | null = null, vision: ReturnType<typeof resolveNight>["vision"] = null;
        if (kind === "night") {
          const acts = await list("night_actions", Query.equal("circleId", circleId), Query.equal("phase", phase));
          const kills: Record<number, number> = {};
          let seerCheck: number | undefined;
          for (const a of acts) {
            const role = s.seats.find((x) => x.seat === a.seat)?.role;
            if (role === "wolf" && a.target) kills[a.seat] = a.target;
            if (role === "seer" && a.target) seerCheck = a.target;
          }
          ({ eliminated, vision } = resolveNight(s.seats, { kills, seerCheck }));
        } else if (kind === "vote") {
          const votes: Record<number, number> = {};
          for (const m of await list("moves", Query.equal("circleId", circleId), Query.equal("phase", phase))) if (m.kind === "vote" && m.target) votes[m.seat] = m.target;
          eliminated = resolveVote(s.seats, votes);
        }
        const after = s.seats.map((x) => (x.seat === eliminated ? { ...x, alive: false } : x));
        const won = winner(after);
        const next = nextPhase(phase);
        const ends = won ?? (next === "dawn" ? "dawn" : null);

        const fired = await transact(async (tx) => {
          if (eliminated) await db.updateRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(circleId, eliminated), data: { alive: false }, transactionId: tx });
          if (vision) await db.updateRow({ databaseId: DB, tableId: "night_actions", rowId: turnId(circleId, phase, vision.seer), data: { visionIsWolf: vision.isWolf }, transactionId: tx });
          await db.updateRow({ databaseId: DB, tableId: "phases", rowId: cid, transactionId: tx,
            data: { status: "done", eliminated, eliminatedRole: eliminated ? s.seats.find((x) => x.seat === eliminated)!.role : null } });
          if (ends) {
            await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { status: "ended", winner: ends }, transactionId: tx });
            return [];
          }
          await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { phase: next as number }, transactionId: tx });
          return stagePhaseOpen(tx, { ...s, seats: after }, next as number);
        });
        if (fired === "conflict") continue;
        if (fired === "duplicate") return "waiting";
        await fireTurns(circleId, fired);
        if (ends) await reveal(circleId);
        return ends ? "ended" : "advanced";
      }
      return "waiting";
    },

    resendPending,
    reveal,
  };
}
