// Day-0 probe: settles the platform facts the whole design rests on, against the backroom-test project.
// Kill checks (any FAIL means pivot, see docs/designs/backroom.md "Day-0 ranking"):
//   K1  a JWT client is denied rows it was not granted (getRow 404, omitted from listRows)
//   K2  2 Functions exist on Free and separately scoped API keys are enforced
//   K3  a staged transaction update conflicts when the same row changes outside it before commit
// Usage: node scripts/day0-probe.mjs --only kill [--env .env.test]
// Prints evidence (status codes, error types), never secrets. Cleans up everything it created.
import { Client, Users, TablesDB, Functions, Permission, Role, ID, Query, Runtime, AppwriteException } from "node-appwrite";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" }, only: { type: "string", default: "kill" } } });
process.loadEnvFile(values.env);
const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;

const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const users = new Users(admin), db = new TablesDB(admin), fns = new Functions(admin);
const asJwt = (jwt) => new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt));
const DB = "probe", T = "secrets";
const results = [];
const report = (id, pass, evidence) => { results.push({ id, pass }); console.log(`${id} ${pass ? "PASS" : "FAIL"}  ${evidence}`); };
const errInfo = (e) => (e instanceof AppwriteException ? `${e.code} ${e.type}` : String(e?.message ?? e));
const tryCall = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, err: e }; } };

async function waitColumns() {
  for (let i = 0; i < 30; i++) {
    const { columns } = await db.listColumns({ databaseId: DB, tableId: T });
    if (columns.every((c) => c.status === "available")) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("columns never became available");
}

async function jwtFor(userId) {
  // E2: record whether a server-created user needs a session before createJWT.
  const direct = await tryCall(() => users.createJWT({ userId, duration: 120 }));
  if (direct.ok) return { jwt: direct.value.jwt, via: "createJWT without session" };
  const s = await users.createSession({ userId });
  const viaSession = await users.createJWT({ userId, sessionId: s.$id, duration: 120 });
  return { jwt: viaSession.jwt, via: `needs session (direct: ${errInfo(direct.err)})` };
}

const created = { users: [], fns: [] };
try {
  await db.create({ databaseId: DB, name: "probe" });
  await db.createTable({ databaseId: DB, tableId: T, name: T, rowSecurity: true, permissions: [] });
  await db.createVarcharColumn({ databaseId: DB, tableId: T, key: "v", size: 64, required: false });
  await db.createIntegerColumn({ databaseId: DB, tableId: T, key: "n", required: false, xdefault: 0 });
  await waitColumns();

  // ---- K1: JWT isolation ----
  const a = await users.create({ userId: ID.unique(), name: "probe-a" });
  const b = await users.create({ userId: ID.unique(), name: "probe-b" });
  created.users.push(a.$id, b.$id);
  const rowId = "seat-a-secret";
  await db.createRow({ databaseId: DB, tableId: T, rowId, data: { v: "seer" }, permissions: [Permission.read(Role.user(a.$id))] });
  const ja = await jwtFor(a.$id), jb = await jwtFor(b.$id);
  const bGet = await tryCall(() => asJwt(jb.jwt).getRow({ databaseId: DB, tableId: T, rowId }));
  const bList = await tryCall(() => asJwt(jb.jwt).listRows({ databaseId: DB, tableId: T, queries: [Query.limit(100)] }));
  const aGet = await tryCall(() => asJwt(ja.jwt).getRow({ databaseId: DB, tableId: T, rowId }));
  const bGetCode = bGet.ok ? "200 (LEAK)" : errInfo(bGet.err);
  const bListN = bList.ok ? bList.value.rows.length : `error ${errInfo(bList.err)}`;
  report("K1", !bGet.ok && bGet.err?.code === 404 && bList.ok && bList.value.rows.length === 0 && aGet.ok && aGet.value.v === "seer",
    `B getRow → ${bGetCode} · B listRows → ${bListN} rows · A getRow → ${aGet.ok ? "200 v=" + aGet.value.v : errInfo(aGet.err)} · JWT: ${jb.via}`);

  // ---- K2: two Functions on Free + scoped keys enforced ----
  const f1 = await tryCall(() => fns.create({ functionId: "probe-fn-1", name: "probe-fn-1", runtime: Runtime.Node22 }));
  if (f1.ok) created.fns.push("probe-fn-1");
  const f2 = await tryCall(() => fns.create({ functionId: "probe-fn-2", name: "probe-fn-2", runtime: Runtime.Node22 }));
  if (f2.ok) created.fns.push("probe-fn-2");
  const f3 = await tryCall(() => fns.create({ functionId: "probe-fn-3", name: "probe-fn-3", runtime: Runtime.Node22 }));
  if (f3.ok) created.fns.push("probe-fn-3");
  // A second key with read-only row scope must be refused a row write.
  const narrow = JSON.parse(execFileSync("appwrite", ["organization", "create-ephemeral-project-key", "--organization-id", process.env.APPWRITE_ORG_ID,
    "--project-id", project, "--duration", "600", "--scopes", "rows.read", "-j", "--show-secrets"], { encoding: "utf8" })).secret;
  const narrowDb = new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(narrow));
  const narrowRead = await tryCall(() => narrowDb.getRow({ databaseId: DB, tableId: T, rowId }));
  const narrowWrite = await tryCall(() => narrowDb.updateRow({ databaseId: DB, tableId: T, rowId, data: { v: "x" } }));
  report("K2", f1.ok && f2.ok && narrowRead.ok && !narrowWrite.ok,
    `fn1 ${f1.ok ? "ok" : errInfo(f1.err)} · fn2 ${f2.ok ? "ok" : errInfo(f2.err)} · fn3 ${f3.ok ? "ok (cap > 2?)" : errInfo(f3.err)} · narrow key read ${narrowRead.ok ? "ok" : errInfo(narrowRead.err)} / write ${narrowWrite.ok ? "ALLOWED (scope not enforced)" : errInfo(narrowWrite.err)}`);

  // ---- K3: conflict on commit when the staged row changes outside the transaction ----
  const R = "seat-version";
  await db.createRow({ databaseId: DB, tableId: T, rowId: R, data: { v: "seat", n: 0 } });
  const tx = await db.createTransaction({ ttl: 300 });
  await db.updateRow({ databaseId: DB, tableId: T, rowId: R, data: { v: "plan-staged" }, transactionId: tx.$id });
  await db.incrementRowColumn({ databaseId: DB, tableId: T, rowId: R, column: "n", value: 1 }); // the "change my dates" edit
  const commit = await tryCall(() => db.updateTransaction({ transactionId: tx.$id, commit: true }));
  const after = await db.getRow({ databaseId: DB, tableId: T, rowId: R });
  report("K3", !commit.ok && after.v === "seat",
    `commit → ${commit.ok ? "SUCCEEDED (no conflict)" : errInfo(commit.err)} · row after: v=${after.v} n=${after.n}`);
} catch (e) {
  console.log(`PROBE ERROR ${errInfo(e)}`);
  process.exitCode = 1;
} finally {
  for (const id of created.fns) await tryCall(() => fns.delete({ functionId: id }));
  for (const id of created.users) await tryCall(() => users.delete({ userId: id }));
  await tryCall(() => db.delete({ databaseId: DB }));
  const failed = results.filter((r) => !r.pass).map((r) => r.id);
  console.log(results.length === 3 && failed.length === 0 ? "KILL CHECKS: ALL PASS" : `KILL CHECKS: ${failed.length ? "FAIL " + failed.join(",") : "INCOMPLETE"}`);
}
