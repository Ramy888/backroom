// Records the Backroom demo in headless Chrome (no overlay, a drawn pointer), against a deployed Site.
// Waits for the agents are cut out with pause()/resume(), so the video shows only moments where something happens.
// Run: node scripts/demo-video/record.mjs [--site https://backroom-test.appwrite.network] [--demo <circleId>]
// then, inside scripts/demo-video/out/:
//   ffmpeg -f concat -safe 0 -i list.txt -vf "scale=1920:1200,format=yuv420p" -r 30 -c:v libx264 -crf 18 backroom-silent.mp4
import { launch, sleep } from "./cdp.mjs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const envTest = (() => { try { return readFileSync(".env.test", "utf8"); } catch { return ""; } })();
const envDemo = /^DEMO_CIRCLE_ID=(.+)$/m.exec(envTest)?.[1];
// The test project's own judge code (never shown on screen) keeps repeated recordings clear of the per-network cap.
const judge = /^JUDGE_CODE=(.+)$/m.exec(envTest)?.[1] ?? "";
const { values } = parseArgs({ options: { site: { type: "string", default: "https://backroom-test.appwrite.network" }, demo: { type: "string", default: envDemo } } });
const SITE = values.site.replace(/\/$/, "");
const DIR = fileURLToPath(new URL("./out/", import.meta.url)); // .pathname would keep %20 in a path with spaces
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR + "frames", { recursive: true });

const b = await launch({ width: 1440, height: 900, scale: 4 / 3 });
const cues = [];
const cue = (text) => { cues.push({ at: b.mark(), text }); console.log(b.mark().toFixed(1), text); };
const rect = async (sel) => b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});const q=e.getBoundingClientRect();return {x:q.x+q.width/2,y:q.y+q.height/2}})()`);
// Pointer presses get dropped while the screencast runs, so (like cdp.mjs activate) the drawn pointer moves and
// ripples on camera, then the element itself is clicked: every press lands, with no retry on camera.
const ripple = (p) => b.evaluate(`(()=>{const r=document.getElementById('rec-ripple');if(!r)return;r.style.transition='none';r.style.left='${p.x}px';r.style.top='${p.y}px';r.style.opacity=1;r.style.transform='scale(.4)';r.offsetWidth;r.style.transition='opacity .5s, transform .5s';r.style.opacity=0;r.style.transform='scale(1.6)';})()`);
const tapAt = async (p, clickJs) => { await b.moveTo(p); await ripple(p); await sleep(120); await b.evaluate(clickJs); await sleep(200); };
const press = async (sel) => {
  let p; for (let i = 0; i < 40 && !(p = await rect(sel)); i++) await sleep(250);
  if (!p) { await b.shot(DIR + "../fail.png"); throw new Error("missing " + sel); }
  await tapAt(p, `document.querySelector(${JSON.stringify(sel)}).click()`);
};
const tryRead = () => press(".side .btn.big");
const byText = (text) => `[...document.querySelectorAll('button,a')].find((x)=>x.textContent.trim().includes(${JSON.stringify(text)}))`;
const pressText = async (text) => {
  let p; for (let i = 0; i < 40 && !(p = await b.evaluate(`(()=>{const e=${byText(text)};if(!e)return null;e.scrollIntoView({block:'center',behavior:'instant'});const q=e.getBoundingClientRect();return {x:q.x+q.width/2,y:q.y+q.height/2}})()`)); i++) await sleep(250);
  if (!p) { await b.shot(DIR + "../fail.png"); throw new Error("missing button " + text); }
  await tapAt(p, `${byText(text)}.click()`);
};
const waitFor = async (js, ms = 240_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await b.evaluate(js)) return; await sleep(1000); } throw new Error("timeout waiting for " + js); };
const scrollTo = (y) => b.evaluate(`window.scrollTo({top:${y},behavior:'smooth'})`);
const hover = (x, y) => b.moveTo({ x, y });

// Fresh visitor: no stored language, token or session.
await b.goto(SITE + "/#/", 4000);
await b.evaluate(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('lang','en'); localStorage.setItem('judge-code', ${JSON.stringify(judge)}); location.reload()`); await sleep(4000);
await b.startRec();

// 1. Landing
cue("Landing: give the wolf any prompt, the database still says no");
await sleep(2500); await hover(420, 300); await sleep(2500); await hover(1100, 330); await sleep(3500);

// 2. Take the wolf with an injection template
cue("Take the wolf and give it a jailbreak");
await pressText("Take the wolf"); await sleep(2500);
await press(".thumb .row"); await sleep(2000);
cue("Deal the seats: six AI players, six real database users");
await pressText("Deal the seats");
b.pause(); await waitFor("!!document.querySelector('.stage')"); await sleep(2500); await b.ensureCursor(); await b.resume();

