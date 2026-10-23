// Task 16 acceptance on backroom-test, with a scripted (free) model: each agent reads its member's limits through
// its own JWT and posts the options that fit. Consensus stages a real commit transaction; a limit change in between
// makes the human's approval hit 409 transaction_conflict from the database, and the agents re-plan to v+1.
import { afterAll, describe, expect, it } from "vitest";
import { Query, ID } from "node-appwrite";
import type Anthropic from "@anthropic-ai/sdk";
import { DAHAB_OPTIONS, DEFAULT_HUMAN_LIMITS, fits, otherWeekend, parseTurnId, DATABASE_ID as DB, type Limits } from "@backroom/core";
import { agentTurn, type Llm } from "../functions/engine/src/agentTurn.js";
import { api, ApiError } from "../functions/api/src/actions.js";
import type { Job } from "../functions/engine/src/resolver.js";
import { planResolver } from "../functions/engine/src/planResolver.js";
import { asUser, db, env, users } from "./helpers/fixture.js";

// Policy model: parses the limits the agent was shown (read from its own secrets row) and lists what fits them.
const fitPolicy: Llm = async (params) => {
  const text = String((params.messages[0] as { content: string }).content);
  const limits = JSON.parse(/limits \(from your own secrets row\): (\{.*?\})\. Your limits version/.exec(text)![1]!) as Limits;
  const acceptable = DAHAB_OPTIONS.filter((o) => fits(o, limits) === "ok").map((o) => o.id);
  return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "tool_use", stop_sequence: null, usage: {},
    content: [{ type: "tool_use", id: "t", name: "post_vote", input: { acceptable, favourite: acceptable[0] ?? null } }] } as unknown as Anthropic.Beta.BetaMessage;
};

function harness(ttlSeconds = 300) {
  const queue: Job[] = [];
  const fire = async (j: Job) => { queue.push(j); };
  const plan = planResolver({ endpoint: env.endpoint, project: env.project, key: env.key, fire, resendAfterMs: 0, ttlSeconds }); // it stages the transaction
  const a = api({ endpoint: env.endpoint, project: env.project, key: env.key, ipSalt: `p-${Date.now()}`, fire, planTtlSeconds: ttlSeconds,
    caps: { perIpHour: 50, perDay: 500, judgePerDay: 5, perMonth: 5000, promptsPerGame: 2 } });
  const run = async (job: Job) => {
    if (job.op === "turn") await agentTurn({ endpoint: env.endpoint, project: env.project, agentKey: env.agentKey, llm: fitPolicy, model: "fake",
      dispatchResolve: async (circleId, phase) => { queue.push({ op: "resolve", circleId, phase }); } }, job.turnId);
    else if (job.op === "start") await plan.start(job.circleId);
    else if (job.op === "resolve") await plan.resolve(job.circleId, job.phase);
    else throw new Error(`job without a known op: ${JSON.stringify(job)}`);
  };
  async function drain(limit = 200) { for (let i = 0; i < limit && queue.length; i++) await run(queue.shift()!); }
  return { a, queue, run, drain };
}

const visitors: string[] = [];
const newVisitor = async () => { const u = await users.create({ userId: ID.unique(), name: "plan visitor" }); visitors.push(u.$id); return u.$id; };
const circle = (id: string) => db.getRow({ databaseId: DB, tableId: "circles", rowId: id });
const candidate = (id: string, g: number) => db.getRow({ databaseId: DB, tableId: "plan_candidates", rowId: `${id}-g${g}` });
const err = (p: Promise<unknown>) => p.then(() => null, (e) => e as ApiError);

afterAll(async () => {
  const h = harness();
  for (const v of visitors) for (const c of (await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.equal("visitor", v)] })).rows)
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: c.$id, data: { expiresAt: new Date(0).toISOString() } }).catch(() => {});
  await h.a.sweep();
  for (const v of visitors) await users.delete({ userId: v }).catch(() => {});
  const { rows } = await db.listRows({ databaseId: DB, tableId: "meta", queries: [Query.startsWith("$id", "cap-"), Query.limit(100)] });
  for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: r.$id });
});

