// Sanity check that an env file's project key works. Prints counts only, never secrets.
import { Client, Users, TablesDB } from "node-appwrite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { env: { type: "string", default: ".env.test" } } });
process.loadEnvFile(values.env);
const c = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const users = await new Users(c).list({ total: true });
const dbs = await new TablesDB(c).list({});
console.log(`project ${process.env.APPWRITE_PROJECT_ID}: key OK · users ${users.total} · databases ${dbs.total}`);
