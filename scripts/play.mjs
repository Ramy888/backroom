// Plays one real AI-only game through the DEPLOYED api + engine Functions, then writes a sanitized replay timeline
// (seat labels only, no user ids) for the landing page and reports per-turn latency. Cleans up the circle after.
// Usage: node scripts/play.mjs [--env .env.test] [--out web/public/replay.json]
import { Client, Functions, TablesDB, Users, Query, ID } from "node-appwrite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" }, out: { type: "string", default: "web/public/replay.json" } } });
process.loadEnvFile(values.env);
const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const db = new TablesDB(admin), users = new Users(admin);
const DB = "backroom";
const all = async (tableId, circleId) => (await db.listRows({ databaseId: DB, tableId, queries: [Query.equal("circleId", circleId), Query.orderAsc("$createdAt"), Query.limit(200)] })).rows;

const visitor = await users.create({ userId: ID.unique(), name: "play-script visitor" });
let circleId;
try {
  // Call the api Function as that user, exactly as the browser will (x-appwrite-user-id is set by Appwrite).
  const { jwt } = await users.createJWT({ userId: visitor.$id, duration: 900 });
  const asVisitor = new Functions(new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt));
  const t0 = Date.now();
  const ex = await asVisitor.createExecution({ functionId: "api", body: JSON.stringify({ action: "setup", lang: "en" }), async: false });
  const setup = JSON.parse(ex.responseBody || "{}");
  if (!setup.circleId) throw new Error(`setup failed: ${ex.responseStatusCode} ${ex.responseBody}`);
  circleId = setup.circleId;
  console.log(`setup ${ex.responseStatusCode} in ${Date.now() - t0} ms → circle ${circleId}`);

  let circle;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId });
    process.stdout.write(`\rphase ${circle.phase} · ${circle.status} · executions ${circle.executions}   `);
    if (circle.status !== "active") break;
  }
  console.log();

  const turns = await all("turns", circleId);
  const lat = turns.filter((t) => t.status !== "pending").map((t) => Date.parse(t.$updatedAt) - Date.parse(t.$createdAt)).sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
  const seats = await all("seats", circleId);
  const secrets = await all("secrets", circleId);
  const label = (n) => (n === 6 ? "Wolf (visitor)" : seats.find((s) => s.seat === n)?.name ?? `Seat ${n}`);
  const role = (n) => secrets.find((s) => s.seat === n)?.role;

  const timeline = [];
  for (const m of await all("moves", circleId)) timeline.push({ at: m.$createdAt, phase: m.phase, seat: m.seat, who: label(m.seat), kind: m.kind, text: m.text ?? "", target: m.target ?? null });
  for (const c of await all("phases", circleId)) timeline.push({ at: c.$updatedAt, phase: c.phase, kind: "close", eliminated: c.eliminated ?? null, eliminatedRole: c.eliminatedRole ?? null });
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  const start = Date.parse(timeline[0]?.at ?? new Date().toISOString());
  const replay = {
    recordedAt: new Date().toISOString(), winner: circle.winner, phases: circle.phase,
    seats: seats.map((s) => ({ seat: s.seat, name: label(s.seat), role: role(s.seat) })), // revealed: the game is over
    events: timeline.map(({ at, ...e }) => ({ t: Date.parse(at) - start, ...e })),
  };
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, JSON.stringify(replay, null, 1));
  console.log(`result: ${circle.status} · winner ${circle.winner} · phase ${circle.phase} · executions ${circle.executions}/60`);
  console.log(`turns ${lat.length} · latency p50 ${p(0.5)} ms · p95 ${p(0.95)} ms · max ${lat.at(-1)} ms`);
  console.log(`replay → ${values.out} (${replay.events.length} events)`);
} finally {
  if (circleId) {
    for (const t of ["turn_logs", "dispatches", "moves", "night_actions", "turns", "phases", "secrets", "seats"]) {
      for (;;) { const rows = await all(t, circleId); if (!rows.length) break; for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: t, rowId: r.$id }); }
    }
    await db.deleteRow({ databaseId: DB, tableId: "circles", rowId: circleId }).catch(() => {});
    for (let s = 1; s <= 6; s++) await users.delete({ userId: `${circleId}-a${s}` }).catch(() => {});
  }
  await users.delete({ userId: visitor.$id }).catch(() => {});
}
