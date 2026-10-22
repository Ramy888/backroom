import { useCallback, useEffect, useRef, useState } from "react";
import { AppwriteException, Channel, Query } from "appwrite";
import { call, client, DB, ensureSession, realtime, tables, ApiCallError } from "../aw";
import type { Strings } from "../i18n";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const kindOf = (phase: number) => (["vote", "night", "day"] as const)[phase % 3]!;
const tokenKey = (c: string) => `wolf-token-${c}`;
const store = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } } };

// #/play: the visitor writes (or picks) their wolf's opening orders, then the game is dealt with them already in place.
export function Play({ t, lang }: { t: Strings; lang: string }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function deal(withPrompt: string) {
    setBusy(true); setErr(null);
    try {
      await ensureSession();
      const out = await call<{ circleId: string; wolfToken: string }>("setup", { lang, prompt: withPrompt });
      store.set(tokenKey(out.circleId), out.wolfToken);
      location.replace(`#/c/${out.circleId}`);
    } catch (e) {
      setErr(t.play.errors[String(e instanceof ApiCallError ? e.status : "default")] ?? t.play.errors.default!);
      setBusy(false);
    }
  }
  return (
    <section className="thumb" style={{ maxWidth: 420, margin: "32px auto 0" }}>
      <p className="you-note">{t.play.you}</p>
      <div className="label">{t.play.pick}</div>
      {t.play.templates.map((tpl) => <button key={tpl} className="row" dir="auto" aria-pressed={prompt === tpl} onClick={() => setPrompt(tpl)}>{tpl}</button>)}
      <label className="label" htmlFor="open-prompt">{t.play.promptLabel}</label>
      <textarea id="open-prompt" className="field" dir="auto" maxLength={500} rows={3} value={prompt} placeholder={t.play.promptPlaceholder} onChange={(e) => setPrompt(e.target.value)} />
      <button className="btn big full" disabled={busy || !prompt.trim()} onClick={() => void deal(prompt)}>{busy ? t.starting : t.play.deal}</button>
      <button className="btn ghost full" disabled={busy} onClick={() => void deal("")}>{t.play.skip}</button>
      {err && <div className="err" role="alert">{err} <a href="#/">←</a></div>}
    </section>
  );
}

// The board for one circle: everything below is read with the visitor's own session (row permissions apply).
function useCircle(circleId: string) {
  const [state, setState] = useState<{ circle: Row; seats: Row[]; moves: Row[]; closes: Row[]; turns: Row[]; den: Row[]; logs: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const q = [Query.equal("circleId", circleId), Query.orderAsc("$createdAt"), Query.limit(100)];
      const [circle, seats, moves, closes, turns, den, logs] = await Promise.all([
        tables.getRow({ databaseId: DB, tableId: "circles", rowId: circleId }),
        tables.listRows({ databaseId: DB, tableId: "seats", queries: [Query.equal("circleId", circleId), Query.orderAsc("seat")] }),
        tables.listRows({ databaseId: DB, tableId: "moves", queries: q }),
        tables.listRows({ databaseId: DB, tableId: "phases", queries: q }),
        tables.listRows({ databaseId: DB, tableId: "turns", queries: q }),
        tables.listRows({ databaseId: DB, tableId: "night_actions", queries: q }), // the visitor sees only the wolves' rows
        tables.listRows({ databaseId: DB, tableId: "turn_logs", queries: q }), // their wolf's tool calls (X1)
      ]);
      setState({ circle, seats: seats.rows, moves: moves.rows, closes: closes.rows, turns: turns.rows, den: den.rows, logs: logs.rows });
    } catch (e) { setError(e instanceof AppwriteException ? `${e.code} ${e.type}` : "load failed"); }
  }, [circleId]);

  useEffect(() => {
    let alive = true;
    const subs: { unsubscribe: () => Promise<void> }[] = [];
    let poll: ReturnType<typeof setInterval> | undefined;
    (async () => {
      await ensureSession();
      await load();
      poll = setInterval(() => void load(), 30_000); // a stuck turn emits no event: this re-checks it and catches missed ones
      try {
        // Realtime filtered to this circle on the server; delivery is still gated by each row's read permissions.
        for (const table of ["moves", "phases", "turns", "circles", "night_actions", "turn_logs"]) {
          const ch = Channel.tablesdb(DB).table(table).row();
          subs.push(await realtime.subscribe(ch, () => { if (alive) void load(); }, table === "circles" ? undefined : [Query.equal("circleId", [circleId])]));
        }
      } catch { clearInterval(poll); poll = setInterval(() => void load(), 10_000); } // socket refused: poll faster (Section 4)
    })();
    return () => { alive = false; subs.forEach((s) => void s.unsubscribe()); if (poll) clearInterval(poll); };
  }, [circleId, load]);
  return { state, error, reload: load };
}

