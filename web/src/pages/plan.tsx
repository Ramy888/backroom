import { useCallback, useEffect, useState } from "react";
import { Channel, Query } from "appwrite";
import { DAHAB_OPTIONS, DEALBREAKERS, DEFAULT_HUMAN_LIMITS, WEEKENDS, otherWeekend, type Limits } from "@backroom/core";
import { call, DB, ensureSession, realtime, tables, ApiCallError } from "../aw";
import { errorText, judgeStore } from "./game";
import type { Strings } from "../i18n";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const optionOf = (id: string) => DAHAB_OPTIONS.find((o) => o.id === id);

// The limits form, used to start a plan and to edit limits during one. Every value goes to the api, never to a table.
function LimitsForm({ t, value, onChange }: { t: Strings; value: Limits; onChange: (l: Limits) => void }) {
  const p = t.plan;
  return (
    <fieldset className="limits">
      <legend>{p.yourLimits}</legend>
      <p className="note">{p.private}</p>
      <label className="label" htmlFor="budget">{p.budget}</label>
      <input id="budget" className="field" type="number" min={1000} max={10000} step={100} value={value.budget} onChange={(e) => onChange({ ...value, budget: Number(e.target.value) })} />
      <div className="label">{p.weekends}</div>
      <div className="chips">{WEEKENDS.map((w) => (
        <label key={w} className={`chip ${value.weekends.includes(w) ? "on" : ""}`}>
          <input type="checkbox" checked={value.weekends.includes(w)} onChange={(e) => onChange({ ...value, weekends: e.target.checked ? [...value.weekends, w] : value.weekends.filter((x) => x !== w) })} />{p.weekend[w]}
        </label>
      ))}</div>
      <div className="label">{p.dealbreaker}</div>
      <div className="chips">{DEALBREAKERS.map((d) => (
        <label key={d} className={`chip ${value.dealbreaker === d ? "on" : ""}`}>
          <input type="radio" name="dealbreaker" checked={value.dealbreaker === d} onChange={() => onChange({ ...value, dealbreaker: d })} />{p.deal[d]}
        </label>
      ))}</div>
    </fieldset>
  );
}

// #/plan: the visitor sets their private limits; the defaults already fit one option, so the demo always converges.
export function PlanStart({ t, lang }: { t: Strings; lang: string }) {
  const [limits, setLimits] = useState<Limits>(DEFAULT_HUMAN_LIMITS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function start() {
    setBusy(true); setErr(null);
    try {
      await ensureSession();
      const { circleId } = await call<{ circleId: string }>("setup", { kind: "plan", lang, limits, judgeCode: judgeStore.get() || undefined }); // the judge code saved on the Play page
      location.replace(`#/p/${circleId}`);
    } catch (e) { setErr(e instanceof ApiCallError && e.code === "limits" ? e.message : errorText(t, e)); setBusy(false); }
  }
  return (
    <section className="plan-start">
      <h1>{t.plan.title}</h1>
      <p className="lede">{t.plan.lede}</p>
      <LimitsForm t={t} value={limits} onChange={setLimits} />
      <button className="btn big full" disabled={busy || !limits.weekends.length} onClick={() => void start()}>{busy ? t.plan.starting : t.plan.start}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </section>
  );
}

function usePlan(circleId: string) {
  const [state, setState] = useState<{ circle: Row; seats: Row[]; moves: Row[]; turns: Row[]; candidates: Row[]; mine: Row | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const q = [Query.equal("circleId", circleId), Query.orderAsc("$createdAt"), Query.limit(100)];
      const [circle, seats, moves, turns, candidates, secrets] = await Promise.all([
        tables.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }),
        tables.listRows({ databaseId: DB, tableId: "seats", queries: [Query.equal("circleId", circleId), Query.orderAsc("seat")] }),
        tables.listRows({ databaseId: DB, tableId: "moves", queries: q }),
        tables.listRows({ databaseId: DB, tableId: "turns", queries: q }),
        tables.listRows({ databaseId: DB, tableId: "plan_candidates", queries: [Query.equal("circleId", circleId), Query.orderAsc("generation")] }),
        tables.listRows({ databaseId: DB, tableId: "secrets", queries: [Query.equal("circleId", circleId)] }), // only the visitor's own row comes back
      ]);
      setState({ circle, seats: seats.rows, moves: moves.rows, turns: turns.rows, candidates: candidates.rows, mine: secrets.rows[0] ?? null });
    } catch (e) { setError(String((e as Error).message)); }
  }, [circleId]);
  useEffect(() => {
    let alive = true;
    const subs: { unsubscribe: () => Promise<void> }[] = [];
    const poll = setInterval(() => void load(), 30_000);
    (async () => {
      await ensureSession();
      await load();
      try {
        for (const table of ["circles", "moves", "turns", "plan_candidates", "seats"]) {
          subs.push(await realtime.subscribe(Channel.tablesdb(DB).table(table).row(), () => { if (alive) void load(); }, table === "circles" ? undefined : [Query.equal("circleId", [circleId])]));
        }
      } catch { /* the 30 s poll covers a refused socket */ }
    })();
    return () => { alive = false; subs.forEach((s) => void s.unsubscribe()); clearInterval(poll); };
  }, [circleId, load]);
  return { state, error, reload: load };
}

