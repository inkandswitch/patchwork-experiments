// The crew by touch: one view of probes/sailing-probe.html (the BUILT scene,
// sailing and water) under Chrome's touch emulation, in headless Chrome.
//
//   (in scene/, water/ and sailing/) pnpm build
//   node probes/touch-run.mjs [--port 4766] [--cdp 9766] [--seed 1] [--show] [--shots <dir>]
//
// Every press is a finger (cdp.mjs's b.touch). It checks:
//  1. "Ship at sea" by a tap, then Come aboard on the stage's bar of tools
//     (scene/TOOLS.md Decisions 10) by a tap:
//     A walks her deck ("aboard", a lock body) and the pointer lock is never
//     asked for (scene/TOOLS.md Decisions 11);
//  2. the stage's touch pad shows aboard's declared keys by what they do:
//     Forward, Left, Back, Right in the pad's places, Run and Jump under
//     "Walk" (walk's own declared keys; the pad is scene's);
//  3. Forward held 0.6 s walks her (the walker's place on her moves);
//  4. at the wheel, looking at it (no pointer under touch: the look is the
//     eye's, scene/TOOLS.md Decisions 14), the use prompt offers the helm in
//     the middle of the view, and a tap on its button stands A at it;
//     the pad then shows Steer to port / starboard in the left and right
//     places and Haul in, Ease out, Halyard, Back jib / let fly, Leave under
//     "Helm";
//  5. Steer to starboard held a second turns the wheel to starboard (its
//     angle up), Steer to port back the other way;
//  6. Leave leaves the helm: walking again, the claim gone.
//  7. at the windlass, the prompt's buttons are its keys (scene/TOOLS.md
//     Decisions 15): a tap on Drop anchor (F) lets it go; then Raise anchor
//     (hold F) brings the chain in only while a finger holds its button, and
//     stops when it lifts.
// Prints a JSON checklist; exits non-zero if any check fails.
//
// Simulated time: the page's manual clock (window.__time), so the world moves
// only as this steps frames. The page holds the world paused (?held) until it
// has loaded.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["sailing/dist/index.js", "water/dist/index.js", "weather/dist/index.js", "scene/dist/index.js", "walk/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "sailing-touch-shots"));
const SEED = Number(arg("--seed") ?? 1);
const PORT = Number(arg("--port") ?? 4766);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/sailing-probe.html?held&seed=${SEED}`, width: 820, height: 530, show: process.argv.includes("--show"), timeout: 600_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const FRAME = 1000 / 60;
const until = (expr, ms = 10_000) => b.soon(expr, { frames: Math.ceil(ms / FRAME) });
const loads = (expr, ms = 10_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const EXPECTED = /KHR_parallel_shader_compile|pointer lock refused|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `touch-${name}.png`), await P("viewRect('a')")));
const { touch } = b;
const n3 = (v) => +(+v).toFixed(3);

// page-side readers: the view's state, the pad (scene's touch part) and a control's centre, by what it shows
const VIEW = `(() => { const v = window.__p.A.local.get(); return { body: v.body?.id ?? null, label: v.body?.label ?? null, pointer: v.pointer }; })()`;
const PAD = `(() => {
  const h = window.__p.hostA, pad = h.querySelector(".touch-pad"), buttons = h.querySelector(".touch-buttons");
  if (!pad || (pad.hidden && buttons.hidden)) return null;
  return {
    pad: pad.hidden ? [] : [...pad.children].map((e) => e.dataset.slot + "=" + e.title),
    buttons: buttons.hidden ? [] : [...buttons.children].map((g) => [g.querySelector(".touch-layer-name").textContent, ...[...g.querySelectorAll(".touch-key")].map((e) => e.textContent)]),
  };
})()`;
const centre = (sel) => `(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`;
const control = (label) => js(centre(`[...window.__p.hostA.querySelectorAll(".touch-key")].find((e) => (e.title || e.textContent) === ${JSON.stringify(label)})`));
/** Hold a pad control with one finger for ms of the page's clock. */
async function hold(label, ms) {
  const at = await control(label);
  if (!at) return false;
  await touch.fingers([[1, ...at]]);
  await b.rest(ms);
  await touch.fingers([]);
  await b.rest(100);
  return true;
}

try {
  check("page set up", await loads("window.__ready === true", 20_000), await P("errors"));
  await touch.emulate(true);
  // requestPointerLock asked: counted, whoever asks
  await js(`(() => { window.__asks = 0; const r = HTMLCanvasElement.prototype.requestPointerLock; HTMLCanvasElement.prototype.requestPointerLock = function (...a) { window.__asks++; return r.apply(this, a); }; })()`);

  // ─── 1. aboard by taps ───────────────────────────────────────────────────
  const startBtn = `.add-template[data-template="ship-at-sea"]`;
  await loads(`!!window.__p.hostA.querySelector('${startBtn}')`, 20_000);
  await b.rest(400);
  const sb = await P(`rect('${startBtn}', 'a')`);
  await touch.tap([sb.x, sb.y]);
  await loads("window.__p.objects().length >= 10", 20_000);
  check("every part loads", await loads("(() => { const a = window.__p.loaded('a'); return a.total >= 10 && a.loaded === a.total; })()", 40_000), await P("loaded('a')"));
  await loads("!!window.__p.ctx('a')", 10_000);
  await js(`window.__p.change((d) => { Object.values(d.objects).find((o) => o?.traits?.["sailing.sea"]).traits["sailing.sea"].seed = ${SEED}; d.traits.weather.seed = ${SEED}; })`);
  await P("resume()");
  const ids = await js(`(() => { const by = window.__p.byName; return { hull: by("Sloop"), wheel: by("Wheel"), mainsheet: by("Mainsheet"), windlass: by("Windlass") }; })()`);
  // where a part is on her (the hull's frame): up its chain of parents
  const local = (id) => js(`(() => { const d = window.__p.doc(), hull = ${JSON.stringify(ids.hull)}; let p = [0, 0, 0]; for (let at = ${JSON.stringify(id)}; at && at !== hull; at = d.objects[at].parent) p = p.map((x, i) => x + d.objects[at].transform.position[i]); return p; })()`);
  await b.rest(1000);
  const come = await P(`rect('.toolbar .world [data-command="aboard"]', 'a')`);
  await touch.tap([come.x, come.y]);
  await until("window.__p.me('a')?.playing === true", 3000);
  await b.rest(300);
  let v = await js(VIEW);
  check("1. a tap on the bar's Come aboard: walking her deck, and the pointer lock is never asked for", v.body === "walk" && v.pointer.touch === true && v.pointer.locked === false && !(await js("document.pointerLockElement != null")) && (await js("window.__asks")) === 0, { v, asks: await js("window.__asks") });

  // ─── 2. the pad ──────────────────────────────────────────────────────────
  const padAboard = await js(PAD);
  check("2. the pad shows walk's own declared keys by what they do: Forward, Left, Back, Right in their places; Run and Jump under Walk", JSON.stringify(padAboard) === JSON.stringify({ pad: ["up=Forward", "left=Left", "down=Back", "right=Right"], buttons: [["Walk", "Run", "Jump"]] }), padAboard);
  await shot("1-aboard");

  // ─── 3. Forward walks her ────────────────────────────────────────────────
  // (from the mainsheet's stand spot, facing up the cockpit: the spawn faces the wheel)
  const ms = await local(ids.mainsheet);
  await P(`place('a', '${ids.hull}', [0, ${ms[1]}, ${ms[2] + 0.35}], 0, 0)`);
  await b.rest(300);
  const p0 = (await P("me('a')")).position;
  const held = await hold("Forward", 600);
  const p1 = (await P("me('a')")).position;
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  check("3. Forward held 0.6 s walks her: her place on the deck moves", held && moved > 0.3, { p0: p0.map(n3), p1: p1.map(n3), moved: n3(moved) });

  // ─── 4. the helm, by the use prompt's button ─────────────────────────────
  // (no pointer under touch: the look is the eye's, at the middle of the view, as under lock; scene/TOOLS.md Decisions 14)
  const wh = await local(ids.wheel);
  await P(`place('a', '${ids.hull}', [${wh[0]}, ${wh[1] - 0.6}, ${wh[2] + 0.75}], 0, -0.45)`);
  const offered = await until(`window.__p.verbs('a').some((v) => v.command === "helm" && !v.disabled)`, 3000);
  const verbs = await P("verbs('a')");
  const promptAt = await js(`(() => { const e = window.__p.hostA.querySelector(".use-prompt"); return { x: e.style.getPropertyValue("--use-x"), y: e.style.getPropertyValue("--use-y") }; })()`);
  const helmBtn = await js(centre(`window.__p.hostA.querySelector('.use-prompt:not([hidden]) .use-verb[data-command="helm"]')`));
  if (helmBtn) await touch.tap(helmBtn);
  await b.rest(300);
  const atHelm = await P("me('a')");
  v = await js(VIEW);
  check("4a. at the wheel, the prompt offers the helm in the middle of the view; a tap on it stands A at it, unlocked", offered && promptAt?.x === "50%" && atHelm.station === ids.wheel && v.body === "station" && v.label === "Helm" && v.pointer.locked === false && (await js("window.__asks")) === 0, { offered, verbs, promptAt, helmBtn, station: atHelm.station, v });
  const padHelm = await js(PAD);
  check("4b. the pad shows the helm's keys by what they do: Steer to port / starboard in the left and right places, then Haul in, Ease out, Halyard, Back jib / let fly, Leave under Helm", JSON.stringify(padHelm) === JSON.stringify({ pad: ["left=Steer to port", "right=Steer to starboard"], buttons: [["Helm", "Haul in", "Ease out", "Halyard", "Back jib / let fly", "Leave"]] }), padHelm);
  await shot("2-helm");

  // ─── 5. the wheel by the pad ─────────────────────────────────────────────
  const a0 = (await P(`value('${ids.wheel}', 'a')`)).angle ?? 0;
  await hold("Steer to starboard", 1000);
  const a1 = (await P(`value('${ids.wheel}', 'a')`)).angle;
  await hold("Steer to port", 1000);
  const a2 = (await P(`value('${ids.wheel}', 'a')`)).angle;
  check("5. Steer to starboard held a second turns the wheel to starboard, Steer to port back to port", a1 > a0 + 0.2 && a2 < a1 - 0.2, { a0: n3(a0), a1: n3(a1), a2: n3(a2) });

  // ─── 6. Leave ────────────────────────────────────────────────────────────
  const leaveAt = await control("Leave");
  if (leaveAt) await touch.tap(leaveAt);
  await b.rest(300);
  v = await js(VIEW);
  const claim = (await P("doc()")).objects[ids.wheel].claims?.station ?? null;
  check("6. Leave leaves the helm: walking again, the helm's claim gone, the pad aboard's again", (await P("me('a')")).station == null && v.body === "walk" && !claim && JSON.stringify(await js(PAD)) === JSON.stringify(padAboard), { v, claim, pad: await js(PAD) });

  // ─── 7. the windlass, by the prompt's buttons ────────────────────────────
  // (standing aft of it, facing forward: the eye's look tipped down until it rests on the windlass)
  const wl = await local(ids.windlass);
  const verbAt = (command) => js(centre(`window.__p.hostA.querySelector('.use-prompt:not([hidden]) .use-verb[data-command="${command}"]')`));
  let faced = null;
  for (const pitch of [-0.75, -0.9, -0.6, -1.05, -0.5]) {
    await P(`place('a', '${ids.hull}', [${wl[0]}, ${wl[1]}, ${wl[2] + 0.9}], 0, ${pitch})`);
    if (await until(`window.__p.verbs('a').some((v) => (v.command === "drop" || v.command === "weigh") && !v.disabled)`, 1500)) {
      faced = pitch;
      break;
    }
  }
  const anchor = () => P(`value('${ids.windlass}', 'a')`);
  const dropAt = faced != null ? await verbAt("drop") : null;
  if (dropAt) await touch.tap(dropAt);
  await b.rest(300);
  const dropped = await anchor();
  const weighAt = await until(`window.__p.verbs('a').some((v) => v.command === "weigh" && !v.disabled)`, 2000) ? await verbAt("weigh") : null;
  const r0 = Number((await anchor()).rode);
  let r1 = null, r2 = null, heldMark = null;
  if (weighAt) {
    await touch.fingers([[1, ...weighAt]]);
    await b.rest(1000);
    r1 = Number((await anchor()).rode);
    heldMark = (await P("verbs('a')")).find((x) => x.command === "weigh")?.held ?? null;
    await touch.fingers([]);
    await b.rest(100);
    r2 = Number((await anchor()).rode);
    await b.rest(1000);
  }
  const r3 = Number((await anchor()).rode);
  await shot("3-windlass");
  check(
    "7. at the windlass: a tap on Drop anchor lets it go; a finger held on Raise anchor brings the chain in, and lifting it stops",
    faced != null && dropped.down === true && r0 > 0 && r1 < r0 - 0.3 && heldMark === true && Math.abs(r3 - r2) < 1e-6 && (await js("window.__asks")) === 0,
    { faced, dropped, r0: n3(r0), r1: r1 == null ? null : n3(r1), r2: r2 == null ? null : n3(r2), r3: n3(r3), heldMark, verbs: await P("verbs('a')") },
  );

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors", errors.length === 0, errors);
} catch (e) {
  check("ran to the end", false, String(e?.stack ?? e));
} finally {
  await b.stop();
}
console.log(JSON.stringify(report, null, 2));
process.exit(list.failed ? 1 : 0);
