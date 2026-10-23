// Seer-found metric (Task 19): plays N AI-only games through the DEPLOYED Functions, then scores every Seer night
// check against chance (living wolves / living other seats that night). Writes docs/metrics/seer.json and cleans up.
// Usage: node scripts/batch.mjs --env .env.test --games 10 [--parallel 5]   (real Claude: about $0.25 a game)
import { Client, Functions, TablesDB, Users, Query, ID } from "node-appwrite";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" }, games: { type: "string", default: "10" }, parallel: { type: "string", default: "5" } } });
process.loadEnvFile(values.env);
const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key, JUDGE_CODE } = process.env;
const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const db = new TablesDB(admin), users = new Users(admin), DB = "backroom";
const all = async (tableId, circleId) => (await db.listRows({ databaseId: DB, tableId, queries: [Query.equal("circleId", circleId), Query.orderAsc("$createdAt"), Query.limit(200)] })).rows;

async function playOne(n) {
  const v = await users.create({ userId: ID.unique(), name: `batch ${n}` });
  try {
    const fns = new Functions(new Client().setEndpoint(endpoint).setProject(project).setJWT((await users.createJWT({ userId: v.$id, duration: 3600 })).jwt));
    const ex = await fns.createExecution({ functionId: "api", body: JSON.stringify({ action: "setup", lang: "en", judgeCode: JUDGE_CODE }), async: false });
    const { circleId } = JSON.parse(ex.responseBody || "{}");
    if (!circleId) throw new Error(`setup ${ex.responseStatusCode} ${ex.responseBody}`);
    let circle;
    for (let i = 0; i < 180; i++) { await new Promise((r) => setTimeout(r, 5000)); circle = await db.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }); if (circle.status !== "active") break; }
    const roles = new Map((await all("secrets", circleId)).map((s) => [s.seat, s.role]));
    const seer = [...roles].find(([, r]) => r === "seer")[0];
    const closes = await all("phases", circleId);
    const checks = (await all("night_actions", circleId)).filter((a) => a.seat === seer && a.target).map((a) => {
      const dead = new Set(closes.filter((c) => c.phase < a.phase && c.eliminated).map((c) => c.eliminated));
      const others = [...roles.keys()].filter((s) => s !== seer && !dead.has(s));
      return { phase: a.phase, hit: roles.get(a.target) === "wolf", chance: others.filter((s) => roles.get(s) === "wolf").length / others.length };
    });
    console.log(`game ${n}: ${circle.status} · ${circle.winner} · phase ${circle.phase} · seer checks ${checks.map((c) => (c.hit ? "W" : "-")).join("") || "none"}`);
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { expiresAt: new Date().toISOString() } }); // the hourly sweep removes it
    return { winner: circle.winner, phases: circle.phase, checks };
  } finally { await users.delete({ userId: v.$id }).catch(() => {}); }
}

const N = Number(values.games), P = Number(values.parallel), games = [];
for (let i = 0; i < N; i += P) games.push(...(await Promise.all(Array.from({ length: Math.min(P, N - i) }, (_, j) => playOne(i + j + 1).catch((e) => ({ error: String(e.message ?? e) }))))));
const ok = games.filter((g) => !g.error), checks = ok.flatMap((g) => g.checks);
const hits = checks.filter((c) => c.hit).length, expected = checks.reduce((n, c) => n + c.chance, 0);
const summary = { recordedAt: new Date().toISOString(), model: process.env.AGENT_MODEL ?? "claude-haiku-5-5", games: ok.length, failed: games.length - ok.length,
  winners: Object.fromEntries([...new Set(ok.map((g) => g.winner))].map((w) => [w, ok.filter((g) => g.winner === w).length])),
  seerChecks: checks.length, wolfHits: hits, expectedByChance: Number(expected.toFixed(2)),
  verdict: checks.length < 15 ? "too few checks to say" : hits > expected * 1.5 ? "above chance" : "about chance" };
mkdirSync("docs/metrics", { recursive: true });
writeFileSync("docs/metrics/seer.json", JSON.stringify({ summary, games: ok }, null, 1));
console.log("SEER METRIC", JSON.stringify(summary));
