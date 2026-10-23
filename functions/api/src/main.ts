// api Function (sync, execute: users). Signed-in visitors (anonymous sessions) call actions; the hourly schedule runs sweep.
import { Client, Functions } from "node-appwrite";
import { api, ApiError } from "./actions.js";
import type { Job } from "../../engine/src/resolver.js";

type Ctx = { req: { bodyJson?: Record<string, unknown>; headers: Record<string, string> }; res: { json: (b: unknown, status?: number) => unknown }; log: (m: string) => void; error: (m: string) => void };

export default async ({ req, res, log, error }: Ctx) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT!, project = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
  const key = req.headers["x-appwrite-key"]!;
  const fns = new Functions(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  const a = api({ endpoint, project, key, ipSalt: process.env.IP_SALT!, judgeCode: process.env.JUDGE_CODE, operatorCode: process.env.OPERATOR_CODE, demoCircleId: process.env.DEMO_CIRCLE_ID,
    deploy: { deployId: process.env.APPWRITE_FUNCTION_DEPLOYMENT ?? null, commit: process.env.GIT_COMMIT ?? null },
    fire: async (job: Job) => { await fns.createExecution({ functionId: process.env.ENGINE_FUNCTION_ID!, body: JSON.stringify(job), async: true }); } });
  const caller = req.headers["x-appwrite-user-id"] || undefined;
  const ip = req.headers["x-appwrite-client-ip"];
  try {
    // The hourly schedule sends no body, and req.bodyJson throws on an empty one: route the sweep before reading it.
    if (req.headers["x-appwrite-trigger"] === "schedule") return res.json(await a.sweep());
    let body: Record<string, unknown> = {};
    try { body = req.bodyJson ?? {}; } catch { return res.json({ error: "body must be JSON" }, 400); }
    switch (body.action) {
      case "setup": return res.json(await a.setup({ caller, ip, judgeCode: body.judgeCode as string, lang: body.lang === "ar" ? "ar" : "en", prompt: typeof body.prompt === "string" ? body.prompt : undefined }));
      case "inject": return res.json(await a.inject({ caller, circleId: String(body.circleId), prompt: String(body.prompt ?? "") }));
      case "token": return res.json(await a.token({ caller, circleId: String(body.circleId) }));
      case "continue": return res.json(await a.continue({ caller, circleId: String(body.circleId) }));
      case "share": return res.json(await a.share({ caller, circleId: String(body.circleId) }));
      case "op": return res.json(await a.op({ ip, code: String(body.code ?? ""), action: body.op === "open" || body.op === "close" ? body.op : "status" }));
      default: return res.json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof ApiError) return res.json({ error: e.reason, code: e.code }, e.status);
    error(JSON.stringify({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
    return res.json({ error: "internal error" }, 500);
  }
};
