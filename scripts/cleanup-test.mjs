// Removes every circle, its rows, its agent users and the cap counters from the TEST project only.
// Refuses to run against any other project. Usage: node scripts/cleanup-test.mjs --env .env.test
import { Client, TablesDB, Users, Query } from "node-appwrite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
if (process.env.APPWRITE_PROJECT_ID !== "backroom-test") throw new Error("cleanup-test only runs against backroom-test");
const c = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const db = new TablesDB(c), users = new Users(c);
const DB = "backroom";
let rows = 0, gone = 0;
for (const t of ["turn_logs", "dispatches", "moves", "night_actions", "turns", "phases", "secrets", "seats", "circles", "plan_candidates", "approvals"]) {
  for (;;) {
    const page = (await db.listRows({ databaseId: DB, tableId: t, queries: [Query.limit(100)] })).rows;
    if (!page.length) break;
    await Promise.all(page.map((r) => db.deleteRow({ databaseId: DB, tableId: t, rowId: r.$id }))); rows += page.length;
  }
}
for (const r of (await db.listRows({ databaseId: DB, tableId: "meta", queries: [Query.limit(100)] })).rows.filter((r) => r.$id.startsWith("cap-"))) {
  await db.deleteRow({ databaseId: DB, tableId: "meta", rowId: r.$id }); rows++;
}
for (;;) {
  const { users: page } = await users.list({ queries: [Query.limit(100)] });
  if (!page.length) break;
  await Promise.all(page.map((u) => users.delete({ userId: u.$id }))); gone += page.length;
}
console.log(`test project cleaned: ${rows} rows, ${gone} users`);
