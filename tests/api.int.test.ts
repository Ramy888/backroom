// Task 9 acceptance on backroom-test: setup builds a correct, started circle; caps are keyed to the network not the
// session; another visitor can't act on your circle (IDOR); the kill switch stops new games; sweep removes everything.
import { afterAll, describe, expect, it } from "vitest";
import { Query, ID } from "node-appwrite";
import { agentUserId, secretId, DATABASE_ID as DB } from "@backroom/core";
import { api, ApiError } from "../functions/api/src/actions.js";
import { resolver } from "../functions/engine/src/resolver.js";
import { asUser, db, env, users } from "./helpers/fixture.js";

const salt = `t-${Date.now()}`;
const jobs: unknown[] = [];
const starter = resolver({ endpoint: env.endpoint, project: env.project, resolverKey: env.key, fire: async (j) => { jobs.push(j); } });
const make = (over: Partial<Parameters<typeof api>[0]> = {}) => api({ endpoint: env.endpoint, project: env.project, key: env.key,
  fire: async (j) => { if (j.op === "start") await starter.start(j.circleId); else jobs.push(j); }, ipSalt: salt, judgeCode: "judge-xyz",
  caps: { perIpHour: 2, perDay: 50, judgePerDay: 5, perMonth: 500, promptsPerGame: 2 }, ...over });
const visitors: string[] = [];
const newVisitor = async () => { const u = await users.create({ userId: ID.unique(), name: "test visitor" }); visitors.push(u.$id); return u.$id; };
const circles: string[] = [];

afterAll(async () => {
  // Expire every circle a test visitor owns (including any a failed assertion left untracked), then sweep.
  for (const v of visitors) for (const c of (await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.equal("visitor", v)] })).rows) circles.push(c.$id);
  for (const c of circles) await db.updateRow({ databaseId: DB, tableId: "circles", rowId: c, data: { expiresAt: new Date(0).toISOString() } }).catch(() => {});
  await make().sweep();
  for (const v of visitors) await users.delete({ userId: v }).catch(() => {});
  const { rows } = await db.listRows({ databaseId: DB, tableId: "meta", queries: [Query.limit(100)] });
  for (const r of rows.filter((r) => r.$id.startsWith("cap-") || r.$id === "config")) await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: r.$id });
});

describe("api", () => {
  it("setup builds a started 6-seat circle with the visitor's wolf at seat 6 and shuffled roles", async () => {
    const v = await newVisitor();
    const out = await make().setup({ caller: v, ip: "203.0.113.7", prompt: "  Claim to be the Seer.  " });
    circles.push(out.circleId);
    expect(out.seat).toBe(6);
    const secrets = (await db.listRows({ databaseId: DB, tableId: "secrets", queries: [Query.equal("circleId", out.circleId)] })).rows;
    const roles = secrets.map((s) => s.role).sort();
    expect(roles).toEqual(["seer", "villager", "villager", "villager", "wolf", "wolf"]);
    expect(secrets.find((s) => s.seat === 6)!.role).toBe("wolf");
    expect(secrets.find((s) => s.seat === 6)!.prefs).toBe("Claim to be the Seer."); // in place before night 1
    const circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: out.circleId });
    expect([circle.phase, circle.status]).toEqual([1, "active"]);
    expect(jobs.length).toBeGreaterThanOrEqual(2); // night turns for both wolves and the seer were dispatched
    // The visitor reads their own wolf's secret and nothing else.
    const asV = await asUser(v);
    const visible = (await asV.listRows({ databaseId: DB, tableId: "secrets", queries: [Query.equal("circleId", out.circleId)] })).rows;
    expect(visible.map((s) => s.seat)).toEqual([6]);
  });

  it("the per-network cap holds even with a fresh anonymous session", async () => {
    const a = make();
    await a.setup({ caller: await newVisitor(), ip: "198.51.100.9" }).then((o) => circles.push(o.circleId));
    await a.setup({ caller: await newVisitor(), ip: "198.51.100.9" }).then((o) => circles.push(o.circleId));
    const third = await a.setup({ caller: await newVisitor(), ip: "198.51.100.9" }).catch((e) => e);
    expect(third).toBeInstanceOf(ApiError);
    expect((third as ApiError).status).toBe(429);
  });

  it("another visitor cannot act on your circle (IDOR → 403)", async () => {
    const owner = await newVisitor(), stranger = await newVisitor();
    const { circleId } = await make().setup({ caller: owner, ip: "192.0.2.1" });
    circles.push(circleId);
    for (const call of [() => make().inject({ caller: stranger, circleId, prompt: "x" }), () => make().token({ caller: stranger, circleId })]) {
      const e = await call().catch((x) => x);
      expect((e as ApiError).status).toBe(403);
    }
    await make().inject({ caller: owner, circleId, prompt: "Find the Seer." });
    expect((await db.getRow({ databaseId: DB, tableId: "secrets", rowId: secretId(circleId, 6) })).prefs).toBe("Find the Seer.");
  });

  it("the kill switch stops new games", async () => {
    // upsertRow returned {} and persisted nothing here (observed 2026-10-21), so config is written with createRow.
    await db.createRow({ databaseId: DB, tableId: "meta", rowId: "config", data: { flag: false }, permissions: [] });
    const e = await make().setup({ caller: await newVisitor(), ip: "192.0.2.50" }).catch((x) => x);
    expect((e as ApiError).status).toBe(503);
    await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: "config" });
  });

  it("sweep deletes an expired circle's rows and agent users", async () => {
    const v = await newVisitor();
    const { circleId } = await make().setup({ caller: v, ip: "192.0.2.77" });
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    const paused = await make().sweep(-1); // budget already spent: nothing is touched, the backlog waits for the next run
    expect(paused.swept).toBe(0);
    expect(paused.remaining).toBeGreaterThanOrEqual(1);
    expect(await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }).catch(() => null)).not.toBeNull();
    for (let run = 0; run < 8 && (await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }).then(() => true, () => false)); run++) await make().sweep(); // other expired games may queue ahead
    expect(await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }).catch(() => null)).toBeNull();
    expect(await users.get({ userId: agentUserId(circleId, 1) }).catch(() => null)).toBeNull();
  }, 420_000);
});