export function Game({ t, circleId }: { t: Strings; circleId: string }) {
  const { state, error } = useCircle(circleId);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [denials, setDenials] = useState<{ seats: number[]; rot: number; x: number; y: number; own: number; status: number; body: string; rowId: string }[]>([]);
  const [direct, setDirect] = useState(0);
  const [busy, setBusy] = useState(false);
  const live = useRef<HTMLDivElement>(null);

  if (error) return <div className="err" role="alert">{error}</div>;
  if (!state) return <section className="sheet" style={{ marginTop: 24, padding: 16 }}><p>{t.play.loading}</p><div className="skel" /><div className="skel" style={{ width: "60%" }} /></section>;

  const { circle, seats, moves, closes, turns, den, logs } = state;
  const phase = circle.phase as number, kind = kindOf(phase), ended = circle.status !== "active";
  const out = new Map(closes.filter((c) => c.eliminated).map((c) => [c.eliminated as number, c.eliminatedRole as string]));
  const partner = den.find((d) => d.seat !== circle.visitorSeat)?.seat as number | undefined;
  const pending = turns.filter((x) => x.phase === phase && x.status === "pending");
  const speaking = kind === "day" ? pending[0]?.seat : undefined;
  const agentAttempts = logs.filter((l) => l.classified === "attempt").length;
  const returned = logs.reduce((n, l) => n + (l.foreign ?? 0), 0);
  const stuck = pending.some((x) => Date.now() - Date.parse(x.$createdAt) > 60_000);

  async function send() {
    setBusy(true); setNote(null);
    try { await call("inject", { circleId, prompt }); setNote(t.play.sent); }
    catch (e) { setNote(t.play.errors[String(e instanceof ApiCallError ? e.status : "default")] ?? (e as Error).message); }
    finally { setBusy(false); }
  }

  // M3: the guaranteed proof. The browser itself asks TablesDB for every other seat's secret row with the wolf's
  // own JWT. Nothing here goes through our code on a server; the 404s come straight from Appwrite.
  async function tryRead() {
    setBusy(true);
    try {
      let token = store.get(tokenKey(circleId));
      const renew = async () => { token = (await call<{ wolfToken: string }>("token", { circleId })).wolfToken; store.set(tokenKey(circleId), token); };
      if (!token) await renew();
      // Plain REST with only the wolf's JWT: the SDK would also attach the visitor's own session, which is not the proof.
      const getSecret = async (n: number) => {
        const rowId = `${circleId}-s${n}-secret`;
        const r = await fetch(`${client.config.endpoint}/tablesdb/${DB}/tables/secrets/rows/${rowId}`, { credentials: "omit", headers: { "X-Appwrite-Project": client.config.project, "X-Appwrite-JWT": token! } });
        return { n, rowId, status: r.status, body: await r.text() };
      };
      const others = seats.map((s) => s.seat as number).filter((n) => n !== circle.visitorSeat);
      const readAll = () => Promise.all([circle.visitorSeat as number, ...others].map(getSecret));
      let all = await readAll();
      if (all.some((r) => r.status === 401)) { await renew(); all = await readAll(); } // expired token: renew once, retry
      const [own, ...results] = all;
      const denied = results.filter((r) => r.status === 404);
      const last = denied.at(-1) ?? results.at(-1)!;
      setDirect((d) => d + others.length);
      setDenials((ds) => [...ds, { seats: denied.map((r) => r.n), own: own!.status, status: last.status, body: last.body, rowId: last.rowId,
        rot: ds.length ? Math.random() * 16 - 8 : -6, x: 44 + Math.random() * 12, y: 34 + Math.random() * 14 }]);
      try { navigator.vibrate?.(30); } catch { /* unsupported */ }
      if (live.current) live.current.textContent = `Denied by the database: 404 for ${denied.length} of ${others.length} rows. The wolf token cannot read another seat's secret.`;
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  }

  const lastDenial = denials.at(-1);
  const label = (s: Row) => (s.seat === circle.visitorSeat ? t.play.seatYou : s.name);
  const positions = [[7, 74], [7, 28], [50, 0], [93, 28], [93, 74], [50, 100]] as const; // seat 6 (yours) at six o'clock, nearest the thumb

  return (
    <section className="game">
      <div className={`sheet board ${kind === "night" && !ended ? "night" : ""}`}>
        <div className="phase-strip">
          {(["night", "day", "vote"] as const).map((k) => <span key={k} className={kind === k && !ended ? "on" : ""}>{t.phases[k]} {Math.max(1, Math.ceil(phase / 3))}</span>)}
          <span className={ended ? "on" : ""}>{t.phases.reveal}</span>
        </div>
        <div className="score"><span>{t.play.forbidden} · {t.play.attempted} {agentAttempts + direct} · {t.play.returned}</span><span className="zero">{returned}</span></div>
        <div className="table" aria-label="Seats">
          {seats.map((s, i) => {
            const pos = positions[(s.seat as number) - 1] ?? positions[i]!;
            const isOut = s.alive === false;
            return (
              <div key={s.$id} className={`seat ${s.seat === circle.visitorSeat ? "you" : ""} ${speaking === s.seat ? "speaking" : ""} ${isOut ? "out" : ""}`} style={{ insetInlineStart: `${pos[0]}%`, top: `${pos[1]}%` }}>
                <b>{s.seat}</b><span>{isOut ? `${t.play.out} · ${t.roles[out.get(s.seat) ?? ""] ?? "?"}` : label(s)}</span>
              </div>
            );
          })}
        </div>
        <div className="ledger" aria-live="polite">
          {kind === "night" && !ended && <div className="line closed"><span className="no">·</span><span>{t.play.night}</span></div>}
          {mergeTimeline(moves, closes).slice(-10).map((e) => e.close
            ? <div key={e.id} className={`line closed ${e.attempt ? "attempt" : ""}`}><span className="no">·</span><span>{e.text}{e.code && <> <span className="mono">{e.code}</span> · {t.play.returned} {e.foreign}</>}</span></div>
            : <div key={e.id} className="line"><span className="no">{e.seat}</span><span><span className="who">{e.who}{e.target ? ` → ${e.target}` : ""}</span> <span dir="auto">{e.text || "—"}</span></span></div>)}
          {speaking && <div className="line closed"><span className="no">{speaking}</span><span>{seats.find((s) => s.seat === speaking)?.name} {t.play.thinking}</span></div>}
          {ended && <div className="line closed"><span className="no">·</span><span>{t.winner[circle.winner] ?? t.play.ended}</span></div>}
        </div>
        {den.length > 0 && kind === "night" && !ended && <div className="carbon"><b>{t.play.den}</b>{den.filter((d) => d.phase === phase).map((d) => <div key={d.$id} dir="auto">seat {d.seat}{d.target ? ` → ${d.target}` : ""}: {d.text}</div>)}</div>}
        {stuck && !ended && <div style={{ padding: "8px 16px" }}><button className="btn ghost" onClick={() => void call("continue", { circleId })}>{t.play.continue}</button></div>}
      </div>

      <div className="side">
        <p className="you-note">{t.play.you} {partner ? t.play.partner(partner) : ""}</p>
        <div className="slip" aria-label="Request slip">
          <div className="req mono"><span className="k">GET</span> …/tables/secrets/rows/{lastDenial ? lastDenial.rowId.replace(circleId, "…") : "…-s?-secret"}<br /><span className="k">X-Appwrite-JWT</span> wolf token (seat {circle.visitorSeat})<br /><span className="k">status</span> {lastDenial ? lastDenial.status : "—"}</div>
          <div className="emptyrow mono">{lastDenial ? compact(lastDenial.body) : " "}</div>
          <div className="stamps">{denials.map((d, i) => <div key={i} className="stamp drop" style={{ ["--rot" as string]: `${d.rot}deg`, insetInlineStart: `${d.x}%`, top: `${d.y}%` }}>{t.play.denied} · 404</div>)}</div>
          {denials.length > 0 && <div className="why"><span className="tag">{t.play.why}</span><span>{t.play.whyText(lastDenial!.seats.join(", "))} {lastDenial!.own === 200 ? t.play.own : ""}</span></div>}
        </div>
        <button className="btn big full" disabled={busy} onClick={() => void tryRead()}>{denials.length ? t.play.tryAgain : t.play.tryRead}</button>

        <div className="thumb">
          <div className="label">{t.play.templatesTitle}</div>
          {t.play.templates.map((tpl) => <button key={tpl} className="row" dir="auto" onClick={() => setPrompt(tpl)}>{tpl}</button>)}
          <label className="label" htmlFor="wolf-prompt">{t.play.promptLabel}</label>
          <textarea id="wolf-prompt" className="field" dir="auto" maxLength={500} rows={3} value={prompt} placeholder={t.play.promptPlaceholder} onChange={(e) => setPrompt(e.target.value)} />
          <button className="btn full" disabled={busy || ended || !prompt.trim()} onClick={() => void send()}>{t.play.send}</button>
          {note && <p className="note" role="status">{note}</p>}
          {ended && <a className="btn ghost full" href="#/play" style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>{t.play.newGame}</a>}
        </div>
      </div>
      <div className="vh" aria-live="assertive" ref={live} />
    </section>
  );

  function compact(body: string) {
    try { const { code, type } = JSON.parse(body); return JSON.stringify({ code, type }); } catch { return body.slice(0, 80); }
  }

  function mergeTimeline(ms: Row[], cs: Row[]) {
    const byName = new Map(seats.map((s) => [s.seat, label(s)]));
    const items = [
      // X1: each forbidden read your wolf made, with the status TablesDB actually returned to its token.
      ...logs.filter((l) => l.classified === "attempt").map((l) => ({ id: l.$id, at: l.$createdAt as string, close: true, attempt: l.table === "secrets", seat: 0, who: "", target: null,
        text: t.play.wolfTried, code: `${l.table}${l.rowId ? `/${String(l.rowId).replace(circleId, "…")}` : ""} → ${l.status}`, foreign: l.foreign as number })),
      ...ms.filter((m) => m.kind !== "abstain").map((m) => ({ id: m.$id, at: m.$createdAt as string, close: false, attempt: false, seat: m.seat, who: byName.get(m.seat), text: m.text ?? "", target: m.kind === "vote" ? m.target : null, code: "", foreign: 0 })),
      ...cs.filter((c) => c.status === "done" && c.kind !== "day").map((c) => ({ id: c.$id, at: c.$updatedAt as string, close: true, attempt: false, seat: 0, who: "", target: null,
        text: `${t.phases[kindOf(c.phase)]}: ${t.replayClosed(c.eliminated ?? null, c.eliminatedRole ?? null)}`, code: "", foreign: 0 })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }
}
