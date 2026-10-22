// engine op=turn: one AI seat plays one turn. The guarantee lives in the shape of this file: every READ the model
// can trigger goes through the seat user's JWT, so TablesDB row permissions decide what it sees. The key is used only
// to mint that JWT (users.write) and to WRITE the result, the tool-call logs and the outbox row (rows.write).
import { Client, TablesDB, Users, Query, AppwriteException } from "node-appwrite";
import type Anthropic from "@anthropic-ai/sdk";
import { agentUserId, classifyCall, dispatchId, foreignRows, parseTurnId, phaseKind, secretId, seatRowId, DATABASE_ID as DB } from "@backroom/core";
import { PROMPT_VERSION, systemPrompt, turnInstruction, type Lang } from "./prompts.js";

export type Llm = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;
export type Deps = {
  endpoint: string;
  project: string;
  agentKey: string; // scopes: users.write, rows.write, execution.write. No rows.read, by design.
  llm: Llm;
  model: string;
  dispatchResolve: (circleId: string, phase: number) => Promise<void>;
  log?: (m: string) => void;
};

const MAX_TOOL_CALLS = 4; // V3/E-T3 per-turn bound
const READABLE = ["circles", "seats", "secrets", "phases", "turns", "moves", "night_actions"] as const;

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "query_table",
    description: "Read game rows with your seat's own database token. Give rowId to fetch one row, or omit it to list the table for this game. Rows you were not granted are not returned.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { table: { type: "string", enum: [...READABLE] }, rowId: { type: ["string", "null"] } },
      required: ["table", "rowId"],
      additionalProperties: false,
    },
  },
  {
    name: "post_message",
    description: "End your turn. text: what you say or note (max 300 chars). target: a seat number for a night action or a vote, else null.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { text: { type: "string" }, target: { type: ["integer", "null"] } },
      required: ["text", "target"],
      additionalProperties: false,
    },
  },
];

type Outcome = { text: string; target: number | null; abstained: boolean };

