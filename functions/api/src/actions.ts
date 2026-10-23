// api Function actions (sync). The caller is the Appwrite user that executed the Function (x-appwrite-user-id);
// every circle-scoped action checks that caller is the circle's visitor (R4). Caps are database counters with an
// increment ceiling, keyed to a salted hash of x-appwrite-client-ip (R5), so a fresh anonymous session can't reset them.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Client, TablesDB, Users, Functions, Query, ID, AppwriteException } from "node-appwrite";
import { AI_MEMBER_LIMITS, DEFAULT_HUMAN_LIMITS, PLAN_SEATS, agentUserId, approvalsComplete, parseLimits, permsFor, receiptSnapshot, secretId, seatRowId, DATABASE_ID as DB, type CircleView, type Role } from "@backroom/core";
import { resolver, type Job } from "../../engine/src/resolver.js";
import { planResolver } from "../../engine/src/planResolver.js";

export type ApiDeps = {
  endpoint: string;
  project: string;
  key: string; // per-execution Function key: users.write, rows.read, rows.write, execution.write
  fire: (job: Job) => Promise<void>;
  ipSalt: string;
  judgeCode?: string;
  operatorCode?: string; // unlocks the operator page (R16); unset means the page is off
  demoCircleId?: string; // the always-on finished game any visitor may watch and probe (R6)
  planTtlSeconds?: number; // the Plan approval window (300 s in production)
  deploy?: { deployId: string | null; commit: string | null }; // stamped on every receipt (M5)
  now?: () => number;
  caps?: { perIpHour: number; perDay: number; judgePerDay: number; perMonth: number; promptsPerGame: number };
};
// code is a stable reason the web app turns into its own (translated) message.
export class ApiError extends Error { constructor(readonly status: number, readonly reason: string, readonly code?: string) { super(reason); } }

const DEFAULT_CAPS = { perIpHour: 5, perDay: 60, judgePerDay: 20, perMonth: 1500, promptsPerGame: 3 };
const VISITOR_SEAT = 6; // the visitor's wolf sits at six o'clock, nearest the thumb (DESIGN.md)
const NAMES = ["Uncle Hassan", "The Bluffer", "Dr. Mona", "Karim", "Om Fatma"];
const CIRCLE_TTL_MS = 60 * 60_000;
const STALE_TURN_MS = 60_000;

