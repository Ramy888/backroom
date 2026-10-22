import { useEffect, useState } from "react";
import type { Strings } from "../i18n";

type Event = { t: number; phase: number; kind: string; seat?: number; who?: string; text?: string; target?: number | null; eliminated?: number | null; eliminatedRole?: string | null };
type Replay = { winner: string; events: Event[] };
const kindOf = (phase: number) => (["vote", "night", "day"] as const)[phase % 3]!;

// X4 (M7): a recorded game plays from a bundled JSON timeline. Zero database calls, zero Claude calls.
function useReplay() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => { fetch("/replay.json").then((r) => r.json()).then(setReplay).catch(() => setReplay(null)); }, []);
  useEffect(() => {
    if (!replay) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(replay.events.length); return; }
    const id = setInterval(() => setShown((n) => (n >= replay.events.length + 3 ? 1 : n + 1)), 1600); // loop with a short pause
    return () => clearInterval(id);
  }, [replay]);
  return { replay, events: replay?.events.slice(0, Math.min(shown, replay.events.length)) ?? [] };
}

export function Landing({ t }: { t: Strings }) {
  const { replay, events } = useReplay();
  const last = events.at(-1);
  const phase = last?.phase ?? 1;
  const ended = replay && events.length === replay.events.length;
  return (
    <section className="hero">
      <div>
        <h1>{t.h1}</h1>
        <p className="lede">{t.lede}</p>
        <a className="btn big" href="#/play" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{t.take}</a>
      </div>
      <figure className={`sheet ${kindOf(phase) === "night" && !ended ? "night" : ""}`} style={{ margin: 0 }} aria-label={t.replayCaption}>
        <div className="phase-strip">
          {(["night", "day", "vote"] as const).map((k) => <span key={k} className={kindOf(phase) === k && !ended ? "on" : ""}>{t.phases[k]} {Math.ceil(phase / 3)}</span>)}
          <span className={ended ? "on" : ""}>{t.phases.reveal}</span>
        </div>
        <div className="ledger" aria-live="off">
          {!replay && <><div className="skel" style={{ width: "90%" }} /><div className="skel" style={{ width: "60%" }} /></>}
          {events.slice(-6).map((e, i) => e.kind === "close"
            ? <div key={i} className="line closed"><span className="no">·</span><span>{t.replayClosed(e.eliminated ?? null, e.eliminatedRole ?? null)}</span></div>
            : <div key={i} className="line"><span className="no">{e.seat}</span><span><span className="who">{e.who}</span> {e.kind === "vote" && e.target ? `→ ${e.target} ` : ""}<span dir="auto">{e.text}</span></span></div>)}
          {ended && <div className="line closed"><span className="no">·</span><span>{t.winner[replay!.winner] ?? ""}</span></div>}
        </div>
        <figcaption className="caption">{t.replayCaption}</figcaption>
      </figure>
    </section>
  );
}
