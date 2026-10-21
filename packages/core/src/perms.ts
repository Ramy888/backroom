// The permission matrix: every row the engine writes gets its read grants from here, so "who can read what"
// is one reviewed table instead of scattered arrays. Clients never get write/update; keys do all writes.
import type { Role } from "./rules.js";

export type CircleView = { visitor: string; seats: { seat: number; user: string; role: Role; visitor?: boolean }[] };
export type TableKind = "public" | "secret" | "night" | "vision" | "den" | "turnlog" | "receipt";

const read = (user: string) => `read("user:${user}")`;
const uniq = (xs: string[]) => [...new Set(xs)].sort();

export function permsFor(kind: TableKind, circle: CircleView, seat?: number): string[] {
  const wolves = circle.seats.filter((s) => s.role === "wolf").map((s) => s.user);
  const seatOf = () => {
    const s = circle.seats.find((x) => x.seat === seat);
    if (!s) throw new Error(`permsFor(${kind}): unknown seat ${seat}`);
    return s;
  };
  // The visitor reads exactly what their own wolf reads.
  const withVisitor = (s: { visitor?: boolean }, users: string[]) => (s.visitor ? [...users, circle.visitor] : users);

  switch (kind) {
    case "public":
      return uniq([...circle.seats.map((s) => s.user), circle.visitor].map(read));
    case "secret": {
      const s = seatOf();
      return uniq(withVisitor(s, [s.user]).map(read));
    }
    case "night": {
      const s = seatOf();
      return uniq((s.role === "wolf" ? [...wolves, circle.visitor] : withVisitor(s, [s.user])).map(read));
    }
    case "vision": {
      const s = seatOf();
      if (s.role !== "seer") throw new Error("visions are seer-only");
      return [read(s.user)];
    }
    case "den":
      return uniq([...wolves, circle.visitor].map(read));
    case "turnlog":
      return seatOf().visitor ? [read(circle.visitor)] : [];
    case "receipt":
      return [`read("any")`];
  }
}
