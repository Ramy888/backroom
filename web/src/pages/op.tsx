import { useCallback, useEffect, useState } from "react";
import { call, ensureSession } from "../aw";
import { errorText } from "./game";
import type { Strings } from "../i18n";

type Status = {
  challengeOpen: boolean;
  counters: Record<"day" | "judge" | "month", { n: number; of: number }>;
  circles: { active: number; recent: { id: string; status: string; phase: number; executions: number; winner: string | null; at: string }[] };
  errors: { fn: string; at: string; code: number; error: string }[];
  deploy: { deployId: string | null; commit: string | null } | null; demoCircleId: string | null;
};
const codeStore = { get: () => { try { return sessionStorage.getItem("op-code") ?? ""; } catch { return ""; } }, set: (v: string) => { try { sessionStorage.setItem("op-code", v); } catch { /* private mode */ } } };

// #/op: the operator page (R16). The code is checked by the api on every call; this page only remembers it per tab.
export function Operator({ t }: { t: Strings }) {
  const [code, setCode] = useState(codeStore.get);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (op: "status" | "open" | "close", withCode = code) => {
    setBusy(true); setErr(null);
    try { await ensureSession(); setStatus(await call<Status>("op", { code: withCode, op })); codeStore.set(withCode); }
    catch (e) { setErr(e instanceof Error && "status" in e && (e as { status: number }).status === 403 ? "Wrong operator code." : errorText(t, e)); setStatus(null); }
    finally { setBusy(false); }
  }, [code, t]);
  useEffect(() => { if (code) void run("status"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!status) return; const id = setInterval(() => void run("status"), 15_000); return () => clearInterval(id); }, [status, run]);

  if (!status) return (
    <section className="sheet receipt" dir="ltr">
      <h1>Operator</h1>
      <form onSubmit={(e) => { e.preventDefault(); void run("status"); }} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
        <label className="label" htmlFor="op-code">Operator code</label>
        <input id="op-code" className="field" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={busy || !code}>Open</button>
        {err && <div className="err" role="alert">{err}</div>}
      </form>
    </section>
  );
  const bar = (k: keyof Status["counters"], label: string) => {
    const { n, of } = status.counters[k], pct = Math.min(100, Math.round((n / of) * 100));
    return <div className="meter" key={k}><span>{label}</span><span className="mono">{n} / {of}</span><i style={{ width: `${pct}%` }} className={pct >= 80 ? "hot" : ""} /></div>;
  };
  return (
    <section className="sheet receipt op" dir="ltr">
      <h1>Operator</h1>
      <div className={`switch ${status.challengeOpen ? "on" : "off"}`}>
        <b>New games are {status.challengeOpen ? "OPEN" : "PAUSED"}</b>
        <button className={`btn ${status.challengeOpen ? "" : "ghost"}`} disabled={busy} onClick={() => void run(status.challengeOpen ? "close" : "open")}>
          {status.challengeOpen ? "Pause new games (kill switch)" : "Reopen new games"}
        </button>
      </div>
      <h2>Usage against caps</h2>
      {bar("day", "Games today (UTC)")}{bar("judge", "Judge reserve today")}{bar("month", "Games this month")}
      <p className="note">Runbook: above 80% of the month, pause new games. The demo game keeps working while paused.</p>
      <h2>Circles · {status.circles.active > 0 ? `${status.circles.active}+ active` : "none active"}</h2>
      <table className="rows"><thead><tr><th>Circle</th><th>Status</th><th>Phase</th><th>Runs</th><th>Started</th></tr></thead>
        <tbody>{status.circles.recent.map((c) => (
          <tr key={c.id}><td className="mono"><a href={`#/c/${c.id}`}>{c.id.slice(-8)}</a>{c.id === status.demoCircleId ? " · demo" : ""}</td>
            <td>{c.status}{c.winner ? ` · ${c.winner}` : ""}</td><td>{c.phase}</td><td>{c.executions}/60</td><td>{new Date(c.at).toLocaleTimeString()}</td></tr>
        ))}</tbody></table>
      <h2>Latest failed executions</h2>
      {status.errors.length === 0 ? <p className="note">None.</p> : <table className="rows"><tbody>{status.errors.map((e, i) => (
        <tr key={i}><td>{new Date(e.at).toLocaleString()}</td><td className="mono">{e.fn} · {e.code}</td><td className="mono">{e.error || "—"}</td></tr>
      ))}</tbody></table>}
      <h2>Deployed code</h2>
      <dl className="mono deploy"><dt>api deployment</dt><dd>{status.deploy?.deployId ?? "—"}</dd><dt>commit</dt><dd>{status.deploy?.commit ?? "—"}</dd></dl>
      <p className="note">Refreshes every 15 s. <button className="btn ghost" onClick={() => { codeStore.set(""); setCode(""); setStatus(null); }}>Lock</button></p>
    </section>
  );
}
