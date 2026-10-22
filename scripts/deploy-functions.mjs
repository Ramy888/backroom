// Creates or updates the two Functions (the Free cap) and deploys the bundles. Secrets are copied from the env file
// into secret Function variables without being printed. Usage: node scripts/deploy-functions.mjs --env .env.test
import { Client, Functions, Runtime } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const fns = new Functions(new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));
const SCOPES = ["users.read", "users.write", "rows.read", "rows.write", "execution.write"];

const defs = [
  { id: "engine", execute: [], timeout: 120, interval: 0 },
  { id: "api", execute: ["users"], timeout: 60, interval: 60 }, // hourly sweep: Free rejects cron, allows interval ≥ 60 min
];
for (const d of defs) {
  const params = { functionId: d.id, name: d.id, runtime: Runtime.Node22, execute: d.execute, timeout: d.timeout, entrypoint: "main.mjs", scopes: SCOPES, logging: true, interval: d.interval };
  const exists = await fns.get({ functionId: d.id }).then(() => true).catch(() => false);
  if (exists) await fns.update(params); else await fns.create(params);
  console.log(`${exists ? "updated" : "created"} function ${d.id}`);
}

async function setVar(functionId, key, value, secret = true) {
  const { variables } = await fns.listVariables({ functionId });
  const v = variables.find((x) => x.key === key);
  if (v) await fns.updateVariable({ functionId, variableId: v.$id, key, value, secret });
  else await fns.createVariable({ functionId, variableId: key.toLowerCase().replace(/_/g, "-"), key, value, secret });
}
await setVar("engine", "ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
await setVar("engine", "AGENT_MODEL", process.env.AGENT_MODEL ?? "claude-haiku-5-5", false);
await setVar("api", "ENGINE_FUNCTION_ID", "engine", false);
// M5: receipts name the commit the deployed code was built from ("-dirty" when the tree had uncommitted changes).
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() + (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() ? "-dirty" : "");
await setVar("api", "GIT_COMMIT", commit, false);
const { variables } = await fns.listVariables({ functionId: "api" });
if (!variables.some((v) => v.key === "IP_SALT")) await setVar("api", "IP_SALT", randomBytes(16).toString("hex"));
if (process.env.JUDGE_CODE) await setVar("api", "JUDGE_CODE", process.env.JUDGE_CODE);
console.log("variables set (values not shown)");

for (const d of defs) {
  const dir = mkdtempSync(join(tmpdir(), `fn-${d.id}-`));
  copyFileSync(`functions/${d.id}/dist/main.mjs`, join(dir, "main.mjs"));
  const tgz = join(tmpdir(), `${d.id}-${Date.now()}.tar.gz`);
  execFileSync("tar", ["-czf", tgz, "-C", dir, "."]);
  const dep = await fns.createDeployment({ functionId: d.id, code: InputFile.fromPath(tgz, "code.tar.gz"), activate: true, entrypoint: "main.mjs" });
  let status = dep.status;
  for (let i = 0; i < 90 && !["ready", "failed"].includes(status); i++) { await new Promise((r) => setTimeout(r, 2000)); status = (await fns.getDeployment({ functionId: d.id, deploymentId: dep.$id })).status; }
  console.log(`deployed ${d.id}: ${status} (${dep.$id})`);
  if (status !== "ready") process.exitCode = 1;
}
