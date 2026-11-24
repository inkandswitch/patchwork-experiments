// Check one published doc in the REAL Patchwork: open
// https://patchwork.inkandswitch.com/#doc=<url> in headless Chrome (a fresh
// profile, cdp.mjs), say yes to the shell's offer to load the doc's packages,
// wait for the scene to arrive and its content to load, screenshot it, and
// fail on page errors from our packages. One generic check for every
// example; nothing is pressed, so nothing is written but what any viewer's
// visit writes.
//
// A copy of scene/probes/real-check.mjs; GPU=1 (cdp.mjs) for scenes too heavy for SwiftShader (the ink gallery).
//   (in ink-studio/) [GPU=1] node probes/real-check.mjs <url> <shots dir> [--name tag] [--wait 180] [--not-scene] [--eval <js>]
//
// --eval: an expression evaluated in the page once loaded (before the
// screenshot); its value goes in the report as `eval` (for looking, not a check).
//
// Arrived: the outermost stage is up (globalThis.__sceneDebug), the view has
// arrived (the view's own `arrived`) and the body chip names the body. Loaded: no package
// left to ask for or loading, and the count of built objects (stats().loaded)
// unchanged for 5 s. --not-scene (a doc of another datatype, such as a
// tabletop-game) checks only that a tool showed it and that the page logged
// nothing of ours.
//
// Ours: an uncaught exception, or a console error or warning that names one of
// this repo's packages (a `[scene…]`-style tag, or a package's pushwork URL).
// Known shell noise (resolver timeouts, the shell's own packages) is listed,
// not failed. The shell sometimes loads a stale package build right after a
// sync: rerun once before believing a failure. Prints a JSON report; exits 1
// on any failed check.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [url, shotsArg] = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
if (!/^automerge:\w+$/.test(url ?? "") || !shotsArg) {
  console.error("usage: node probes/real-check.mjs <automerge:url> <shots dir> [--name tag] [--wait 180] [--not-scene]");
  process.exit(2);
}
const SHOTS = resolve(shotsArg);
mkdirSync(SHOTS, { recursive: true });
const NAME = arg("--name", url.slice(10, 18));
const WAIT = Number(arg("--wait", 180));
const NOT_SCENE = process.argv.includes("--not-scene");

// this repo's packages: their pushwork ids (an error naming one is ours)
const ROOT = resolve(HERE, "../..");
const ours = [];
for (const d of readdirSync(ROOT)) {
  const c = join(ROOT, d, ".pushwork/config.json");
  if (!existsSync(c)) continue;
  try {
    const id = JSON.parse(readFileSync(c, "utf8")).rootUrl?.replace(/^automerge:/, "");
    if (id) ours.push({ name: d, id });
  } catch {}
}
const TAG = /\[(scene|sailing|water|weather|terrain|tabletop|seats|walk|machine|arena|joints|doom|traversal|naval|dice|keep|bag)[\]\s:-]/i;
// shell noise, and a walk start's pointer lock, which a browser refuses until a click (no gesture on arrival)
const NOISE = [/resolv\w* .*tim(ed|e) ?out/i, /timed out .*resolv/i, /m6dt2f4hYdhyvmFDvXYbYDdNQey/, /pointer lock refused NotAllowedError: A user gesture is required/];
const isOurs = (line) => TAG.test(line) || ours.some((p) => line.includes(p.id));

