import { useEffect, useState } from "react";
import { STRINGS, type Lang } from "./i18n";
import { Landing } from "./pages/landing";
import { Game, Play } from "./pages/game";

// Hash routes keep Sites hosting static: #/ landing, #/c/<circleId> game, #/r/<receiptId> receipt.
const parse = () => location.hash.replace(/^#\/?/, "").split("/");

export function App() {
  const [lang, setLang] = useState<Lang>(() => { try { return (localStorage.getItem("lang") as Lang) || "en"; } catch { return "en"; } });
  const [route, setRoute] = useState(parse);
  useEffect(() => { const f = () => setRoute(parse()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("lang", lang); } catch { /* private mode: language just won't persist */ }
  }, [lang]);
  const t = STRINGS[lang];
  return (
    <div className="wrap">
      <header className="top">
        <a className="mark" href="#/">Backroom<span className="tag">{t.tag}</span></a>
        <button className="tog" onClick={() => setLang(lang === "en" ? "ar" : "en")} aria-label="Switch language">{t.other}</button>
      </header>
      {route[0] === "play" ? <Play t={t} lang={lang} /> : route[0] === "c" && route[1] ? <Game key={route[1]} t={t} circleId={route[1]} /> : <Landing t={t} />}
      <footer>{t.footer}</footer>
    </div>
  );
}
