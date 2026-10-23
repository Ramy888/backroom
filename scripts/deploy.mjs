// One-command deploy of everything to the env file's project: tables, both Functions, the Site, then the smoke test.
// Usage: node scripts/deploy.mjs --env .env.test   (production: --env .env, only on the builder's word)
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
run("node", ["scripts/schema.mjs", "--env", values.env]);
run("node", ["scripts/seed-options.mjs", "--env", values.env]); // the public Plan catalog
run("npm", ["run", "build"]);
run("node", ["scripts/deploy-functions.mjs", "--env", values.env]);
run("node", ["scripts/deploy-site.mjs", "--env", values.env]);
run("node", ["scripts/smoke.mjs", "--env", values.env]);
