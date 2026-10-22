// The whole TablesDB schema (M6: at most 14 tables). Every table uses row security with no table-level grants,
// so a client can read a row only if packages/core/perms.ts put its user on that row. Clients never write; the
// api/engine Functions write with scoped keys. options is the one public catalog table.
// Standalone (no imports) so scripts/schema.mjs can load it with Node's built-in type stripping.

type Col =
  | { key: string; type: "varchar"; size: number; required?: boolean; default?: string }
  | { key: string; type: "text" | "longtext" | "datetime" | "point"; required?: boolean }
  | { key: string; type: "integer"; required?: boolean; default?: number; min?: number; max?: number }
  | { key: string; type: "boolean"; required?: boolean; default?: boolean }
  | { key: string; type: "enum"; elements: string[]; required?: boolean; default?: string };
type Idx = { key: string; type: "key" | "unique" | "fulltext"; attributes: string[] };
export type TableDef = { id: string; columns: Col[]; indexes: Idx[]; publicRead?: boolean };

export const DATABASE_ID = "backroom";

const id = (key: string, required = true): Col => ({ key, type: "varchar", size: 36, required });
const circle = id("circleId");
const phase: Col = { key: "phase", type: "integer", required: true, min: 0, max: 99 };
const seat: Col = { key: "seat", type: "integer", required: true, min: 1, max: 6 };
const byCircle: Idx = { key: "by_circle", type: "key", attributes: ["circleId"] };
const byPhase: Idx = { key: "by_circle_phase", type: "key", attributes: ["circleId", "phase"] };

