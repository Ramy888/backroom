// Seeds the public Plan catalog (options) from packages/core/src/dahab.ts, idempotently (fixed row ids).
// Usage: node scripts/seed-options.mjs --env .env.test
import { Client, TablesDB } from "node-appwrite";
import { parseArgs } from "node:util";
import { DAHAB_OPTIONS } from "../packages/core/src/dahab.ts";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const db = new TablesDB(new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));
for (const o of DAHAB_OPTIONS) {
  const data = { title: o.title, titleAr: o.titleAr, dates: o.weekend, pricePerPerson: o.pricePerPerson, tags: o.tags.join(","), location: o.location };
  await db.updateRow({ databaseId: "backroom", tableId: "options", rowId: o.id, data })
    .catch(() => db.createRow({ databaseId: "backroom", tableId: "options", rowId: o.id, data }));
}
console.log(`options seeded: ${DAHAB_OPTIONS.length}`);
