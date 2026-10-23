// engine Function (async, invoked only by api and by itself through createExecution). Routes op=turn and op=resolve.
// The per-execution key arrives in x-appwrite-key with this Function's configured scopes (decision B1).
import Anthropic from "@anthropic-ai/sdk";
import { AppwriteException, Client, Functions, TablesDB } from "node-appwrite";
import { parseTurnId, DATABASE_ID } from "@backroom/core";
import { agentTurn } from "./agentTurn.js";
import { resolver, type Job } from "./resolver.js";
import { planResolver } from "./planResolver.js";

type Ctx = { req: { bodyJson?: unknown; headers: Record<string, string> }; res: { json: (b: unknown, status?: number) => unknown }; log: (m: string) => void; error: (m: string) => void };

export default async ({ req, res, log, error }: Ctx) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT!, project = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
  const key = req.headers["x-appwrite-key"]!;
  const self = process.env.APPWRITE_FUNCTION_ID!;
  const fns = new Functions(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  const fire = async (job: Job) => { await fns.createExecution({ functionId: self, body: JSON.stringify(job), async: true }); };
  // Plan circles have their own resolver; Werewolf's stays exactly as proven.
  const kindOf = (circleId: string) => new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key)).getRow({ databaseId: DATABASE_ID, tableId: "circles", rowId: circleId }).then((c) => c.kind as string);
  const engineFor = async (circleId: string) => ((await kindOf(circleId)) === "plan"
    ? planResolver({ endpoint, project, key, fire }) : resolver({ endpoint, project, resolverKey: key, fire }));
  let job: Job | undefined;
  try { job = req.bodyJson as Job; } catch { return res.json({ ok: false, error: "body must be JSON" }, 400); }
  try {
    if (job?.op === "turn") {
      const anthropic = new Anthropic({ maxRetries: 1, timeout: 20_000 });
      // Resolve inline in this same execution: one cold start per turn instead of two (latency, and half the
      // executions against the 60-per-circle budget). The outbox row written with the move still covers a crash here.
      const out = await agentTurn({ endpoint, project, agentKey: key, model: process.env.AGENT_MODEL ?? "claude-haiku-5-5", log,
        llm: (p) => anthropic.beta.messages.create(p), dispatchResolve: async (circleId, phase) => { await (await engineFor(circleId)).resolve(circleId, phase); } }, job.turnId);
      log(JSON.stringify({ op: "turn", turnId: job.turnId, out }));
      return res.json({ ok: true, out });
    }
    if (job?.op === "start") {
      await (await engineFor(job.circleId)).start(job.circleId);
      log(JSON.stringify({ op: "start", circleId: job.circleId }));
      return res.json({ ok: true });
    }
    if (job?.op === "resolve") {
      const out = await (await engineFor(job.circleId)).resolve(job.circleId, job.phase);
      log(JSON.stringify({ op: "resolve", circleId: job.circleId, phase: job.phase, out }));
      return res.json({ ok: true, out });
    }
    return res.json({ ok: false, error: "unknown op" }, 400);
  } catch (e) {
    // A circle swept (or a smoke test cleaned up) while its turns were still queued: nothing to do, not an error.
    const circleId = job?.op === "turn" ? (() => { try { return parseTurnId(job.turnId).circle; } catch { return undefined; } })() : job?.circleId;
    if (e instanceof AppwriteException && e.code === 404 && circleId &&
      await new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key)).getRow({ databaseId: DATABASE_ID, tableId: "circles", rowId: circleId }).then(() => false, () => true)) {
      log(JSON.stringify({ op: job?.op, circleId, out: "circle gone, skipped" }));
      return res.json({ ok: true, out: "gone" });
    }
    error(JSON.stringify({ op: job?.op, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
    return res.json({ ok: false }, 500);
  }
};