export const TABLES: TableDef[] = [
  {
    id: "circles",
    columns: [
      { key: "kind", type: "enum", elements: ["werewolf", "plan"], required: true },
      { key: "status", type: "enum", elements: ["active", "ended", "revealed"], required: true },
      { key: "phase", type: "integer", default: 0, min: 0, max: 99 },
      { key: "winner", type: "enum", elements: ["wolves", "village", "dawn", "planned", "stalled"] },
      id("visitor"),
      { key: "lang", type: "enum", elements: ["en", "ar"], default: "en" },
      { key: "visitorSeat", type: "integer", min: 1, max: 6 }, // the wolf seat the visitor's prompt drives
      { key: "expiresAt", type: "datetime", required: true },
      { key: "executions", type: "integer", default: 0, min: 0, max: 60 }, // V3: Operator.increment(1, 60)
      { key: "deployId", type: "varchar", size: 40 },
      { key: "receiptId", type: "varchar", size: 36 }, // the one shared receipt for this circle (X3), additive after the freeze
    ],
    indexes: [{ key: "by_expiry", type: "key", attributes: ["expiresAt"] }, { key: "by_visitor", type: "key", attributes: ["visitor"] }],
  },
  {
    id: "seats", // public seat facts only: never a role or a limit
    columns: [circle, seat, { key: "name", type: "varchar", size: 32, required: true }, id("agentUserId"),
      { key: "controller", type: "enum", elements: ["ai", "visitor", "external"], required: true },
      { key: "alive", type: "boolean", default: true }, { key: "seatVersion", type: "integer", default: 0, min: 0 }],
    indexes: [{ key: "by_circle_seat", type: "unique", attributes: ["circleId", "seat"] }],
  },
  {
    id: "secrets", // Werewolf role, or Plan limits; readable by the seat's agent (and the visitor for their own seat)
    columns: [circle, seat, { key: "role", type: "enum", elements: ["wolf", "seer", "villager", "member"], required: true },
      { key: "limits", type: "text" }, { key: "prefs", type: "varchar", size: 500 }],
    indexes: [byCircle],
  },
  {
    id: "phases", // open → claimed → done (O3); the close row carries the public elimination reveal
    columns: [circle, phase, { key: "kind", type: "enum", elements: ["night", "day", "vote", "round"], required: true },
      { key: "status", type: "enum", elements: ["open", "claimed", "done"], required: true },
      { key: "claimedAt", type: "datetime" }, { key: "eliminated", type: "integer", min: 1, max: 6 },
      { key: "eliminatedRole", type: "enum", elements: ["wolf", "seer", "villager"] }],
    indexes: [byPhase],
  },
  {
    id: "turns",
    columns: [circle, phase, seat, { key: "kind", type: "enum", elements: ["night", "day", "vote", "plan"], required: true },
      { key: "status", type: "enum", elements: ["pending", "done", "abstained"], required: true },
      // Read grants for the result row and its turn_logs, precomputed by the resolver (which may read roles), so the
      // agent path never needs a key read: JSON {"result": string[], "log": string[]}.
      { key: "perms", type: "text", required: true }],
    indexes: [{ key: "by_circle_phase_status", type: "key", attributes: ["circleId", "phase", "status"] }],
  },
  {
    id: "moves", // public day speech, votes and structured Plan votes (P4: enums make free-text disclosure unwritable)
    columns: [circle, phase, seat, { key: "kind", type: "enum", elements: ["speech", "vote", "plan-vote", "abstain"], required: true },
      { key: "text", type: "varchar", size: 500 }, { key: "target", type: "integer", min: 1, max: 6 }, id("proposalId", false),
      { key: "vote", type: "enum", elements: ["accept", "reject", "counter"] },
      { key: "reason", type: "enum", elements: ["over_budget", "dates", "dealbreaker", "preference"] },
      { key: "limitsVersion", type: "integer", min: 0 }],
    indexes: [byPhase],
  },
  {
    id: "night_actions", // wolves' den talk + kill pick (wolves-only), the Seer's check and its result (Seer-only)
    columns: [circle, phase, seat, { key: "target", type: "integer", min: 1, max: 6 }, { key: "text", type: "varchar", size: 500 },
      { key: "visionIsWolf", type: "boolean" }],
    indexes: [byPhase],
  },
  {
    id: "turn_logs", // every agent tool call, classified (V6); the visitor reads their wolf's rows (X1)
    columns: [circle, phase, seat, { key: "table", type: "varchar", size: 32, required: true }, id("rowId", false),
      { key: "classified", type: "enum", elements: ["attempt", "allowed"], required: true },
      { key: "status", type: "integer", required: true, min: 100, max: 599 }, { key: "foreign", type: "integer", default: 0, min: 0 },
      { key: "promptVersion", type: "varchar", size: 16 }, { key: "source", type: "enum", elements: ["agent", "visitor"], default: "agent" }],
    indexes: [byPhase],
  },
  {
    id: "dispatches", // outbox (V1): written in the same transaction as the result, re-sent if still pending after 30 s
    columns: [circle, { key: "op", type: "enum", elements: ["turn", "resolve"], required: true },
      { key: "payload", type: "varchar", size: 512, required: true },
      { key: "status", type: "enum", elements: ["pending", "sent"], required: true }],
    indexes: [{ key: "by_status", type: "key", attributes: ["status"] }, byCircle],
  },
  {
    id: "meta", // counters and config flags (M6 merge): row id is the key, e.g. cap-ip-<hash>-<hour>, config
    columns: [{ key: "n", type: "integer", default: 0, min: 0 }, { key: "flag", type: "boolean" }, { key: "text", type: "varchar", size: 256 }],
    indexes: [],
  },
  {
    id: "options", // Plan catalog, public; a spatial point per option so "near the Blue Hole" is a real geo query
    publicRead: true,
    columns: [{ key: "title", type: "varchar", size: 80, required: true }, { key: "titleAr", type: "varchar", size: 80 },
      { key: "dates", type: "varchar", size: 64, required: true }, { key: "pricePerPerson", type: "integer", required: true, min: 0 },
      { key: "location", type: "point" }, { key: "tags", type: "varchar", size: 128 }],
    indexes: [{ key: "by_price", type: "key", attributes: ["pricePerPerson"] }],
  },
  {
    id: "plan_candidates", // immutable per generation (V4); committed=true is staged inside the commit transaction
    columns: [circle, { key: "generation", type: "integer", required: true, min: 0 }, id("optionId"),
      { key: "shares", type: "text", required: true }, { key: "committed", type: "boolean", default: false }],
    indexes: [{ key: "by_circle_gen", type: "unique", attributes: ["circleId", "generation"] }],
  },
  {
    id: "approvals", // id {circle}-g{generation}-s{seat}, written by api.approve after an identity check (O5)
    columns: [circle, { key: "generation", type: "integer", required: true, min: 0 }, seat],
    indexes: [{ key: "by_circle_gen", type: "key", attributes: ["circleId", "generation"] }],
  },
  {
    id: "receipts", // shareable snapshot (X3/M11): seat labels only, read("any"), survives circle reset
    columns: [{ key: "snapshot", type: "longtext", required: true }, { key: "deployId", type: "varchar", size: 40 },
      { key: "commit", type: "varchar", size: 40 }],
    indexes: [],
  },
];
