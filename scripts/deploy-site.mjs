// Builds the web app against the env file's project and deploys it as a static Appwrite Site (prebuilt dist, no build
// step on Appwrite), then prints the site's URL. Usage: node scripts/deploy-site.mjs --env .env.test
import { Client, Sites, Proxy, Query, Framework, BuildRuntime, Adapter } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT_ID: project, APPWRITE_API_KEY: key } = process.env;
const client = new Client().setEndpoint(endpoint).setProject(project).setKey(key);
const sites = new Sites(client), proxy = new Proxy(client);
const SITE = "web";

// Vite gives already-set env vars priority over web/.env.local, so the bundle always targets this env file's project.
execFileSync("npx", ["vite", "build"], { cwd: "web", stdio: "inherit", env: { ...process.env, VITE_APPWRITE_ENDPOINT: endpoint, VITE_APPWRITE_PROJECT_ID: project } });
const tgz = join(tmpdir(), `site-${Date.now()}.tar.gz`);
execFileSync("tar", ["-czf", tgz, "-C", "web/dist", "."]);

const params = { siteId: SITE, name: "Backroom", framework: Framework.Other, buildRuntime: BuildRuntime.Node22, adapter: Adapter.Static, outputDirectory: "./", fallbackFile: "index.html" };
const exists = await sites.get({ siteId: SITE }).then(() => true).catch(() => false);
if (exists) await sites.update(params); else await sites.create(params);
const dep = await sites.createDeployment({ siteId: SITE, code: InputFile.fromPath(tgz, "site.tar.gz"), activate: true, outputDirectory: "./" });
let status = dep.status;
for (let i = 0; i < 90 && !["ready", "failed"].includes(status); i++) { await new Promise((r) => setTimeout(r, 2000)); status = (await sites.getDeployment({ siteId: SITE, deploymentId: dep.$id })).status; }
// An API-created site only gets an auth-protected preview domain; the public one is a site rule (SITE_DOMAIN).
const domain = process.env.SITE_DOMAIN ?? `${project}.appwrite.network`;
const { rules } = await proxy.listRules({ queries: [Query.equal("domain", domain)] });
if (!rules.length) await proxy.createSiteRule({ domain, siteId: SITE });
console.log(`site ${SITE}: ${status} (${dep.$id}) https://${domain}`);
if (status !== "ready") process.exitCode = 1;