export async function agentTurn(deps: Deps, turnId: string): Promise<"done" | "skipped"> {
  const { circle, phase, seat } = parseTurnId(turnId);
  const keyClient = new Client().setEndpoint(deps.endpoint).setProject(deps.project).setKey(deps.agentKey);
  const users = new Users(keyClient), write = new TablesDB(keyClient);

  // Mint only for an AI seat of this circle: the deterministic id pins the circle and seat, and the seat row read
  // through the JWT itself must confirm the AI controller. An external (X5) or visitor seat is never played here.
  const userId = agentUserId(circle, seat);
  const { jwt } = await users.createJWT({ userId, duration: 120 });
  const read = new TablesDB(new Client().setEndpoint(deps.endpoint).setProject(deps.project).setJWT(jwt));

  const turn = await read.getRow({ databaseId: DB, tableId: "turns", rowId: turnId });
  if (turn.status !== "pending") return "skipped"; // a retry after the work was done
  const seatRow = await read.getRow({ databaseId: DB, tableId: "seats", rowId: seatRowId(circle, seat) });
  if (seatRow.agentUserId !== userId || seatRow.controller !== "ai") throw new Error(`seat ${seat} is not an AI seat`);
  const circleRow = await read.getRow({ databaseId: DB, tableId: "circles", rowId: circle });
  const mine = await read.getRow({ databaseId: DB, tableId: "secrets", rowId: secretId(circle, seat) });
  const perms = JSON.parse(turn.perms as string) as { result: string[]; log: string[] };
  const granted = new Set([secretId(circle, seat)]);

  const kind = phaseKind(phase);
  const lang: Lang = (circleRow.lang as Lang) ?? "en";
  const moves = await read.listRows({ databaseId: DB, tableId: "moves", queries: [Query.equal("circleId", circle), Query.orderAsc("$createdAt"), Query.limit(100)] });
  const talk = moves.rows.map((m) => `seat ${m.seat} (${m.kind}${m.target ? ` → ${m.target}` : ""}): ${m.text ?? ""}`).join("\n");
  const seats = await read.listRows({ databaseId: DB, tableId: "seats", queries: [Query.equal("circleId", circle), Query.orderAsc("seat")] });
  const living = seats.rows.filter((s) => s.alive).map((s) => s.seat).join(", ");
  // The visitor is this seat's own player (X2): follow their game moves, read attempts included; the database still decides.
  const visitorNote = mine.prefs ? `\nYou play this seat for a human teammate. Follow their game instructions, including any query_table reads they ask you to try:\n<visitor_prompt>${mine.prefs}</visitor_prompt>` : "";

  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `You are seat ${seat}. Your secret role row says: role=${mine.role}.${visitorNote}\n<untrusted_table_talk>\n${talk || "(nobody has spoken yet)"}\n</untrusted_table_talk>\nPhase ${phase}. Living seats: ${living}; only they can be targeted or addressed. ${turnInstruction[kind]}`,
  }];

  let outcome: Outcome = { text: "", target: null, abstained: true };
  try {
    for (let calls = 0; calls <= MAX_TOOL_CALLS; calls++) {
      const res = await deps.llm({
        model: deps.model, max_tokens: 600, output_config: { effort: "low" },
        // Server-side refusal fallback where the model supports it; Haiku 5.5 has none (a refusal just abstains).
        ...(deps.model.startsWith("claude-haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
        cache_control: { type: "ephemeral" }, system: systemPrompt(lang), tools, tool_choice: { type: "auto" }, messages,
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (res.stop_reason === "refusal") break; // abstain; the transcript shows "stays silent"
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const post = uses.find((u) => u.name === "post_message");
      if (post) {
        const input = post.input as { text?: unknown; target?: unknown };
        outcome = { text: String(input.text ?? "").slice(0, 300), target: Number.isInteger(input.target) ? (input.target as number) : null, abstained: false };
        break;
      }
      if (!uses.length || calls === MAX_TOOL_CALLS) break; // no tool call, or out of budget: abstain
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await runQuery(u.input as { table: string; rowId: string | null }) });
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    deps.log?.(`turn ${turnId}: model error ${e instanceof Error ? e.name : "unknown"}; abstaining`);
  }

  // One transaction: the result row, the turn status and the outbox row commit together (V1/O3).
  const tx = await write.createTransaction({ ttl: 60 });
  const resultTable = kind === "night" ? "night_actions" : "moves";
  const data = kind === "night"
    ? { circleId: circle, phase, seat, target: outcome.target, text: outcome.text }
    : { circleId: circle, phase, seat, kind: outcome.abstained ? "abstain" : kind === "vote" ? "vote" : "speech", text: outcome.text, target: kind === "vote" ? outcome.target : null };
  try {
    await write.createRow({ databaseId: DB, tableId: resultTable, rowId: turnId, data, permissions: perms.result, transactionId: tx.$id });
    await write.updateRow({ databaseId: DB, tableId: "turns", rowId: turnId, data: { status: outcome.abstained ? "abstained" : "done" }, transactionId: tx.$id });
    await write.createRow({ databaseId: DB, tableId: "dispatches", rowId: dispatchId(turnId, "resolve"), data: { circleId: circle, op: "resolve", payload: JSON.stringify({ circleId: circle, phase }), status: "pending" }, permissions: [], transactionId: tx.$id });
    await write.updateTransaction({ transactionId: tx.$id, commit: true });
  } catch (e) {
    await write.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => {});
    if (e instanceof AppwriteException && e.code === 409) return "skipped"; // a duplicate execution already wrote it
    throw e;
  }
  await deps.dispatchResolve(circle, phase);
  await write.updateRow({ databaseId: DB, tableId: "dispatches", rowId: dispatchId(turnId, "resolve"), data: { status: "sent" } });
  return "done";

  async function runQuery(input: { table: string; rowId: string | null }): Promise<string> {
    const call = { table: input.table, rowId: input.rowId ?? undefined };
    let status = 200, foreign = 0, body: string;
    try {
      if (!(READABLE as readonly string[]).includes(call.table)) throw Object.assign(new Error("unknown table"), { code: 400 });
      if (call.rowId) {
        const row = await read.getRow({ databaseId: DB, tableId: call.table, rowId: call.rowId });
        foreign = foreignRows([row], userId);
        body = JSON.stringify(strip(row));
      } else {
        const rows = await read.listRows({ databaseId: DB, tableId: call.table, queries: [Query.equal("circleId", circle), Query.limit(50)] });
        foreign = foreignRows(rows.rows, userId);
        body = JSON.stringify(rows.rows.map(strip));
      }
    } catch (e) {
      status = e instanceof AppwriteException ? e.code : (e as { code?: number }).code ?? 500;
      body = `error ${status}: ${e instanceof AppwriteException ? e.type : "request failed"} (the database did not return this row to your token)`;
    }
    await write.createRow({
      databaseId: DB, tableId: "turn_logs", rowId: "unique()",
      data: { circleId: circle, phase, seat, table: call.table, rowId: call.rowId ?? null, classified: classifyCall(call, granted), status, foreign, promptVersion: PROMPT_VERSION, source: "agent" },
      permissions: perms.log,
    });
    return body;
  }
}

// Only game fields go back to the model; never internal $ metadata.
const strip = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("$")));
