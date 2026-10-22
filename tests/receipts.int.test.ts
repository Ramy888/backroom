// Task 14 acceptance on backroom-test: the reveal grants the visitor read on role rows only; share writes one public
// receipt that names no user, survives the circle's sweep, and never widens what another circle's agent can read.
import { afterAll, describe, expect, it } from "vitest";
import { Client, Query, ID, TablesDB } from "node-appwrite";
import { agentUserId, DATABASE_ID as DB } from "@backroom/core";
import { api } from "../functions/api/src/actions.js";
import { resolver } from "../functions/engine/src/resolver.js";
import { asUser, db, env, users } from "./helpers/fixture.js";

const starter = resolver({ endpoint: env.endpoint, project: env.project, resolverKey: env.key, fire: async () => {} });
const a = api({ endpoint: env.endpoint, project: env.project, key: env.key, ipSalt: `r-${Date.now()}`,
  fire: async (j) => { if (j.op === "start") await starter.start(j.circleId); },
  caps: { perIpHour: 10, perDay: 50, judgePerDay: 5, perMonth: 500, promptsPerGame: 2 }, deploy: { deployId: "test-deploy", commit: "abc1234" } });
const visitors: string[] = [], circles: string[] = [], receipts: string[] = [];
const newVisitor = async () => { const u = await users.create({ userId: ID.unique(), name: "receipt visitor" }); visitors.push(u.$id); return u.$id; };
const game = async () => { const v = await newVisitor(); const { circleId } = await a.setup({ caller: v, ip: "192.0.2.14" }); circles.push(circleId); return { v, circleId }; };
const end = (circleId: string) => db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { status: "ended", winner: "wolves" } });
const guest = new TablesDB(new Client().setEndpoint(env.endpoint).setProject(env.project)); // no session at all

afterAll(async () => {
  for (const c of circles) await db.updateRow({ databaseId: DB, tableId: "circles", rowId: c, data: { expiresAt: new Date(0).toISOString() } }).catch(() => {});
  await a.sweep();
  for (const v of visitors) await users.delete({ userId: v }).catch(() => {});
  for (const r of receipts) await db.deleteRow({ databaseId: DB, tableId: "receipts", rowId: r }).catch(() => {});
  const { rows } = await db.listRows({ databaseId: DB, tableId: "meta", queries: [Query.startsWith("$id", "cap-"), Query.limit(100)] });
  for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: r.$id });
});

describe("reveal and receipts", () => {
  it("reveals role rows to the visitor at game end, and nothing else", async () => {
    const { v, circleId } = await game();
    const asV = await asUser(v);
    const secrets = () => asV.listRows({ databaseId: DB, tableId: "secrets", queries: [Query.equal("circleId", circleId)] });
    expect((await secrets()).rows.map((r) => r.seat)).toEqual([6]); // during play: only their own wolf
    await end(circleId);
    expect(await starter.reveal(circleId)).toBe("revealed");
    expect(await starter.reveal(circleId)).toBe("revealed"); // idempotent
    expect((await secrets()).rows.map((r) => r.seat).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // Night turns keep their grants: the visitor still sees only the wolves' turns, never the Seer's.
    const roles = new Map((await secrets()).rows.map((r) => [r.seat, r.role]));
    const turns = (await asV.listRows({ databaseId: DB, tableId: "turns", queries: [Query.equal("circleId", circleId)] })).rows;
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((t) => roles.get(t.seat) === "wolf")).toBe(true);
  });

  it("shares one public receipt that names no user and outlives the circle", async () => {
    const { v, circleId } = await game();
    await expect(a.share({ caller: v, circleId })).rejects.toMatchObject({ status: 409 }); // not ended yet
    await end(circleId);
    await expect(a.share({ caller: await newVisitor(), circleId })).rejects.toMatchObject({ status: 403 }); // not their circle
    const { receiptId } = await a.share({ caller: v, circleId });
    receipts.push(receiptId);
    expect((await a.share({ caller: v, circleId })).receiptId).toBe(receiptId); // one receipt per circle
    expect(receiptId).not.toContain(circleId);

    const row = await guest.getRow({ databaseId: DB, tableId: "receipts", rowId: receiptId });
    expect(row.snapshot).not.toContain(v);
    expect(row.snapshot).not.toContain(circleId);
    expect(row.snapshot).not.toContain("user:");
    const snap = JSON.parse(row.snapshot);
    expect(snap.rows).toHaveLength(6);
    expect(snap.rows.find((r: { seat: number }) => r.seat === 6).readableBy).toEqual(["seat 6", "visitor"]);
    expect(snap.rows.filter((r: { seat: number }) => r.seat !== 6).every((r: { seat: number; readableBy: string[] }) => r.readableBy.join() === `seat ${r.seat}`)).toBe(true);
    expect([row.deployId, row.commit]).toEqual(["test-deploy", "abc1234"]);

    // Reset: sweep the circle, then a guest still opens the receipt.
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { expiresAt: new Date(0).toISOString() } });
    await a.sweep();
    await expect(db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId })).rejects.toMatchObject({ code: 404 });
    expect((await guest.getRow({ databaseId: DB, tableId: "receipts", rowId: receiptId })).snapshot).toBe(row.snapshot);
  });

  it("a wolf agent in another circle still lists 0 foreign secrets after reveals and shares", async () => {
    const { circleId } = await game();
    const wolf = await asUser(agentUserId(circleId, 6));
    const all = (await wolf.listRows({ databaseId: DB, tableId: "secrets", queries: [Query.limit(100)] })).rows;
    expect(all.map((r) => `${r.circleId}/${r.seat}`)).toEqual([`${circleId}/6`]);
  });
});
