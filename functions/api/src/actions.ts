// api Function actions (sync). The caller is the Appwrite user that executed the Function (x-appwrite-user-id);
// every circle-scoped action checks that caller is the circle's visitor (R4). Caps are database counters with an
// increment ceiling, keyed to a salted hash of x-appwrite-client-ip (R5), so a fresh anonymous session can't reset them.
import { createHash, randomInt } from "node:crypto";
import { Client, TablesDB, Users, Query, ID, AppwriteException } from "node-appwrite";
import { agentUserId, permsFor, secretId, seatRowId, DATABASE_ID as DB, type CircleView, type Role } from "@backroom/core";
import { resolver, type Job } from "../../engine/src/resolver.js";

export type ApiDeps = {
  endpoint: string;
  project: string;
  key: string; // per-execution Function key: users.write, rows.read, rows.write, execution.write
  fire: (job: Job) => Promise<void>;
  ipSalt: string;
  judgeCode?: string;
  now?: () => number;
  caps?: { perIpHour: number; perDay: number; judgePerDay: number; perMonth: number; promptsPerGame: number };
};
export class ApiError extends Error { constructor(readonly status: number, readonly reason: string) { super(reason); } }

const DEFAULT_CAPS = { perIpHour: 5, perDay: 60, judgePerDay: 20, perMonth: 1500, promptsPerGame: 3 };
const VISITOR_SEAT = 6; // the visitor's wolf sits at six o'clock, nearest the thumb (DESIGN.md)
const NAMES = ["Uncle Hassan", "The Bluffer", "Dr. Mona", "Karim", "Om Fatma"];
const CIRCLE_TTL_MS = 60 * 60_000;
const STALE_TURN_MS = 60_000;

