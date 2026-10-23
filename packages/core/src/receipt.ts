// The shareable receipt (X3/M11): a public snapshot of one finished circle that names seats, never users.
// Permission strings are relabelled ("seat 3", "visitor"), row IDs lose the circle ID, and the grant the reveal
// added at game end is dropped, so each row shows who could read it during play.
import { agentUserId } from "./ids.js";

// What the Functions' per-execution keys may do (scripts/deploy-functions.mjs); agents never hold a key at all.
export const FUNCTION_SCOPES = ["users.read", "users.write", "rows.read", "rows.write", "execution.read", "execution.write"] as const;

export type ReceiptInput = {
  circleId: string; visitor: string; visitorSeat: number; winner: string | null; phases: number; endedAt: string; lang: "en" | "ar";
  seats: { seat: number; name: string; alive: boolean }[];
  secrets: { $id: string; seat: number; role: string; $permissions: string[] }[];
  logs: { classified: string; foreign: number }[];
  deploy: { deployId: string | null; commit: string | null };
};

export function receiptSnapshot(i: ReceiptInput) {
  const label = (perm: string) => {
    const who = /^read\("(.+)"\)$/.exec(perm)?.[1];
    if (who === "any") return "anyone";
    if (who === `user:${i.visitor}`) return "visitor";
    for (let n = 1; n <= 6; n++) if (who === `user:${agentUserId(i.circleId, n)}`) return `seat ${n}`;
    return "another user";
  };
  const snap = {
    v: 1, lang: i.lang, winner: i.winner, phases: i.phases, endedAt: i.endedAt, visitorSeat: i.visitorSeat,
    seats: i.seats.map((s) => ({ seat: s.seat, name: s.name, alive: s.alive, role: i.secrets.find((r) => r.seat === s.seat)?.role ?? null })),
    rows: i.secrets.map((r) => ({
      row: r.$id.replace(i.circleId, "…"), seat: r.seat, role: r.role,
      readableBy: r.$permissions.filter((p) => p.startsWith("read(")).map(label).filter((l) => l !== "visitor" || r.seat === i.visitorSeat).sort(), // Appwrite keeps no order
    })),
    forbiddenReads: { attempted: i.logs.filter((l) => l.classified === "attempt").length, returned: i.logs.reduce((n, l) => n + (l.foreign ?? 0), 0) },
    deploy: { ...i.deploy, scopes: [...FUNCTION_SCOPES] },
  };
  // Belt and braces for M11: a receipt is public forever, so refuse to build one that names a user or the circle.
  const json = JSON.stringify(snap);
  if (json.includes(i.visitor) || json.includes(i.circleId) || json.includes("user:")) throw new Error("receipt would leak an id");
  return snap;
}
export type Receipt = ReturnType<typeof receiptSnapshot>;