describe("plan (Dahab)", () => {
  it("agents agree, the human's agent reads only its own limits, and the plan stages as generation 1", async () => {
    const h = harness(), v = await newVisitor();
    const { circleId } = await h.a.setup({ caller: v, ip: "192.0.2.60", kind: "plan" });
    await h.drain();
    const c = await circle(circleId);
    expect([c.planState, c.generation, c.phase]).toEqual(["awaiting", 1, 1]);
    const cand = await candidate(circleId, 1);
    expect(cand.optionId).toBe("assalah-guesthouse");
    expect(JSON.parse(cand.shares).reduce((n: number, s: { amount: number }) => n + s.amount, 0)).toBe(3100 * 3);
    // The human sees their own limits and nobody else's; the candidate is theirs to read before approving (V4).
    const asV = await asUser(v);
    expect((await asV.listRows({ databaseId: DB, tableId: "secrets", queries: [Query.equal("circleId", circleId)] })).rows.map((r) => r.seat)).toEqual([1]);
    expect((await asV.getRow({ databaseId: DB, tableId: "plan_candidates", rowId: `${circleId}-g1` })).optionId).toBe("assalah-guesthouse");
  }, 180_000);

  it("order A: changing dates before approving makes the commit conflict, and the agents re-plan to v+1", async () => {
    const h = harness(), v = await newVisitor();
    const { circleId } = await h.a.setup({ caller: v, ip: "192.0.2.61", kind: "plan" });
    await h.drain();
    expect((await h.a.editLimit({ caller: v, circleId, limits: otherWeekend(DEFAULT_HUMAN_LIMITS) })).seatVersion).toBe(1);
    expect(await h.a.approve({ caller: v, circleId, generation: 1 })).toEqual({ state: "conflict" }); // 409 from TablesDB
    expect([(await circle(circleId)).planState, (await candidate(circleId, 1)).committed]).toEqual(["negotiating", false]);
    await h.drain();
    const c = await circle(circleId);
    expect([c.planState, c.generation, c.replans]).toEqual(["awaiting", 2, 1]);
    expect((await candidate(circleId, 2)).optionId).toBe("eel-garden-flat");
    expect(await h.a.approve({ caller: v, circleId, generation: 2 })).toEqual({ state: "committed" });
    const done = await circle(circleId);
    expect([done.planState, done.status, done.winner, (await candidate(circleId, 2)).committed]).toEqual(["committed", "ended", "planned", true]);
  }, 240_000);

  it("order B: approving first commits; a later limit change cannot reopen the plan", async () => {
    const h = harness(), v = await newVisitor();
    const { circleId } = await h.a.setup({ caller: v, ip: "192.0.2.62", kind: "plan" });
    await h.drain();
    expect(await h.a.approve({ caller: v, circleId, generation: 1 })).toEqual({ state: "committed" });
    expect((await err(h.a.editLimit({ caller: v, circleId, limits: otherWeekend(DEFAULT_HUMAN_LIMITS) })))?.status).toBe(409);
    expect((await candidate(circleId, 1)).committed).toBe(true);
    expect((await err(h.a.approve({ caller: v, circleId, generation: 1 })))?.code).toBe("stale"); // no double commit
  }, 180_000);

  it("a vote cast on an older limits version is invalidated and that agent votes again", async () => {
    const h = harness(), v = await newVisitor();
    const { circleId } = await h.a.setup({ caller: v, ip: "192.0.2.63", kind: "plan" });
    await h.run(h.queue.shift()!); // start: round 1 turns are queued
    const first = h.queue.findIndex((j) => j.op === "turn" && parseTurnId(j.turnId).seat === 1);
    await h.run(h.queue.splice(first, 1)[0]!); // the human's agent votes on limits version 0…
    await h.a.editLimit({ caller: v, circleId, limits: otherWeekend(DEFAULT_HUMAN_LIMITS) }); // …then the human changes dates
    await h.drain();
    const c = await circle(circleId);
    expect([c.phase, c.planState, c.generation]).toEqual([2, "awaiting", 1]); // round 1 could not settle on a stale vote
    expect((await candidate(circleId, 1)).optionId).toBe("eel-garden-flat");
  }, 240_000);

  it("approving after the window closed is refused: the plan re-stages once, then expires", async () => {
    const h = harness(60), v = await newVisitor();
    const { circleId } = await h.a.setup({ caller: v, ip: "192.0.2.64", kind: "plan" });
    await h.drain();
    await new Promise((r) => setTimeout(r, 65_000));
    expect((await err(h.a.approve({ caller: v, circleId, generation: 1 })))?.code).toBe("restaged");
    expect([(await circle(circleId)).generation, (await candidate(circleId, 2)).optionId]).toEqual([2, "assalah-guesthouse"]);
    await new Promise((r) => setTimeout(r, 65_000));
    expect((await err(h.a.approve({ caller: v, circleId, generation: 2 })))?.code).toBe("expired");
    expect((await circle(circleId)).planState).toBe("expired");
  }, 300_000);
});