export function api(deps: ApiDeps) {
  const client = new Client().setEndpoint(deps.endpoint).setProject(deps.project).setKey(deps.key);
  const db = new TablesDB(client), users = new Users(client), fns = new Functions(client);
  const now = deps.now ?? Date.now;
  const caps = deps.caps ?? DEFAULT_CAPS;
  const engine = resolver({ endpoint: deps.endpoint, project: deps.project, resolverKey: deps.key, fire: deps.fire, now });
  const planEngine = planResolver({ endpoint: deps.endpoint, project: deps.project, key: deps.key, fire: deps.fire, now, ttlSeconds: deps.planTtlSeconds });
  const planCircle = async (caller: string | undefined, circleId: string) => {
    const circle = await ownCircle(caller, circleId);
    if (circle.kind !== "plan") throw new ApiError(400, "not a Plan circle");
    return circle;
  };

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

  const ipHashOf = (ip?: string) => createHash("sha256").update(`${deps.ipSalt}:${ip ?? "unknown"}`).digest("hex").slice(0, 16);
  const sameSecret = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
  const isDemo = (circleId: string) => !!deps.demoCircleId && circleId === deps.demoCircleId;
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 10); // YYYYMMDDHH
  const wolfToken = async (circleId: string) => (await users.createJWT({ userId: agentUserId(circleId, VISITOR_SEAT), duration: 3600 })).jwt; // the circle lives 60 min (CIRCLE_TTL_MS); the user, and so the token, dies with it

  // Plan (M1): the visitor is seat 1 with their own agent (which reads their limits through its JWT); seats 2-3 are
  // AI members with seeded private limits. No turn reads another member's limits; the resolver never reads limits.
  async function setupPlan(caller: string, lang: "en" | "ar", rawLimits: unknown) {
    let human;
    try { human = rawLimits == null ? DEFAULT_HUMAN_LIMITS : parseLimits(rawLimits); } catch (e) { throw new ApiError(400, (e as Error).message, "limits"); }
    const circleId = ID.unique();
    const view: CircleView = { visitor: caller, seats: PLAN_SEATS.map((s) => ({ seat: s.seat, user: agentUserId(circleId, s.seat), role: "villager" as Role, visitor: s.seat === 1 })) };
    await Promise.all(view.seats.map((s) => users.create({ userId: s.user, name: `${circleId} member ${s.seat}` })));
    const pub = permsFor("public", view);
    await db.createRow({ databaseId: DB, tableId: "circles", rowId: circleId, permissions: pub, data: {
      kind: "plan", status: "active", phase: 0, visitor: caller, visitorSeat: 1, lang, generation: 0, planState: "negotiating", replans: 0,
      expiresAt: new Date(now() + CIRCLE_TTL_MS).toISOString() } });
    await Promise.all(PLAN_SEATS.flatMap((s) => [
      db.createRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(circleId, s.seat), permissions: pub,
        data: { circleId, seat: s.seat, name: s.name, agentUserId: agentUserId(circleId, s.seat), controller: "ai", seatVersion: 0 } }),
      db.createRow({ databaseId: DB, tableId: "secrets", rowId: secretId(circleId, s.seat), permissions: permsFor("secret", view, s.seat),
        data: { circleId, seat: s.seat, role: "member", limits: JSON.stringify(s.seat === 1 ? human : AI_MEMBER_LIMITS[s.seat as 2 | 3]) } }),
    ]));
    await deps.fire({ op: "start", circleId });
    return { circleId, seat: 1 };
  }

  return {
    async setup(input: { caller?: string; ip?: string; judgeCode?: string; lang?: "en" | "ar"; prompt?: string; kind?: "werewolf" | "plan"; limits?: unknown }) {
      if (!input.caller) throw new ApiError(401, "sign in first");
      const prompt = String(input.prompt ?? "").trim(); // the visitor's opening instructions, in place before night 1
      if (prompt.length > 500) throw new ApiError(400, "prompt must be at most 500 characters");
      if (!(await challengeOpen())) throw new ApiError(503, "the challenge is paused", "paused");
      const t = stamp(now());
      // A judge plays from the reserve and skips the per-network cap (judges often share one office network).
      const judge = !!deps.judgeCode && !!input.judgeCode && sameSecret(input.judgeCode, deps.judgeCode);
      if (!judge && !(await bump(`cap-ip-${ipHashOf(input.ip)}-${t}`, caps.perIpHour))) throw new ApiError(429, "hourly limit for this network", "hour");
      if (!(await bump(judge ? `cap-judge-${t.slice(0, 8)}` : `cap-day-${t.slice(0, 8)}`, judge ? caps.judgePerDay : caps.perDay))) throw new ApiError(429, "daily limit reached", "day");
      if (!(await bump(`cap-month-${t.slice(0, 6)}`, caps.perMonth))) throw new ApiError(429, "monthly limit reached", "month");
      if (input.kind === "plan") return setupPlan(input.caller, input.lang ?? "en", input.limits);

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
          data: { circleId, seat: s.seat, role: s.role, ...(s.visitor && prompt ? { prefs: prompt } : {}) } }),
      ]));
      // Night 1 opens in the async engine, so this synchronous call stays far under Appwrite's 30 s limit.
      await deps.fire({ op: "start", circleId });
      return { circleId, seat: VISITOR_SEAT, wolfToken: await wolfToken(circleId) };
    },

    // O4: every limit change is one transaction: the private value in secrets, and +1 on the public seatVersion,
    // which is all the other members learn. If a plan is staged, this moves its seats row and its commit will conflict.
    async editLimit(input: { caller?: string; circleId: string; limits: unknown }) {
      const circle = await planCircle(input.caller, input.circleId);
      if (circle.status !== "active") throw new ApiError(409, "this plan is closed");
      let limits;
      try { limits = parseLimits(input.limits); } catch (e) { throw new ApiError(400, (e as Error).message, "limits"); }
      const seat = circle.visitorSeat as number;
      const tx = await db.createTransaction({ ttl: 60 });
      try {
        await db.updateRow({ databaseId: DB, tableId: "secrets", rowId: secretId(input.circleId, seat), transactionId: tx.$id, data: { limits: JSON.stringify(limits) } });
        await db.incrementRowColumn({ databaseId: DB, tableId: "seats", rowId: seatRowId(input.circleId, seat), column: "seatVersion", value: 1, transactionId: tx.$id });
        await db.updateTransaction({ transactionId: tx.$id, commit: true });
      } catch (e) {
        await db.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => {});
        throw e;
      }
      return { seatVersion: (await db.getRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(input.circleId, seat) })).seatVersion as number };
    },

    // O5: the human approves one generation of one candidate. The approval id is deterministic, so it counts once.
    async approve(input: { caller?: string; circleId: string; generation: number }) {
      const circle = await planCircle(input.caller, input.circleId);
      const generation = Number(input.generation);
      if (circle.planState !== "awaiting" || circle.generation !== generation) throw new ApiError(409, "nothing to approve for this generation", "stale");
      const seat = circle.visitorSeat as number;
      await db.createRow({ databaseId: DB, tableId: "approvals", rowId: `${input.circleId}-g${generation}-s${seat}`, permissions: (await db.getRow({ databaseId: DB, tableId: "plan_candidates", rowId: `${input.circleId}-g${generation}` })).$permissions,
        data: { circleId: input.circleId, generation, seat } }).catch((e) => { if (!(e instanceof AppwriteException && e.code === 409)) throw e; });
      const approvals = (await db.listRows({ databaseId: DB, tableId: "approvals", queries: [Query.equal("circleId", input.circleId), Query.equal("generation", generation)] })).rows;
      if (!approvalsComplete(approvals.map((a) => ({ seat: a.seat, generation: a.generation })), generation, [seat])) return { state: "waiting" };
      const out = await planEngine.commit(input.circleId, generation);
      if (out === "restaged") throw new ApiError(410, "the approval window closed; the plan was re-staged, approve it again", "restaged");
      if (out === "expired") throw new ApiError(410, "the approval window closed again; this plan expired", "expired");
      if (out === "stale") throw new ApiError(409, "nothing to approve for this generation", "stale");
      return { state: out }; // committed | conflict | stalled
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
      if (isDemo(input.circleId)) { if (!input.caller) throw new ApiError(401, "sign in first"); } // the demo's wolf is everyone's to probe
      else await ownCircle(input.caller, input.circleId);
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
      if (circle.kind === "plan") return { abstained: stuck.length, state: await planEngine.resolve(input.circleId, circle.phase) };
      await engine.resendPending(input.circleId);
      return { abstained: stuck.length, state: await engine.resolve(input.circleId, circle.phase) };
    },

    // X3: publish one public snapshot of a finished circle. secrets permissions never change for this; the snapshot
    // names seats, not users (M11), and survives the circle's sweep.
    async share(input: { caller?: string; circleId: string }) {
      if (isDemo(input.circleId)) {
        const demo = await db.getRow({ databaseId: DB, tableId: "circles", rowId: input.circleId });
        if (demo.receiptId) return { receiptId: demo.receiptId as string };
      }
      const circle = await ownCircle(input.caller, input.circleId);
      if (circle.kind !== "werewolf") throw new ApiError(400, "only Werewolf games have receipts");
      if (circle.status === "active") throw new ApiError(409, "the game has not ended");
      if (circle.receiptId) return { receiptId: circle.receiptId as string };
      await engine.reveal(input.circleId); // in case the end path stopped before revealing
      const q = [Query.equal("circleId", input.circleId), Query.limit(100)];
      const [seats, secrets, logs] = await Promise.all(["seats", "secrets", "turn_logs"].map((tableId) => db.listRows({ databaseId: DB, tableId, queries: q })));
      const snapshot = receiptSnapshot({
        circleId: input.circleId, visitor: circle.visitor, visitorSeat: circle.visitorSeat, winner: circle.winner ?? null, phases: circle.phase,
        endedAt: circle.$updatedAt, lang: circle.lang ?? "en", deploy: deps.deploy ?? { deployId: null, commit: null },
        seats: seats!.rows.map((s) => ({ seat: s.seat, name: s.name, alive: s.alive !== false })).sort((a, b) => a.seat - b.seat),
        secrets: secrets!.rows.map((r) => ({ $id: r.$id, seat: r.seat, role: r.role, $permissions: r.$permissions })).sort((a, b) => a.seat - b.seat),
        logs: logs!.rows.map((l) => ({ classified: l.classified, foreign: l.foreign ?? 0 })),
      });
      const row = await db.createRow({ databaseId: DB, tableId: "receipts", rowId: ID.unique(), permissions: ['read("any")'],
        data: { snapshot: JSON.stringify(snapshot), deployId: deps.deploy?.deployId ?? null, commit: deps.deploy?.commit ?? null } });
      await db.updateRow({ databaseId: DB, tableId: "circles", rowId: input.circleId, data: { receiptId: row.$id } });
      return { receiptId: row.$id };
    },

    // R16: the operator page. The code is checked here, never in the browser, and guesses are capped per network.
    async op(input: { ip?: string; code: string; action: "status" | "open" | "close" }) {
      if (!deps.operatorCode) throw new ApiError(404, "operator page is off");
      if (!(await bump(`cap-op-${ipHashOf(input.ip)}-${stamp(now())}`, 10))) throw new ApiError(429, "too many tries, wait an hour");
      if (!sameSecret(String(input.code ?? ""), deps.operatorCode)) throw new ApiError(403, "wrong operator code");
      if (input.action === "open" || input.action === "close") {
        const data = { flag: input.action === "open" };
        await db.updateRow({ databaseId: DB, tableId: "meta", rowId: "config", data })
          .catch(() => db.createRow({ databaseId: DB, tableId: "meta", rowId: "config", data, permissions: [] }));
      }
      const t = stamp(now());
      const count = (rowId: string) => db.getRow({ databaseId: DB, tableId: "meta", rowId }).then((r) => r.n as number, () => 0);
      const [day, judge, month] = await Promise.all([count(`cap-day-${t.slice(0, 8)}`), count(`cap-judge-${t.slice(0, 8)}`), count(`cap-month-${t.slice(0, 6)}`)]);
      const recent = await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.orderDesc("$createdAt"), Query.limit(10)] });
      const active = await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.equal("status", "active"), Query.limit(1)] });
      const failed = async (functionId: string) => (await fns.listExecutions({ functionId, queries: [Query.equal("status", "failed"), Query.orderDesc("$createdAt"), Query.limit(5)] })
        .catch(() => ({ executions: [] }))).executions.map((e) => ({ fn: functionId, at: e.$createdAt, code: e.responseStatusCode, error: String(e.errors ?? "").slice(0, 300) }));
      return {
        challengeOpen: await challengeOpen(),
        counters: { day: { n: day, of: caps.perDay }, judge: { n: judge, of: caps.judgePerDay }, month: { n: month, of: caps.perMonth } },
        circles: { active: active.total, recent: recent.rows.map((c) => ({ id: c.$id, status: c.status, phase: c.phase, executions: c.executions, winner: c.winner ?? null, at: c.$createdAt })) },
        errors: [...(await failed("engine")), ...(await failed("api"))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8),
        deploy: deps.deploy ?? null, demoCircleId: deps.demoCircleId ?? null,
      };
    },

    // Hourly cron: delete expired circles, their rows and their agent users (O1: leftover JWTs die with the users).
    async sweep() {
      const expired = (await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.lessThan("expiresAt", new Date(now()).toISOString()), Query.limit(25)] })).rows;
      for (const c of expired) {
        await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: `${c.$id}-restaged` }).catch(() => {});
        for (const t of ["turn_logs", "dispatches", "moves", "night_actions", "turns", "phases", "approvals", "plan_candidates", "secrets", "seats"]) {
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