// 3. The live board
cue("Night: the wolves pick a target in their den");
await sleep(3500);
b.pause(); await waitFor("[...document.querySelectorAll('.hist p')].length >= 3"); await b.ensureCursor(); await b.resume();
cue("Day: every seat speaks in its own bubble, live over Realtime");
await hover(500, 420); await sleep(3000); await hover(700, 640); await sleep(3500);
b.pause(); await waitFor("!!document.querySelector('.tried')", 120_000).catch(() => {}); await b.ensureCursor(); await b.resume();
cue("The jailbroken wolf tries to read other seats' secrets: 0 rows returned");
await hover(560, 760); await sleep(4500);

// 4. The proof from the browser
cue("Try to read the Seer's role: the browser asks TablesDB with the wolf's own token");
await tryRead(); await sleep(4000);
await hover(1100, 360); await sleep(3000);
cue("Five 404s from Appwrite; only the wolf's own row comes back");
await tryRead(); await sleep(2500); await tryRead(); await sleep(3500);

// 5. Arabic
cue("Fully in Egyptian Arabic, right to left");
await press("button.tog"); await sleep(4500); await press("button.tog"); await sleep(1500);

// 6. Receipt (from the always-on demo game)
if (values.demo) {
  b.pause(); await b.goto(`${SITE}/#/c/${values.demo}`, 6000); await b.resume();
  cue("The demo game: a finished game anyone can open, even when today's games are used up");
  await sleep(3000);
  await pressText("Share the receipt");
  b.pause();
  await waitFor("!!document.querySelector('a.note[href*=\"#/r/\"]')", 30_000);
  const href = await b.evaluate("document.querySelector('a.note[href*=\"#/r/\"]').href");
  await b.goto(href, 5000); await b.resume();
  cue("A public receipt: who could read each role row during play, seats not users, and the deployed commit");
  await hover(700, 450); await sleep(3500); await hover(700, 650); await sleep(3500);
}

// 7. Plan: a real transaction conflict
b.pause(); await b.goto(`${SITE}/#/plan`, 4000); await b.resume();
cue("Plan a Dahab weekend: two AI friends with private budgets and dates");
await hover(700, 500); await sleep(3000);
await pressText("Start planning");
b.pause(); await waitFor("!!document.querySelector('.candidate')"); await sleep(1500); await b.ensureCursor(); await b.resume();
cue("Three agents agree; the plan is held in one staged transaction");
await hover(1100, 300); await sleep(3500);
cue("Change my dates while the plan waits for approval");
await pressText("Change my dates");
b.pause(); await waitFor("!!document.querySelector('.plan-seat .tried') && !" + byText("Approve the plan") + "?.disabled", 30_000); await b.resume(); // the server took the edit
await sleep(1500);
await pressText("Approve the plan");
b.pause(); await waitFor("!!document.querySelector('.stamp.conflict')", 30_000); await b.resume();
cue("The commit hits 409 transaction_conflict, from the database itself");
await hover(1050, 420); await sleep(4500);
b.pause(); await waitFor("document.querySelector('.candidate .label')?.textContent.includes('g2')"); await sleep(1500); await b.ensureCursor(); await b.resume();
cue("The agents re-plan with the new dates; approve generation 2");
await sleep(2500);
await pressText("Approve the plan");
b.pause(); await waitFor("!!document.querySelector('.stamp.approved')", 30_000); await b.resume();
cue("Approved: every member's row moved in one transaction");
await hover(1050, 420); await sleep(4500);

// 8. Close
b.pause(); await b.goto(`${SITE}/#/`, 4000); await b.resume();
cue("Backroom on Appwrite TablesDB: the prompt can be anything, the permissions still hold");
await sleep(5000);

const { frames, end } = await b.stopRec();
b.close();

// frames -> constant 30 fps: each output slot shows the newest frame captured by then
const FPS = 30, start = frames[0].t, slots = Math.ceil((end - start) * FPS);
const list = []; let j = 0; const written = new Map();
for (let s = 0; s < slots; s++) {
  const t = start + s / FPS;
  while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
  if (!written.has(j)) { const name = `frames/${String(j).padStart(5, "0")}.jpg`; writeFileSync(DIR + name, Buffer.from(frames[j].data, "base64")); written.set(j, name); }
  list.push(`file '${written.get(j)}'`, `duration ${(1 / FPS).toFixed(6)}`);
}
list.push(list[list.length - 2]);
writeFileSync(DIR + "list.txt", list.join("\n") + "\n");
writeFileSync(DIR + "cues.json", JSON.stringify(cues.map((c) => ({ at: Math.max(0, c.at - start), text: c.text })), null, 1));
console.log(`frames ${frames.length}, length ${(end - start).toFixed(1)} s`);
