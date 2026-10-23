// Adds a JUDGE_CODE and an OPERATOR_CODE to an env file if it has none (gitignored; values are never printed).
// Usage: node scripts/gen-codes.mjs --env .env
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
const text = readFileSync(values.env, "utf8");
const code = (prefix) => `${prefix}-${randomBytes(9).toString("base64url")}`;
for (const [key, prefix] of [["JUDGE_CODE", "judge"], ["OPERATOR_CODE", "op"]]) {
  if (new RegExp(`^${key}=.+`, "m").test(text)) { console.log(`${key} already set in ${values.env}`); continue; }
  appendFileSync(values.env, `${text.endsWith("\n") ? "" : "\n"}${key}=${code(prefix)}\n`);
  console.log(`wrote ${key} to ${values.env} (value not shown)`);
}
