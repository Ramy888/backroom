// Day-0 maim/cosmetic checks (Task 4): facts that reshape a subsystem but don't kill the idea.
// Usage: node scripts/day0-rest.mjs [--env .env.test]. Prints evidence only, never secrets; cleans up in finally.
import { Client, Users, TablesDB, Functions, Permission, Role, ID, Query, Runtime, AppwriteException } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
const admin = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const users = new Users(admin), db = new TablesDB(admin), fns = new Functions(admin);
const errInfo = (e) => (e instanceof AppwriteException ? `${e.code} ${e.type}` : String(e?.message ?? e).slice(0, 160));
const tryCall = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, err: e }; } };
const cli = (args) => { try { return { ok: true, out: execFileSync("appwrite", [...args, "-j"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { ok: false, out: String(e.stderr || e.message).split("\n").find((l) => l.includes("Error")) ?? "error" }; } };
const line = (id, status, evidence) => console.log(`${id.padEnd(4)} ${status.padEnd(7)} ${evidence}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

const cleanup = { users: [], fns: [], dbs: [] };
try {
  // R1 (O1): a JWT dies with its user, so deleting per-circle agent users revokes leftover tokens.
  {
    await db.create({ databaseId: "probe2", name: "probe2" }); cleanup.dbs.push("probe2");
    await db.createTable({ databaseId: "probe2", tableId: "t", name: "t", rowSecurity: true, permissions: [] });
    await db.createVarcharColumn({ databaseId: "probe2", tableId: "t", key: "v", size: 16, required: false });
    for (let i = 0; i < 30 && (await db.listColumns({ databaseId: "probe2", tableId: "t" })).columns.some((c) => c.status !== "available"); i++) await sleep(1000);
    const u = await users.create({ userId: ID.unique(), name: "probe-del" });
    await db.createRow({ databaseId: "probe2", tableId: "t", rowId: "r1", data: { v: "x" }, permissions: [Permission.read(Role.user(u.$id))] });
    const { jwt } = await users.createJWT({ userId: u.$id, duration: 300 });
    const jdb = new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt));
    const before = await tryCall(() => jdb.getRow({ databaseId: "probe2", tableId: "t", rowId: "r1" }));
    await users.delete({ userId: u.$id });
    const after = await tryCall(() => jdb.getRow({ databaseId: "probe2", tableId: "t", rowId: "r1" }));
    line("R1", before.ok && !after.ok ? "PASS" : "FAIL", `JWT read before user delete: ${before.ok ? "200" : errInfo(before.err)} · after delete: ${after.ok ? "200 (TOKEN STILL VALID)" : errInfo(after.err)}`);
  }

  // R2: transaction TTL bounds (the blog said 60 s to 1 h).
  {
    const probe = async (ttl) => { const r = await tryCall(() => db.createTransaction({ ttl })); if (r.ok) await tryCall(() => db.updateTransaction({ transactionId: r.value.$id, rollback: true })); return r.ok ? "ok" : errInfo(r.err); };
    const res = { 59: await probe(59), 60: await probe(60), 3600: await probe(3600), 3601: await probe(3601) };
    line("R2", res[60] === "ok" && res[3600] === "ok" ? "PASS" : "FAIL", `ttl 59 → ${res[59]} · 60 → ${res[60]} · 3600 → ${res[3600]} · 3601 → ${res[3601]}`);
  }

  // R3: Function timeout cap, cold start, client-IP header, 6-way concurrency.
  {
    const fid = "probe-echo";
    let timeout = null;
    for (const t of [900, 300, 60, 30, 15]) {
      const r = await tryCall(() => fns.create({ functionId: fid, name: fid, runtime: Runtime.Node22, execute: ["any"], timeout: t, entrypoint: "index.mjs" }));
      if (r.ok) { timeout = t; cleanup.fns.push(fid); break; }
    }
    if (timeout == null) throw new Error("could not create the probe function");
    const dir = mkdtempSync(join(tmpdir(), "probe-echo-"));
    writeFileSync(join(dir, "index.mjs"),
      "export default async ({ req, res }) => { const b = req.bodyJson ?? {}; const t0 = Date.now(); await new Promise((r) => setTimeout(r, Number(b.sleep ?? 0))); return res.json({ start: t0, end: Date.now(), headers: req.headers }); };\n");
    const tgz = join(dir, "..", `probe-echo-${Date.now()}.tar.gz`);
    execFileSync("tar", ["-czf", tgz, "-C", dir, "."]);
    const dep = await fns.createDeployment({ functionId: fid, code: InputFile.fromPath(tgz, "code.tar.gz"), activate: true, entrypoint: "index.mjs" });
    let status = dep.status;
    for (let i = 0; i < 120 && !["ready", "failed"].includes(status); i++) { await sleep(2000); status = (await fns.getDeployment({ functionId: fid, deploymentId: dep.$id })).status; }
    if (status !== "ready") throw new Error(`probe deployment ${status}`);
    await sleep(3000);
    const t0 = Date.now();
    const cold = await fns.createExecution({ functionId: fid, body: JSON.stringify({ sleep: 0 }), async: false });
    const coldMs = Date.now() - t0;
    const headers = JSON.parse(cold.responseBody || "{}").headers ?? {};
    const ipHeaders = Object.keys(headers).filter((h) => /ip|forwarded|real/i.test(h)).map((h) => `${h}=${/\d+\.\d+\.\d+\.\d+|:/.test(headers[h]) ? "<ip>" : headers[h]}`);
    const t1 = Date.now();
    const ex = await Promise.all(Array.from({ length: 6 }, () => fns.createExecution({ functionId: fid, body: JSON.stringify({ sleep: 2000 }), async: true })));
    const done = new Map();
    for (let i = 0; i < 90 && done.size < 6; i++) {
      await sleep(1000);
      for (const e of ex) if (!done.has(e.$id)) { const g = await fns.getExecution({ functionId: fid, executionId: e.$id }); if (["completed", "failed"].includes(g.status)) done.set(e.$id, { ms: Date.now() - t1, status: g.status }); }
    }
    const wall = Math.max(...[...done.values()].map((d) => d.ms));
    line("R3", "INFO", `timeout cap accepted: ${timeout}s · cold sync exec ${coldMs} ms · IP headers: ${ipHeaders.join(", ") || "none"} · 6×2 s async: ${done.size}/6 done, last at ${wall} ms (${wall < 7000 ? "concurrent" : "queued"})`);
  }

  // R4: Claude turn latency for an agent-sized call (one tool, short context).
  {
    const anthropic = new Anthropic();
    const tools = [{ name: "query_table", description: "Read one row from a game table with your seat's token. Returns the row or a not-found error.", strict: true,
      input_schema: { type: "object", properties: { table: { type: "string" }, rowId: { type: "string" } }, required: ["table", "rowId"], additionalProperties: false } }];
    const system = "You are seat 6, a wolf in a 6-seat Werewolf game. Speak in one short sentence. You may use query_table.";
    const run = async (model, effort) => {
      const ms = [];
      for (let i = 0; i < 3; i++) {
        const t = Date.now();
        const r = await anthropic.messages.create({ model, max_tokens: 600, output_config: { effort }, system, tools, tool_choice: { type: "auto" },
          messages: [{ role: "user", content: `Day ${i + 1}. Seat 3 says you are suspicious. Respond to the table.` }] });
        ms.push(Date.now() - t);
        if (i === 2) return { ms, stop: r.stop_reason, out: r.usage.output_tokens };
      }
    };
    for (const [model, effort] of [["claude-opus-5-5", "low"], ["claude-haiku-5-5", "low"]]) {
      const r = await tryCall(() => run(model, effort));
      line("R4", r.ok ? "INFO" : "FAIL", r.ok ? `${model} effort=${effort}: ${r.value.ms.join("/")} ms (p50 ${pct(r.value.ms, 50)}) · last stop=${r.value.stop} out=${r.value.out} tok` : `${model}: ${errInfo(r.err)}`);
    }
  }

  // R5: auth methods on Free (anonymous sessions are the default join; passkeys optional).
  {
    const anon = cli(["project", "update-auth-method", "--project-id", project, "--method-id", "anonymous", "--enabled"]);
    const pk = cli(["project", "update-auth-method", "--project-id", project, "--method-id", "passkey", "--enabled"]);
    line("R5", anon.ok ? "PASS" : "FAIL", `anonymous enable → ${anon.ok ? "ok" : anon.out} · passkey enable → ${pk.ok ? "ok" : pk.out}`);
  }

  // R6: Firewall (WAF) on Free: try to create and delete one rate-limit rule.
  {
    // WAF commands take the project from a config file, not a flag; the resource type is api|functions|sites.
    const cfgDir = mkdtempSync(join(tmpdir(), "probe-waf-")), cfg = join(cfgDir, "appwrite.config.json");
    writeFileSync(cfg, JSON.stringify({ projectId: project, endpoint }));
    const mk = cli(["waf", "create-rate-limit-rule", "--config-file", cfg, "--rule-id", "probe-rl", "--name", "probe", "--key", "ip", "--limit", "100", "--interval", "60", "--strategy", "fixedWindow", "--resource-type", "api"]);
    if (mk.ok) cli(["waf", "delete-rule", "--config-file", cfg, "--rule-id", "probe-rl", "-f"]);
    line("R6", mk.ok ? "PASS" : "INFO", `WAF rate-limit rule → ${mk.ok ? "created and deleted" : mk.out}`);
  }

  line("R7", "DEFER", "row events from transaction commits: not needed (E1 uses explicit createExecution hops); only X5 would rely on it");
  line("R8", "MANUAL", "MAU after create+delete: check Console → Usage → Users tomorrow (usage lags); visitors' anonymous sessions also count");
  line("R9", "MANUAL", "X5 MCP token reach: decide on Day 4 only if X5 is attempted");
} catch (e) {
  console.log(`PROBE ERROR ${errInfo(e)}`);
  process.exitCode = 1;
} finally {
  for (const id of cleanup.fns) await tryCall(() => fns.delete({ functionId: id }));
  for (const id of cleanup.users) await tryCall(() => users.delete({ userId: id }));
  for (const id of cleanup.dbs) await tryCall(() => db.delete({ databaseId: id }));
}
