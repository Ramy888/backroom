// Integration fixture: builds a real 6-seat circle on the backroom-test project the way setup + resolver will,
// using permsFor for every row, and tears it all down afterwards (users and rows).
import { Client, TablesDB, Users, Query, ID } from "node-appwrite";
import { agentUserId, permsFor, secretId, seatRowId, turnId, DATABASE_ID as DB, type CircleView, type Role } from "@backroom/core";

process.loadEnvFile(".env.test");
export const env = {
  endpoint: process.env.APPWRITE_ENDPOINT!, project: process.env.APPWRITE_PROJECT_ID!,
  key: process.env.APPWRITE_API_KEY!, agentKey: process.env.APPWRITE_AGENT_KEY!, resolverKey: process.env.APPWRITE_RESOLVER_KEY!,
};
const admin = new Client().setEndpoint(env.endpoint).setProject(env.project).setKey(env.key);
export const db = new TablesDB(admin);
export const users = new Users(admin);
export const asUser = async (userId: string) => {
  const { jwt } = await users.createJWT({ userId, duration: 300 });
  return new TablesDB(new Client().setEndpoint(env.endpoint).setProject(env.project).setJWT(jwt));
};

const ROLES: Role[] = ["wolf", "wolf", "seer", "villager", "villager", "villager"];

export async function makeCircle(opts: { visitorPrompt?: string; phase?: number } = {}) {
  const circle = ID.unique().replace(/[^a-z0-9]/gi, "").slice(0, 20);
  const visitor = `${circle}-v`;
  const view: CircleView = { visitor, seats: ROLES.map((role, i) => ({ seat: i + 1, user: agentUserId(circle, i + 1), role, visitor: i === 0 })) };
  for (const s of view.seats) await users.create({ userId: s.user, name: `seat ${s.seat}` });
  await users.create({ userId: visitor, name: "visitor" });
  const pub = permsFor("public", view);
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  await db.createRow({ databaseId: DB, tableId: "circles", rowId: circle, data: { kind: "werewolf", status: "active", phase: opts.phase ?? 2, visitor, visitorSeat: 1, expiresAt, lang: "en" }, permissions: pub });
  for (const s of view.seats) {
    await db.createRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(circle, s.seat), data: { circleId: circle, seat: s.seat, name: `Seat ${s.seat}`, agentUserId: s.user, controller: "ai" }, permissions: pub });
    await db.createRow({ databaseId: DB, tableId: "secrets", rowId: secretId(circle, s.seat),
      data: { circleId: circle, seat: s.seat, role: s.role, prefs: s.visitor ? opts.visitorPrompt ?? null : null }, permissions: permsFor("secret", view, s.seat) });
  }
  return {
    circle, visitor, view,
    // What the resolver does when it opens a turn: precompute the result + log grants (agents can't read roles).
    async openTurn(phase: number, seat: number, kind: "night" | "day" | "vote") {
      const id = turnId(circle, phase, seat);
      const result = kind === "night" ? permsFor("night", view, seat) : pub;
      await db.createRow({ databaseId: DB, tableId: "turns", rowId: id, data: { circleId: circle, phase, seat, kind, status: "pending", perms: JSON.stringify({ result, log: permsFor("turnlog", view, seat) }) }, permissions: kind === "night" ? permsFor("night", view, seat) : pub });
      return id;
    },
    async cleanup() {
      for (const t of ["turn_logs", "dispatches", "moves", "night_actions", "turns", "phases", "secrets", "seats"]) {
        const { rows } = await db.listRows({ databaseId: DB, tableId: t, queries: [Query.equal("circleId", circle), Query.limit(100)] });
        for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: t, rowId: r.$id });
      }
      await db.deleteRow({ databaseId: DB, tableId: "circles", rowId: circle }).catch(() => {});
      for (const u of [...view.seats.map((s) => s.user), visitor]) await users.delete({ userId: u }).catch(() => {});
    },
  };
}
