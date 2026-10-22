// Post-deploy smoke test (the K1 probe, against the deployed app): a throwaway visitor starts a game through the api
// Function, then the wolf token reads every seat's secret over plain REST. PASS = own row 200, all five others 404.
// Usage: node scripts/smoke.mjs --env .env.test
import { Client, Functions, TablesDB, Users, Query, ID } from "node-appwrite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const db = new TablesDB(admin), users = new Users(admin);
const DB = "backroom";

const visitor = await users.create({ userId: ID.unique(), name: "smoke visitor" });
let circleId;
try {
  const { jwt } = await users.createJWT({ userId: visitor.$id, duration: 300 });
  const ex = await new Functions(new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt))
    .createExecution({ functionId: "api", body: JSON.stringify({ action: "setup", lang: "en" }), async: false });
  const setup = JSON.parse(ex.responseBody || "{}");
  if (!setup.circleId) throw new Error(`setup failed: ${ex.responseStatusCode} ${ex.responseBody}`);
  circleId = setup.circleId;
  const codes = [];
  for (let seat = 1; seat <= 6; seat++) {
    const r = await fetch(`${endpoint}/tablesdb/${DB}/tables/secrets/rows/${circleId}-s${seat}-secret`, { headers: { "X-Appwrite-Project": project, "X-Appwrite-JWT": setup.wolfToken } });
    codes.push(r.status);
  }
  const pass = codes[setup.seat - 1] === 200 && codes.filter((_, i) => i !== setup.seat - 1).every((c) => c === 404);
  console.log(`SMOKE ${pass ? "PASS" : "FAIL"}  setup ${ex.responseStatusCode} · wolf token reads seats 1-6 → ${codes.join(" ")}`);
  if (!pass) process.exitCode = 1;
} finally {
  if (circleId) {
    await db.updateRow({ databaseId: DB, tableId: "circles", rowId: circleId, data: { status: "ended", winner: "stalled" } }).catch(() => {}); // stop the engine first
    for (const t of ["turn_logs", "dispatches", "moves", "night_actions", "turns", "phases", "secrets", "seats"]) {
      for (;;) {
        const { rows } = await db.listRows({ databaseId: DB, tableId: t, queries: [Query.equal("circleId", circleId), Query.limit(100)] });
        if (!rows.length) break;
        for (const r of rows) await db.deleteRow({ databaseId: DB, tableId: t, rowId: r.$id });
      }
    }
    await db.deleteRow({ databaseId: DB, tableId: "circles", rowId: circleId }).catch(() => {});
    for (let s = 1; s <= 6; s++) await users.delete({ userId: `${circleId}-a${s}` }).catch(() => {});
  }
  await users.delete({ userId: visitor.$id }).catch(() => {});
}
