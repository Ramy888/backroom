// Mints a short-lived, scoped project API key via the signed-in Appwrite CLI and writes it into a gitignored
// env file. The key is never printed: Day-0 probes and tests need keys, chat logs must not see them.
// Usage: node scripts/mint-key.mjs --env .env.test --project backroom-test [--duration 3600]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const SCOPES = ["users.read", "users.write", "sessions.write", "databases.read", "databases.write",
  "tables.read", "tables.write", "columns.read", "columns.write", "indexes.read", "indexes.write",
  "rows.read", "rows.write", "functions.read", "functions.write", "execution.read", "execution.write",
  "sites.read", "sites.write", "rules.read", "rules.write"];

if (existsSync(process.argv[process.argv.indexOf("--env") + 1] ?? "")) process.loadEnvFile(process.argv[process.argv.indexOf("--env") + 1]);
const { values } = parseArgs({ options: { env: { type: "string" }, project: { type: "string" }, duration: { type: "string", default: "3600" },
  scopes: { type: "string" }, var: { type: "string", default: "APPWRITE_API_KEY" } } });
const scopes = values.scopes ? values.scopes.split(",") : SCOPES;
const ORG = process.env.APPWRITE_ORG_ID ?? (() => { throw new Error("set APPWRITE_ORG_ID in the env file"); })();
if (!values.env || !values.project) throw new Error("usage: --env <file> --project <id>");

const out = execFileSync("appwrite", ["organization", "create-ephemeral-project-key", "--organization-id", ORG,
  "--project-id", values.project, "--duration", values.duration, ...scopes.flatMap((s) => ["--scopes", s]),
  "-j", "--show-secrets"], { encoding: "utf8" });
const secret = JSON.parse(out).secret;
if (!secret) throw new Error("CLI returned no key secret");

const keep = new RegExp(`^(${values.var}|APPWRITE_PROJECT_ID|APPWRITE_ENDPOINT)=`);
const lines = existsSync(values.env) ? readFileSync(values.env, "utf8").split("\n").filter((l) => !keep.test(l)) : [];
lines.unshift(`APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1`, `APPWRITE_PROJECT_ID=${values.project}`, `${values.var}=${secret}`);
writeFileSync(values.env, lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n", { mode: 0o600 });
console.log(`wrote ${values.var} to ${values.env}: project ${values.project}, ${scopes.length} scopes, valid ${values.duration}s (value not shown)`);