const b = await browser({ root: HERE, port: Number(arg("--port", 4990)), cdp: Number(arg("--cdp", 9990)), page: "/cdp.mjs", width: 1440, height: 900, timeout: (WAIT + 120) * 1000 });
const list = checklist();
const { check } = list;
const DEEP = `(sel) => { const out = []; const walk = (root) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return out; }`;
const STATE = `(() => {
  const d = globalThis.__sceneDebug;
  const chip = (${DEEP})(".body-chip")[0];
  if (!d) return { stage: false, chip: chip?.innerText?.trim() ?? null, text: document.body?.innerText?.slice(0, 300) ?? "" };
  const v = d.view?.atom?.get?.() ?? {}; // the view's own value: how it arrived, every open doc's packages
  const p = v.packages ?? d.local.get().packages ?? {};
  const s = d.stats();
  return { stage: true, arrived: !!v.arrived, chip: chip?.innerText?.trim() ?? null,
    ask: (p.ask ?? []).length, loading: (p.loading ?? []).length, failed: (p.failed ?? []).map((e) => e.url ?? e.name ?? String(e)),
    loaded: s.loaded, objects: d.viewport?.objects?.size ?? null, pending: s.pending };
})()`;
// a call into the page never hangs the check (an evaluate can stall while the shell navigates)
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms))]);
const js = (expr, what = "the page") => within(15000, b.js(expr), what);
const t0 = Date.now();
const secs = () => Math.round((Date.now() - t0) / 1000);
let st = null;
let evaluated;
try {
  // walk's bakes and the page's long tasks, from the first script on (read them with --eval)
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: "globalThis.__WALK_BAKES__ = []; globalThis.__LONG__ = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__LONG__.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}" });
  // --profile: a CPU profile of the join, summarised as self time by function (top 30)
  if (process.argv.includes("--profile") && arg("--profile") !== "walk") {
    await b.send("Profiler.enable");
    await b.send("Profiler.setSamplingInterval", { interval: 1000 });
    await b.send("Profiler.start");
  }
  await b.send("Page.navigate", { url: `https://patchwork.inkandswitch.com/#doc=${url}` });
  let arrivedAt = null, lastLoaded = -1, stillSince = Date.now(), done = false;
  while (secs() < WAIT && !done) {
    await sleep(1000);
    // the shell's offer to load the doc's packages (a button, then a confirm)
    await js(`(() => { const hits = (${DEEP})("button").filter((x) => /^\\s*(load|load (it|them|package|packages))\\b/i.test(x.innerText ?? "")); setTimeout(() => hits.forEach((x) => x.click()), 0); })()`).catch(() => {});
    try {
      await within(3000, b.send("Page.handleJavaScriptDialog", { accept: true }), "dialog");
    } catch {}
    st = await js(STATE, "the state").catch((e) => ({ error: String(e) }));
    if (secs() % 10 === 0) console.error(`${secs()}s ${JSON.stringify(st).slice(0, 240)}`);
    if (NOT_SCENE) {
      done = secs() > 25 && !/no tool|can't open|cannot open/i.test(st?.text ?? "") && (st?.text ?? "").trim().length > 0;
      continue;
    }
    if (st?.stage && st.arrived && st.chip && arrivedAt == null) arrivedAt = secs();
    if (st?.loaded !== lastLoaded) (lastLoaded = st?.loaded), (stillSince = Date.now());
    done = arrivedAt != null && st.ask === 0 && st.loading === 0 && st.loaded > 0 && Date.now() - stillSince >= 5000;
  }
  if (NOT_SCENE) check("a tool shows the doc", done, st);
  else {
    check("the scene arrived (stage up, view arrived, body chip named)", arrivedAt != null, { arrivedAt, ...st });
    check("its content loaded (no package asked for or loading, built objects steady)", done, st);
    check("no package failed to load", !(st?.failed?.length), st?.failed);
  }
  await sleep(1500);
  if (arg("--eval")) evaluated = await js(arg("--eval"), "--eval").catch((e) => `threw: ${e.message}`);
  // --walk: choose Walk on the body chip, click the view (a real gesture), hold W, and say where the camera went
  if (process.argv.includes("--walk")) {
    const cam = `(() => { const v = globalThis.__sceneDebug.viewport; return { pos: v.camera.position.toArray().map((x) => +x.toFixed(3)), body: globalThis.__sceneDebug.view?.atom?.get?.()?.body?.id ?? null, chip: (${DEEP})(".body-chip")[0]?.innerText?.trim() }; })()`;
    const before = await js(cam);
    if (arg("--profile") === "walk") {
      await b.send("Profiler.enable");
      await b.send("Profiler.setSamplingInterval", { interval: 500 });
      await b.send("Profiler.start");
    }
    // the chip's menu (again, until it shows Walk: a call prompt can take the first click)
    for (let i = 0; i < 5; i++) {
      await js(`(() => { (${DEEP})(".body-chip button, .body-chip")[0]?.click(); })()`);
      await sleep(600);
      if (await js(`(${DEEP})("button, [role=menuitem], li").some((x) => /^\\s*walk\\s*$/i.test(x.innerText ?? ""))`)) break;
    }
    const menu = await js(`(${DEEP})("button, [role=menuitem], li, option").map((x) => (x.innerText ?? "").trim()).filter((t) => t && t.length < 30).join("|")`);
    await js(`(() => { const w = (${DEEP})("button, [role=menuitem], li").find((x) => /^\\s*walk\\s*$/i.test(x.innerText ?? "")); w?.click(); return !!w; })()`);
    // until the body is walk (a first bake can take a while), 60 s at most
    const asked = Date.now();
    let entered = await js(cam);
    while (entered.body !== "walk" && Date.now() - asked < 60000) (await sleep(500)), (entered = await js(cam));
    entered.ms = Date.now() - asked;
    const r = await js(`(() => { const c = globalThis.__sceneDebug.viewport.canvas.getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; })()`);
    await b.click(r[0], r[1]);
    await sleep(800);
    await b.keyDown("w");
    await sleep(1500);
    await b.keyUp("w");
    await sleep(800);
    const walked = await js(cam);
    const pointer = await js(`JSON.stringify(globalThis.__sceneDebug.view?.atom?.get?.()?.pointer ?? null)`);
    const said = await js(`(() => { const t = document.body.innerText; return t.split("\\n").filter((l) => /walk|can.t be|columns|stand/i.test(l)).slice(0, 8); })()`);
    const bakes = await js(`JSON.stringify({ bakes: globalThis.__WALK_BAKES__, long: (globalThis.__LONG__ ?? []).filter((x) => x[1] > 200) })`);
    evaluated = JSON.stringify({ menu, before, entered, walked, pointer, said, ...JSON.parse(bakes) });
  }
  if (process.argv.includes("--profile")) {
    const { profile } = await within(60000, b.send("Profiler.stop"), "the profile");
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = new Map();
    profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    for (const [id, us] of dt) {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + us);
    }
    const byUrl = new Map();
    for (const [k, us] of self) { const u = k.split(" ")[1]?.split(":")[0] ?? ""; byUrl.set(u, (byUrl.get(u) ?? 0) + us); }
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, us]) => `${Math.round(us / 1000)} ms  ${k}`);
    writeFileSync(join(SHOTS, `${NAME}.profile.txt`), ["by function:", ...top(self), "", "by file:", ...top(byUrl)].join("\n"));
  }
  await within(30000, b.shot(join(SHOTS, `${NAME}.png`)), "the screenshot");
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
const errs = b.logs.filter((l) => /^(error|warning|warn|exception)/i.test(l));
const mine = errs.filter((l) => !NOISE.some((r) => r.test(l)) && (l.startsWith("exception") || isOurs(l)));
const noise = errs.filter((l) => !mine.includes(l));
check("no page errors from our packages", mine.length === 0, mine.slice(0, 12));
console.log(JSON.stringify({ url, name: NAME, seconds: secs(), state: st, ...(evaluated !== undefined ? { eval: evaluated } : {}), checks: list.checks, details: list.details, noise: noise.slice(0, 20) }, null, 2));
b.stop(list.failed ? 1 : 0);