export function PlanBoard({ t, lang, circleId }: { t: Strings; lang: string; circleId: string }) {
  const { state, error, reload } = usePlan(circleId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stamp, setStamp] = useState<{ kind: "conflict" | "approved"; generation: number } | null>(null);
  const [editing, setEditing] = useState<Limits | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);
  const p = t.plan;
  const nameOf = (s: Row) => (s.seat === state?.circle.visitorSeat ? p.yourAgent : (s.name as string));
  const titleOf = (id: string) => { const o = optionOf(id); return o ? (lang === "ar" ? o.titleAr : o.title) : id; };

  if (error) return <div className="err" role="alert">{error}</div>;
  if (!state) return <section className="sheet" style={{ marginTop: 24, padding: 16 }}><p>{t.play.loading}</p><div className="skel" /></section>;
  const { circle, seats, moves, turns, candidates, mine } = state;
  const myLimits: Limits = mine?.limits ? JSON.parse(mine.limits) : DEFAULT_HUMAN_LIMITS;
  const planState = circle.planState as string;
  const candidate = candidates.find((c) => c.generation === circle.generation);
  const option = candidate ? optionOf(candidate.optionId) : undefined;
  const left = candidate ? Math.max(0, Math.round((Date.parse(candidate.$createdAt) + 300_000 - nowMs) / 1000)) : 0;
  const votes = moves.filter((m) => m.kind === "plan-vote");
  const pending = turns.filter((x) => x.phase === circle.phase && x.status === "pending").map((x) => x.seat as number);
  const shownStamp = planState === "committed" ? { kind: "approved" as const, generation: circle.generation as number } : stamp;

  async function act(fn: () => Promise<void>) {
    setBusy(true); setNote(null);
    try { await fn(); await reload(); }
    catch (e) {
      if (e instanceof ApiCallError && e.code === "restaged") setNote(p.restaged);
      else if (e instanceof ApiCallError && e.code === "expired") setNote(p.expiredWhy);
      else setNote(e instanceof ApiCallError && e.code === "limits" ? e.message : errorText(t, e));
      await reload();
    } finally { setBusy(false); }
  }
  const approve = () => act(async () => {
    const out = await call<{ state: string }>("approve", { circleId, generation: circle.generation });
    if (out.state === "conflict") setStamp({ kind: "conflict", generation: circle.generation });
    if (out.state === "committed") setStamp({ kind: "approved", generation: circle.generation });
    if (out.state === "stalled") setNote(p.stalledWhy);
  });
  const saveLimits = (limits: Limits) => act(async () => { await call("editLimit", { circleId, limits }); setEditing(null); });

  return (
    <section className="game plan">
      <div className="sheet board">
        <div className="phase-strip">
          <span className="on">{p.round(Math.max(1, circle.phase))}</span>
          <span className={planState === "negotiating" ? "on" : ""}>{p.state.negotiating}</span>
          <span className={planState === "awaiting" ? "on" : ""}>{p.state.awaiting}</span>
          <span className={["committed", "stalled", "expired"].includes(planState) ? "on" : ""}>{p.state[planState === "awaiting" || planState === "negotiating" ? "committed" : planState]}</span>
        </div>
        <div className="plan-seats">
          {seats.map((s) => {
            const mineSeat = s.seat === circle.visitorSeat;
            const last = votes.filter((m) => m.seat === s.seat).at(-1);
            const fitsN = last?.vote === "accept" ? String(last.text ?? "").split(",").filter(Boolean).length : 0;
            const changed = (s.seatVersion ?? 0) > 0;
            return (
              <div key={s.$id} className="plan-seat">
                <div className={`seat static ${mineSeat ? "you" : ""} ${pending.includes(s.seat) ? "speaking" : ""}`}><b>{s.seat}</b><span>{nameOf(s)}</span></div>
                <div className={`bubble glass pop ${pending.includes(s.seat) ? "near" : "front"}`} role="group" aria-label={nameOf(s)}>
                  {pending.includes(s.seat)
                    ? <span className="dots" aria-label={p.thinking}><i /><i /><i /></span>
                    : last ? <span>{p.fitsN(fitsN)}{fitsN > 0 && <> · {p.favourite} <b dir="auto">{titleOf(last.proposalId)}</b></>}</span> : <span>—</span>}
                  {changed && <span className="tried">{p.changed(nameOf(s))}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <details className="transcript">
          <summary>{t.play.transcript}</summary>
          <div className="ledger">
            {votes.map((m) => (
              <div key={m.$id} className="line"><span className="no">{m.seat}</span>
                <span><span className="who">{p.round(m.phase)}</span> {m.vote === "accept" ? `${p.fitsN(String(m.text).split(",").filter(Boolean).length)} · ${p.favourite} ${titleOf(m.proposalId)}` : p.fitsN(0)} <span className="mono">v{m.limitsVersion}</span></span></div>
            ))}
            {candidates.map((c) => (
              <div key={c.$id} className={`line closed ${!c.committed && c.generation < circle.generation ? "attempt" : ""}`}><span className="no">·</span>
                <span>g{c.generation}: {titleOf(c.optionId)} {c.committed ? `· ${p.approved}` : c.generation < circle.generation ? "· 409 transaction_conflict / expired" : ""}</span></div>
            ))}
          </div>
        </details>
      </div>

      <div className="side">
        {candidate && option && (
          <div className="slip candidate" aria-label={p.candidate}>
            <div className="label">{p.candidate} · g{candidate.generation}</div>
            <h2 dir="auto">{titleOf(option.id)}</h2>
            <p>{p.weekend[option.weekend]} · {option.pricePerPerson.toLocaleString()} EGP {p.perPerson}</p>
            <table className="rows"><thead><tr><th>{t.receipt.seat}</th><th>{p.shares}</th></tr></thead>
              <tbody>{(JSON.parse(candidate.shares) as { seat: number; amount: number }[]).map((sh) => (
                <tr key={sh.seat}><td>{nameOf(seats.find((s) => s.seat === sh.seat) ?? {})}</td><td className="mono">{sh.amount.toLocaleString()} EGP</td></tr>
              ))}</tbody></table>
            {planState === "awaiting" && <p className="note">{p.window(left)}</p>}
            <div className="stamps">{shownStamp && <div className={`stamp drop ${shownStamp.kind}`} style={{ ["--rot" as string]: "-6deg", insetInlineStart: "50%", top: "46%" }}>{shownStamp.kind === "approved" ? p.approved : `${p.conflict} · 409`}</div>}</div>
            {shownStamp && <div className={`why ${shownStamp.kind}`}><span className="tag">{t.play.why}</span><span>{shownStamp.kind === "approved" ? p.approvedWhy(shownStamp.generation) : p.conflictWhy}</span></div>}
          </div>
        )}
        {planState === "awaiting" && (
          <>
            <button className="btn big full" disabled={busy} onClick={() => void approve()}>{p.approve}</button>
            <button className="btn ghost full" disabled={busy} onClick={() => void saveLimits(otherWeekend(myLimits))}>{busy ? p.changing : p.change}</button>
          </>
        )}
        {planState === "stalled" && <p className="err">{p.stalledWhy}</p>}
        {planState === "expired" && <p className="err">{p.expiredWhy}</p>}
        {note && <p className="note" role="status">{note}</p>}
        <div className="thumb">
          {editing
            ? <><LimitsForm t={t} value={editing} onChange={setEditing} /><button className="btn full" disabled={busy || !editing.weekends.length} onClick={() => void saveLimits(editing)}>{p.save}</button></>
            : <div className="limits-view"><b>{p.yourLimits}</b><span>{myLimits.budget.toLocaleString()} EGP · {myLimits.weekends.map((w) => p.weekend[w]).join(", ")} · {p.deal[myLimits.dealbreaker]}</span>
                {circle.status === "active" && <button className="btn ghost" onClick={() => setEditing(myLimits)}>{p.edit}</button>}</div>}
          {circle.status !== "active" && <a className="btn ghost full" href="#/plan" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>{p.newPlan}</a>}
        </div>
      </div>
    </section>
  );
}
