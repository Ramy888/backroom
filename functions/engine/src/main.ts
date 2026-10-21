// engine Function (async, invoked only by api and by itself through createExecution). Routes op=turn and op=resolve.
// The per-execution key arrives in x-appwrite-key with this Function's configured scopes (decision B1).
import Anthropic from "@anthropic-ai/sdk";
import { Client, Functions } from "node-appwrite";
import { agentTurn } from "./agentTurn.js";
import { resolver, type Job } from "./resolver.js";

type Ctx = { req: { bodyJson?: unknown; headers: Record<string, string> }; res: { json: (b: unknown, status?: number) => unknown }; log: (m: string) => void; error: (m: string) => void };

export default async ({ req, res, log, error }: Ctx) => {
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT!, project = process.env.APPWRITE_FUNCTION_PROJECT_ID!;
  const key = req.headers["x-appwrite-key"]!;
  const self = process.env.APPWRITE_FUNCTION_ID!;
  const fns = new Functions(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  const fire = async (job: Job) => { await fns.createExecution({ functionId: self, body: JSON.stringify(job), async: true }); };
  const job = req.bodyJson as Job;
  try {
    if (job?.op === "turn") {
      const anthropic = new Anthropic({ maxRetries: 1, timeout: 20_000 });
      // Resolve inline in this same execution: one cold start per turn instead of two (latency, and half the
      // executions against the 60-per-circle budget). The outbox row written with the move still covers a crash here.
      const r = resolver({ endpoint, project, resolverKey: key, fire });
      const out = await agentTurn({ endpoint, project, agentKey: key, model: process.env.AGENT_MODEL ?? "claude-haiku-5-5", log,
        llm: (p) => anthropic.beta.messages.create(p), dispatchResolve: async (circleId, phase) => { await r.resolve(circleId, phase); } }, job.turnId);
      log(JSON.stringify({ op: "turn", turnId: job.turnId, out }));
      return res.json({ ok: true, out });
    }
    if (job?.op === "start") {
      await resolver({ endpoint, project, resolverKey: key, fire }).start(job.circleId);
      log(JSON.stringify({ op: "start", circleId: job.circleId }));
      return res.json({ ok: true });
    }
    if (job?.op === "resolve") {
      const out = await resolver({ endpoint, project, resolverKey: key, fire }).resolve(job.circleId, job.phase);
      log(JSON.stringify({ op: "resolve", circleId: job.circleId, phase: job.phase, out }));
      return res.json({ ok: true, out });
    }
    return res.json({ ok: false, error: "unknown op" }, 400);
  } catch (e) {
    error(JSON.stringify({ op: job?.op, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }));
    return res.json({ ok: false }, 500);
  }
};
