// Deterministic row ids: a retried or duplicated execution re-creates the same id and gets a 409,
// which is how the engine stays idempotent without locks. Circle ids are Appwrite ID.unique() (20 chars),
// so every derived id stays under Appwrite's 36-char limit.
export const turnId = (circle: string, phase: number, seat: number) => `${circle}-p${phase}-s${seat}`;
export const closeId = (circle: string, phase: number) => `${circle}-p${phase}-close`;
export const seatRowId = (circle: string, seat: number) => `${circle}-seat${seat}`;
export const secretId = (circle: string, seat: number) => `${circle}-s${seat}-secret`;
// Agent users are deterministic so the engine can mint a JWT before it can read anything, then verify the seat via that JWT.
export const agentUserId = (circle: string, seat: number) => `${circle}-a${seat}`;
// Outbox ids encode the op so the resolver's "run this turn" and the agent's "resolve this phase" never collide.
export const dispatchId = (rowId: string, op: "turn" | "resolve") => `${rowId}-${op === "turn" ? "t" : "r"}`;
export const approvalId = (circle: string, generation: number, seat: number) => `${circle}-g${generation}-s${seat}`;
export const candidateId = (circle: string, generation: number) => `${circle}-g${generation}`;

const TURN = /^([a-zA-Z0-9]+)-p(\d+)-s(\d)$/;
export function parseTurnId(id: string) {
  const m = TURN.exec(id);
  if (!m) throw new Error(`not a turn id: ${id}`);
  return { circle: m[1]!, phase: Number(m[2]), seat: Number(m[3]) };
}
