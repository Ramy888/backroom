// Task 8 acceptance, on the live backroom-test project with a scripted (free) model per seat:
// a whole game runs to a correct result; two simultaneous resolves advance a phase exactly once;
// night turns are private; and a crash that loses a dispatch is recovered from the outbox.
import { afterEach, describe, expect, it } from "vitest";
import { Query } from "node-appwrite";
import type Anthropic from "@anthropic-ai/sdk";
import { agentUserId, closeId, turnId, DATABASE_ID as DB } from "@backroom/core";
import { agentTurn, type Llm } from "../functions/engine/src/agentTurn.js";
import { resolver, type Job } from "../functions/engine/src/resolver.js";
import { asUser, db, env, makeCircle } from "./helpers/fixture.js";

// Policy model: reads seat, role and phase from the prompt and answers with one post_message.
const policy: Llm = async (params) => {
  const text = String((params.messages[0] as { content: string }).content);
  const seat = Number(/You are seat (\d)/.exec(text)![1]), role = /role=(\w+)/.exec(text)![1], phase = Number(/Phase (\d+)/.exec(text)![1]);
  const cycle = Math.ceil(phase / 3);
  let target: number | null = null;
  if (/It is night/.test(text)) target = role === "wolf" ? [4, 5, 6][cycle - 1]! : role === "seer" ? 1 : null;
  if (/It is the vote/.test(text)) target = role === "wolf" ? 3 : cycle === 1 ? 2 : 1;
  return { id: "m", type: "message", role: "assistant", model: "fake", stop_reason: "tool_use", stop_sequence: null, usage: {},
    content: [{ type: "tool_use", id: "t", name: "post_message", input: { text: `seat ${seat} speaks`, target } }] } as unknown as Anthropic.Beta.BetaMessage;
};

function harness(opts: { dropResolveOnce?: string } = {}) {
  const queue: Job[] = [];
  let dropped = false;
  const r = resolver({ endpoint: env.endpoint, project: env.project, resolverKey: env.resolverKey, fire: async (j) => { queue.push(j); }, resendAfterMs: 0, staleClaimMs: 60_000 });
  const agentDeps = (id: string) => ({ endpoint: env.endpoint, project: env.project, agentKey: env.agentKey, llm: policy, model: "fake",
    dispatchResolve: async (circleId: string, phase: number) => {
      if (opts.dropResolveOnce === id && !dropped) { dropped = true; throw new Error("simulated crash after commit"); }
      queue.push({ op: "resolve", circleId, phase });
    } });
  async function drain(limit = 400) {
    for (let i = 0; i < limit && queue.length; i++) {
      const job = queue.shift()!;
      if (job.op === "turn") await agentTurn(agentDeps(job.turnId), job.turnId).catch((e) => { if (!/simulated crash/.test(String(e))) throw e; });
      else if (job.op === "start") await r.start(job.circleId);
      else if (job.op === "resolve") await r.resolve(job.circleId, job.phase);
      else throw new Error(`job without a known op: ${JSON.stringify(job)}`); // the engine rejects these in production too
    }
  }
  return { r, queue, drain };
}

let fx: Awaited<ReturnType<typeof makeCircle>> | undefined;
afterEach(async () => { await fx?.cleanup(); fx = undefined; });

describe("engine op=resolve", () => {
  it("plays a whole game to the correct result within the bounds", async () => {
    fx = await makeCircle({ phase: 0 });
    const h = harness();
    await h.r.start(fx.circle);
    await h.drain();
    const circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: fx.circle });
    expect([circle.status, circle.winner, circle.phase]).toEqual(["revealed", "village", 6]) // a finished game is revealed to its visitor (T14);
    expect(circle.executions).toBeLessThanOrEqual(60);
    const closes = (await db.listRows({ databaseId: DB, tableId: "phases", queries: [Query.equal("circleId", fx.circle), Query.orderAsc("phase")] })).rows;
    expect(closes.map((c) => [c.phase, c.status, c.eliminated ?? null, c.eliminatedRole ?? null])).toEqual([
      [1, "done", 4, "villager"], [2, "done", null, null], [3, "done", 2, "wolf"],
      [4, "done", 5, "villager"], [5, "done", null, null], [6, "done", 1, "wolf"],
    ]);
    const seerNight = await db.getRow({ databaseId: DB, tableId: "night_actions", rowId: turnId(fx.circle, 1, 3) });
    expect(seerNight.visionIsWolf).toBe(true);
    // Day speech was sequential: every living seat spoke exactly once, in seat order.
    const day1 = (await db.listRows({ databaseId: DB, tableId: "moves", queries: [Query.equal("circleId", fx.circle), Query.equal("phase", 2), Query.orderAsc("$createdAt")] })).rows;
    expect(day1.map((m) => m.seat)).toEqual([1, 2, 3, 5, 6]);
  }, 300_000); // a full game is a few hundred Appwrite calls from a laptop (Cairo → Frankfurt)

  it("two simultaneous resolves advance a phase exactly once, and night turns stay private", async () => {
    fx = await makeCircle({ phase: 0 });
    const h = harness();
    await h.r.start(fx.circle);
    // Play the night's AI turns but hold back their resolve jobs.
    const turnJobs = h.queue.splice(0);
    for (const j of turnJobs) if (j.op === "turn") await agentTurn({ endpoint: env.endpoint, project: env.project, agentKey: env.agentKey, llm: policy, model: "fake", dispatchResolve: async () => {} }, j.turnId);

    const villager = await asUser(agentUserId(fx.circle, 4));
    const seen = (await villager.listRows({ databaseId: DB, tableId: "turns", queries: [Query.equal("circleId", fx.circle)] })).rows;
    expect(seen.map((t) => t.seat)).toEqual([4]); // V5: a villager sees only its own night turn

    const results = await Promise.all([h.r.resolve(fx.circle, 1), h.r.resolve(fx.circle, 1)]);
    expect(results.filter((x) => x === "advanced")).toHaveLength(1);
    const day = (await db.listRows({ databaseId: DB, tableId: "turns", queries: [Query.equal("circleId", fx.circle), Query.equal("phase", 2)] })).rows;
    expect(day.map((t) => t.seat)).toEqual([1]); // exactly one first speaker opened
    expect((await db.getRow({ databaseId: DB, tableId: "phases", rowId: closeId(fx.circle, 1) })).status).toBe("done");
  });

  it("recovers a dispatch lost to a crash after commit (outbox, V1)", async () => {
    fx = await makeCircle({ phase: 0 });
    const lost = turnId(fx.circle, 1, 3); // the Seer's night turn: its resolve dispatch is dropped once
    const h = harness({ dropResolveOnce: lost });
    await h.r.start(fx.circle);
    await h.drain();
    // Whatever the order, the lost dispatch is still pending; a later sweep re-sends it and the game moves on.
    await h.r.resendPending(fx.circle);
    await h.drain();
    const circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: fx.circle });
    expect(circle.status).toBe("revealed");
    const pending = (await db.listRows({ databaseId: DB, tableId: "dispatches", queries: [Query.equal("circleId", fx.circle), Query.equal("status", "pending")] })).rows;
    expect(pending).toHaveLength(0);
  }, 300_000);
});
