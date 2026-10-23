// Task 15 acceptance on backroom-test: the kill switch stops new games at once; the judge code still plays when the
// daily cap is hit; the operator code is checked server-side and brute force is capped; the demo circle's wolf token
// is open to any visitor, while every other circle's token stays its visitor's.
import { afterAll, describe, expect, it } from "vitest";
import { Query, ID } from "node-appwrite";
import { DATABASE_ID as DB } from "@backroom/core";
import { api, ApiError } from "../functions/api/src/actions.js";
import { resolver } from "../functions/engine/src/resolver.js";
import { db, env, users } from "./helpers/fixture.js";

const salt = `o-${Date.now()}`;
const starter = resolver({ endpoint: env.endpoint, project: env.project, resolverKey: env.key, fire: async () => {} });
const make = (caps = { perIpHour: 20, perDay: 1, judgePerDay: 2, perMonth: 500, promptsPerGame: 2 }, demoCircleId?: string) =>
  api({ endpoint: env.endpoint, project: env.project, key: env.key, ipSalt: salt, judgeCode: "judge-test-code", operatorCode: "op-test-code",
    fire: async (j) => { if (j.op === "start") await starter.start(j.circleId); }, caps, demoCircleId });
const visitors: string[] = [], circles: string[] = [];
const newVisitor = async () => { const u = await users.create({ userId: ID.unique(), name: "ops visitor" }); visitors.push(u.$id); return u.$id; };
const err = (p: Promise<unknown>) => p.then(() => null, (e) => e as ApiError);

afterAll(async () => {
  await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: "config" }).catch(() => {});
  for (const v of visitors) for (const c of (await db.listRows({ databaseId: DB, tableId: "circles", queries: [Query.equal("visitor", v)] })).rows) circles.push(c.$id);
  for (const c of circles) await db.updateRow({ databaseId: DB, tableId: "circles", rowId: c, data: { expiresAt: new Date(0).toISOString() } }).catch(() => {});
  await make().sweep();
  for (const v of visitors) await users.delete({ userId: v }).catch(() => {});
  const { rows } = await db.listRows({ databaseId: DB, tableId: "meta", queries: [Query.startsWith("$id", "cap-"), Query.limit(100)] });
  for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: r.$id });
});

describe("operator, judge and demo", () => {
  it("the operator code is checked on the server and guesses are capped per network", async () => {
    const a = make();
    expect((await err(a.op({ ip: "203.0.113.50", code: "wrong", action: "status" })))?.status).toBe(403);
    for (let i = 0; i < 9; i++) await err(a.op({ ip: "203.0.113.50", code: "wrong", action: "status" }));
    expect((await err(a.op({ ip: "203.0.113.50", code: "op-test-code", action: "status" })))?.status).toBe(429); // 11th try this hour
    const status = await a.op({ ip: "203.0.113.51", code: "op-test-code", action: "status" });
    expect(status).toMatchObject({ challengeOpen: true });
    expect(status.counters).toHaveProperty("day");
  });

  it("closing the challenge blocks new games at once, reopening lets them through", async () => {
    const a = make({ perIpHour: 20, perDay: 50, judgePerDay: 2, perMonth: 500, promptsPerGame: 2 });
    await a.op({ ip: "203.0.113.52", code: "op-test-code", action: "close" });
    const t0 = Date.now();
    const blocked = await err(a.setup({ caller: await newVisitor(), ip: "198.51.100.40" }));
    expect([blocked?.status, blocked?.code]).toEqual([503, "paused"]);
    expect(Date.now() - t0).toBeLessThan(5000);
    await a.op({ ip: "203.0.113.52", code: "op-test-code", action: "open" });
    const ok = await a.setup({ caller: await newVisitor(), ip: "198.51.100.40" });
    circles.push(ok.circleId);
  });

  it("the judge code plays when the daily cap is hit, and skips the per-network cap", async () => {
    const today = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 8);
    for (const id of [`cap-day-${today}`, `cap-judge-${today}`]) await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: id }).catch(() => {}); // the day counters are global
    const a = make({ perIpHour: 1, perDay: 1, judgePerDay: 2, perMonth: 500, promptsPerGame: 2 });
    circles.push((await a.setup({ caller: await newVisitor(), ip: "198.51.100.41" })).circleId); // uses today's 1 game
    const capped = await err(a.setup({ caller: await newVisitor(), ip: "198.51.100.42" }));
    expect([capped?.status, capped?.code]).toEqual([429, "day"]);
    circles.push((await a.setup({ caller: await newVisitor(), ip: "198.51.100.41", judgeCode: "judge-test-code" })).circleId);
    circles.push((await a.setup({ caller: await newVisitor(), ip: "198.51.100.41", judgeCode: "judge-test-code" })).circleId);
    expect((await err(a.setup({ caller: await newVisitor(), ip: "198.51.100.41", judgeCode: "judge-test-code" })))?.code).toBe("day"); // reserve of 2 used
  });

  it("any visitor gets the demo circle's wolf token; other circles stay their visitor's", async () => {
    const owner = await newVisitor();
    const { circleId } = await make({ perIpHour: 20, perDay: 50, judgePerDay: 2, perMonth: 500, promptsPerGame: 2 }).setup({ caller: owner, ip: "198.51.100.43" });
    circles.push(circleId);
    const stranger = await newVisitor();
    expect((await err(make().token({ caller: stranger, circleId })))?.status).toBe(403);
    const asDemo = make(undefined, circleId);
    expect((await asDemo.token({ caller: stranger, circleId })).wolfToken).toMatch(/^ey/);
    expect((await err(asDemo.inject({ caller: stranger, circleId, prompt: "hi" })))?.status).toBe(403); // watching, not playing
  });
});
