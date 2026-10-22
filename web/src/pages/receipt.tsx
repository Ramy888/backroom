import { useEffect, useState } from "react";
import { tables, DB } from "../aw";
import type { Receipt as Snapshot } from "@backroom/core";
import type { Strings } from "../i18n";

// #/r/<id>: a public receipt. The row is read("any"), so this needs no session; it outlives the circle it describes.
export function Receipt({ t, id }: { t: Strings; id: string }) {
  const [data, setData] = useState<{ snap: Snapshot; deployId: string | null; commit: string | null } | null | "missing">(null);
  useEffect(() => {
    tables.getRow({ databaseId: DB, tableId: "receipts", rowId: id })
      .then((r) => setData({ snap: JSON.parse(r.snapshot), deployId: r.deployId ?? null, commit: r.commit ?? null }), () => setData("missing"));
  }, [id]);
  if (data === null) return <section className="sheet receipt"><p>{t.receipt.loading}</p><div className="skel" /></section>;
  if (data === "missing") return <section className="sheet receipt"><div className="err" role="alert">{t.receipt.notFound}</div><a className="btn" href="#/play">{t.receipt.verify}</a></section>;
  const { snap } = data, r = t.receipt;
  const who = (l: string) => (l === "visitor" ? r.visitor : l === "anyone" ? r.anyone : l === "another user" ? r.other : l.replace("seat", r.seat));
  return (
    <section className="sheet receipt">
      <header className="receipt-head">
        <h1>{r.title}</h1>
        <p>{r.game} · {r.phases(snap.phases)} · {new Date(snap.endedAt).toLocaleString()} · <b>{t.winner[snap.winner ?? ""] ?? t.play.ended}</b></p>
      </header>
      <div className="score"><span>{r.forbidden} · {r.attempted} {snap.forbiddenReads.attempted} · {r.returned}</span><span className="zero">{snap.forbiddenReads.returned}</span></div>
      <h2>{r.rows}</h2>
      <table className="rows">
        <thead><tr><th>{r.seat}</th><th>{r.role}</th><th>{r.row}</th><th>{r.readable}</th></tr></thead>
        <tbody>{snap.rows.map((row) => {
          const seat = snap.seats.find((s) => s.seat === row.seat);
          return (
            <tr key={row.row}>
              <td><b>{row.seat}</b> {row.seat === snap.visitorSeat ? r.playerWolf : seat?.name}</td>
              <td><span className={`role ${row.role}`}>{t.roles[row.role] ?? row.role}</span></td>
              <td className="mono">{row.row}</td>
              <td>{row.readableBy.map(who).join(", ")}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <h2>{r.deploy}</h2>
      <dl className="mono deploy">
        <dt>{r.deployId}</dt><dd>{data.deployId ?? "—"}</dd>
        <dt>{r.commit}</dt><dd>{data.commit ?? "—"}</dd>
        <dt>{r.scopes}</dt><dd>{snap.deploy.scopes.join(" ")}</dd>
      </dl>
      <p className="note">{r.note}</p>
      <a className="btn big" href="#/play" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{r.verify}</a>
    </section>
  );
}
