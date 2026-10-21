// Applies packages/core/src/schema.ts to a project, idempotently: creates the database and any missing table
// (columns + indexes inline), never alters or drops an existing one. After Checkpoint 1 the schema is frozen,
// and a change to an existing table needs a ledger row and a deliberate migration.
// Usage: node scripts/schema.mjs [--env .env.test]
import { Client, TablesDB } from "node-appwrite";
import { parseArgs } from "node:util";
import { DATABASE_ID, TABLES } from "../packages/core/src/schema.ts";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const db = new TablesDB(new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));

await db.get({ databaseId: DATABASE_ID }).catch(() => db.create({ databaseId: DATABASE_ID, name: DATABASE_ID }));
async function addColumn(tableId, c) {
  const base = { databaseId: DATABASE_ID, tableId, key: c.key, required: !!c.required };
  if (c.type === "text") return db.createTextColumn(base);
  if (c.type === "varchar") return db.createVarcharColumn({ ...base, size: c.size });
  if (c.type === "integer") return db.createIntegerColumn({ ...base, min: c.min, max: c.max, xdefault: c.default });
  if (c.type === "boolean") return db.createBooleanColumn({ ...base, xdefault: c.default });
  if (c.type === "enum") return db.createEnumColumn({ ...base, elements: c.elements, xdefault: c.default });
  throw new Error(`addColumn: unsupported type ${c.type} for ${tableId}.${c.key}`);
}
const existing = new Set((await db.listTables({ databaseId: DATABASE_ID })).tables.map((t) => t.$id));
for (const t of TABLES) {
  if (existing.has(t.id)) {
    // Before the Checkpoint-1 freeze, add any newly declared column (never alter or drop one).
    const have = new Set((await db.listColumns({ databaseId: DATABASE_ID, tableId: t.id })).columns.map((c) => c.key));
    for (const c of t.columns.filter((c) => !have.has(c.key))) { await addColumn(t.id, c); console.log(`+ ${t.id}.${c.key}`); }
    if (t.columns.every((c) => have.has(c.key))) console.log(`= ${t.id} (exists)`);
    continue;
  }
  await db.createTable({
    databaseId: DATABASE_ID, tableId: t.id, name: t.id,
    rowSecurity: !t.publicRead, permissions: t.publicRead ? ['read("any")'] : [],
    columns: t.columns, indexes: t.indexes,
  });
  console.log(`+ ${t.id} (${t.columns.length} columns, ${t.indexes.length} indexes)`);
}
// Columns and indexes build asynchronously; wait until every one is available or report what failed.
for (let i = 0; i < 60; i++) {
  const pending = [];
  for (const t of TABLES) {
    const cols = (await db.listColumns({ databaseId: DATABASE_ID, tableId: t.id })).columns;
    const idx = (await db.listIndexes({ databaseId: DATABASE_ID, tableId: t.id })).indexes;
    for (const x of [...cols, ...idx]) if (x.status !== "available") pending.push(`${t.id}.${x.key}:${x.status}`);
  }
  if (!pending.length) { console.log(`schema ready: ${TABLES.length} tables`); process.exit(0); }
  if (pending.some((p) => /failed|stuck/.test(p))) { console.log(`schema FAILED: ${pending.join(", ")}`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("schema TIMEOUT waiting for columns/indexes");
process.exit(1);