export function api(deps: ApiDeps) {
  const client = new Client().setEndpoint(deps.endpoint).setProject(deps.project).setKey(deps.key);
  const db = new TablesDB(client), users = new Users(client);
  const now = deps.now ?? Date.now;
  const caps = deps.caps ?? DEFAULT_CAPS;
  const engine = resolver({ endpoint: deps.endpoint, project: deps.project, resolverKey: deps.key, fire: deps.fire, now });

  // A counter row in meta: true while under the ceiling. The ceiling is enforced by the database (increment max).
  async function bump(rowId: string, max: number): Promise<boolean> {
    try {
      await db.incrementRowColumn({ databaseId: DB, tableId: "meta", rowId, column: "n", value: 1, max });
      return true;
    } catch (e) {
      if (!(e instanceof AppwriteException && e.code === 404)) return false; // over the ceiling (or failing closed)
      try { await db.createRow({ databaseId: DB, tableId: "meta", rowId, data: { n: 1 }, permissions: [] }); return true; }
      catch (e2) { if (e2 instanceof AppwriteException && e2.code === 409) return bump(rowId, max); throw e2; }
    }
  }

  async function challengeOpen() {
    const cfg = await db.getRow({ databaseId: DB, tableId: "meta", rowId: "config" }).catch(() => null);
    return cfg?.flag !== false;
  }

  async function ownCircle(caller: string | undefined, circleId: string) {
    if (!caller) throw new ApiError(401, "sign in first");
    const circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }).catch(() => null);
    if (!circle || circle.visitor !== caller) throw new ApiError(403, "not your circle");
    return circle;
  }

  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 10); // YYYYMMDDHH
  const wolfToken = async (circleId: string) => (await users.createJWT({ userId: agentUserId(circleId, VISITOR_SEAT), duration: 300 })).jwt;

  return {
    async setup(input: { caller?: string; ip?: string; judgeCode?: string; lang?: "en" | "ar" }) {
      if (!input.caller) throw new ApiError(401, "sign in first");
      if (!(await challengeOpen())) throw new ApiError(503, "the challenge is paused");
      const ipHash = createHash("sha256").update(`${deps.ipSalt}:${input.ip ?? "unknown"}`).digest("hex").slice(0, 16);
      const t = stamp(now());
      if (!(await bump(`cap-ip-${ipHash}-${t}`, caps.perIpHour))) throw new ApiError(429, "hourly limit for this network");
      const judge = !!deps.judgeCode && input.judgeCode === deps.judgeCode;
      if (!(await bump(judge ? `cap-judge-${t.slice(0, 8)}` : `cap-day-${t.slice(0, 8)}`, judge ? caps.judgePerDay : caps.perDay))) throw new ApiError(429, "daily limit reached");
      if (!(await bump(`cap-month-${t.slice(0, 6)}`, caps.perMonth))) throw new ApiError(429, "monthly limit reached");

      const circleId = ID.unique();
      // Seat 6 is the visitor's wolf; seats 1-5 get one wolf, one seer and three villagers in random order.
      const others: Role[] = ["wolf", "seer", "villager", "villager", "villager"];
      for (let i = others.length - 1; i > 0; i--) { const j = randomInt(i + 1); [others[i], others[j]] = [others[j]!, others[i]!]; }
      const roles: Role[] = [...others, "wolf"];
      const view: CircleView = { visitor: input.caller, seats: roles.map((role, i) => ({ seat: i + 1, user: agentUserId(circleId, i + 1), role, visitor: i + 1 === VISITOR_SEAT })) };
      await Promise.all(view.seats.map((s) => users.create({ userId: s.user, name: `${circleId} seat ${s.seat}` })));

      const pub = permsFor("public", view);
      await db.createRow({ databaseId: DB, tableId: "circles", rowId: circleId, permissions: pub, data: {
        kind: "werewolf", status: "active", phase: 0, visitor: input.caller, visitorSeat: VISITOR_SEAT, lang: input.lang ?? "en",
        expiresAt: new Date(now() + CIRCLE_TTL_MS).toISOString() } });
      await Promise.all(view.seats.flatMap((s) => [
        db.createRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(circleId, s.seat), permissions: pub, data: {
          circleId, seat: s.seat, name: s.seat === VISITOR_SEAT ? "Your wolf" : NAMES[s.seat - 1]!, agentUserId: s.user, controller: "ai" } }),
        db.createRow({ databaseId: DB, tableId: "secrets", rowId: secretId(circleId, s.seat), permissions: permsFor("secret", view, s.seat),
          data: { circleId, seat: s.seat, role: s.role } }),
      ]));
      // Night 1 opens in the async engine, so this synchronous call stays far under Appwrite's 30 s limit.
      await deps.fire({ op: "start", circleId });
      return { circleId, seat: VISITOR_SEAT, wolfToken: await wolfToken(circleId) };
    },

    async inject(input: { caller?: string; circleId: string; prompt: string }) {
      await ownCircle(input.caller, input.circleId);
      const prompt = String(input.prompt ?? "").trim();
      if (!prompt || prompt.length > 500) throw new ApiError(400, "prompt must be 1-500 characters");
      if (!(await bump(`cap-prompt-${input.circleId}`, caps.promptsPerGame))) throw new ApiError(429, "prompt limit for this game");
      await db.updateRow({ databaseId: DB, tableId: "secrets", rowId: secretId(input.circleId, VISITOR_SEAT), data: { prefs: prompt } });
      return { ok: true };
    },

    async token(input: { caller?: string; circleId: string }) {
      await ownCircle(input.caller, input.circleId);
      return { wolfToken: await wolfToken(input.circleId) };
    },

    // "Continue": abstain turns stuck pending (a crashed execution), re-send the outbox, and re-run resolution.
    async continue(input: { caller?: string; circleId: string }) {
      const circle = await ownCircle(input.caller, input.circleId);
      const cutoff = new Date(now() - STALE_TURN_MS).toISOString();
      const stuck = (await db.listRows({ databaseId: DB, tableId: "turns", queries: [Query.equal("circleId", input.circleId),
        Query.equal("phase", circle.phase), Query.equal("status", "pending"), Query.lessThan("$createdAt", cutoff), Query.limit(10)] })).rows;
      for (const t of stuck) {
        const perms = JSON.parse(t.perms).result as string[];
        const night = t.kind === "night";
        await db.createRow({ databaseId: DB, tableId: night ? "night_actions" : "moves", rowId: t.$id, permissions: perms,
          data: night ? { circleId: input.circleId, phase: t.phase, seat: t.seat } : { circleId: input.circleId, phase: t.phase, seat: t.seat, kind: "abstain" } }).catch(() => {});
        await db.updateRow({ databaseId: DB, tableId: "turns", rowId: t.$id, data: { status: "abstained" } });
      }
      await engine.resendPending(input.circleId);
      return { abstained: stuck.length, state: await engine.resolve(input.circleId, circle.phase) };
    },

    // Hourly cron: delete expired circles, their rows and their agent users (O1: leftover JWTs die with the users).
    async sweep() {
      const expired = (await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.lessThan("expiresAt", new Date(now()).toISOString()), Query.limit(25)] })).rows;
      for (const c of expired) {
        for (const t of ["turn_logs", "dispatches", "moves", "night_actions", "turns", "phases", "secrets", "seats"]) {
          for (;;) {
            const { rows } = await db.listRows({ databaseId: DB, tableId: t, queries: [Query.equal("circleId", c.$id), Query.limit(100)] });
            if (!rows.length) break;
            for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: t, rowId: r.$id });
          }
        }
        for (let seat = 1; seat <= 6; seat++) await users.delete({ userId: agentUserId(c.$id, seat) }).catch(() => {});
        await db.deleteRow({ databaseId: DB, tableId: "circles", rowId: c.$id });
      }
      return { swept: expired.length };
    },
  };
}

