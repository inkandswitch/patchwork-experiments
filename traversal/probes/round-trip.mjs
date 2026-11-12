// The round trip, in headless Chrome with real keys and a real mouse: from
// the sloop's companionway down to E1M1, and from E1M1's exit switch back up.
//
//   (in scene/, sailing/, tabletop/, card-table/, keep/, joints/, arena/, doom/ and traversal/) pnpm build
//   node probes/round-trip.mjs [--shots <dir>] [--show] [--gpu]
//
// Mounts the BUILT plugins of every package involved in a small shell
// (round-trip-probe.html: one scene shown at a time; an open-document event
// is recorded and, once `follow` is on, opens that doc, as Patchwork does).
// The maker makes both scenes with the tools (Ship at anchor with Lost Cities
// in her cockpit; Freedoom's E1M1 slice pasted into an empty scene, set to
// start in play at the player 1 start). Then a visitor:
//  1. opens the ship: in play, nothing anywhere mentions the other scene;
//  2. comes aboard (Enter) and walks her deck (W, steering with the mouse)
//     to the forward end of the cockpit, past the card table;
//  3. her companionway, with nowhere to go, offers no verb; her hatch, a
//     slide, offers Open;
//  4. given somewhere to go (its `to`, as a publisher writes it), the
//     companionway offers [F] Go below; F sends one open-document request
//     for that doc, bubbling and composed out of the stage;
//  5. the shell opens E1M1: the visitor arrives in play, the camera at the
//     player 1 start's eye, the lobby offering Play; nothing mentions the ship;
//  6. ▶ Play: first person at the start, the camera where it was;
//  7. at the exit switch (the spawn moved beside it: the walk there is long,
//     and doom's tests show it can be walked), walking up to it (W), with
//     nowhere to go it offers no verb; given the ship, it offers [F] Exit,
//     and F sends open-document for the ship;
//  8. the shell opens the ship again: in play, nothing mentions E1M1;
//  9. no errors on the page.
// Prints a JSON report; exits non-zero if any check fails.
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const WAD = join(ROOT, "doom/src/test/e1m1.wad");
for (const p of ["scene", "sailing", "tabletop", "card-table", "keep", "joints", "arena", "doom", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
const arg = (name, d = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "round-trip")));

const b = await browser({ root: ROOT, port: 4942, cdp: 9942, page: "/traversal/probes/round-trip-probe.html", width: 1100, height: 640, show: process.argv.includes("--show"), gpu: process.argv.includes("--gpu"), timeout: 900_000, mounts: { "/wad": WAD } });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const J = JSON.stringify;
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
/** Wait for `expr` (with `p` the page's window.__p) to be true. */
const until = (expr, ms = 10_000, every = 60) => b.waitFor(`(() => { const p = window.__p; return (${expr}); })()`, ms, every);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `round-trip-${name}.png`)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const r3 = (p) => p && p.map((v) => +v.toFixed(3));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
/** What mentions E1M1 or Doom, and what mentions the ship. */
const DOOMISH = /doom|e1m1/i;
const SHIPPY = /sloop|ship|sail|aboard|lost cities|cockpit|anchor|companionway|go below/i;

/** Drag on the canvas by (mx, my) px: looking, where pointer lock is refused. */
async function drag(mx, my) {
  const c = await P("canvasRect()");
  const x = Math.round(c.x + c.w / 2), y = Math.round(c.y + c.h / 2);
  await b.mouse("mouseMoved", x, y);
  await b.mouse("mousePressed", x, y);
  const n = 8;
  for (let k = 1; k <= n; k++) await b.mouse("mouseMoved", x + (mx * k) / n, y + (my * k) / n, { buttons: 1 });
  await b.mouse("mouseReleased", x + mx, y + my);
  await sleep(80);
}
/** Turn to (yaw, pitch) as `read` reports them, by dragging; the drag's gain (and sign) learned as it goes. */
async function turn(read, yaw, pitch, { tol = 0.03 } = {}) {
  let gy = -0.0022, gp = -0.0022; // radians per pixel
  for (let i = 0; i < 16; i++) {
    const at = await read();
    const dy = wrap(yaw - at.yaw), dp = pitch - at.pitch;
    if (Math.abs(dy) < tol && Math.abs(dp) < tol) return true;
    const mx = Math.max(-500, Math.min(500, Math.round(dy / gy))), my = Math.max(-300, Math.min(300, Math.round(dp / gp)));
    await drag(mx, my);
    const now = await read();
    if (Math.abs(mx) > 8 && Math.abs(wrap(now.yaw - at.yaw)) > 0.005) gy = wrap(now.yaw - at.yaw) / mx;
    if (Math.abs(my) > 8 && Math.abs(now.pitch - at.pitch) > 0.005) gp = (now.pitch - at.pitch) / my;
  }
  return false;
}
/** Look the way a point is from where the body is, on the ship (her frame: bow −Z), and level. */
const aimYaw = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
const meLook = async () => { const m = await P("me()"); return { yaw: m.yaw, pitch: m.pitch }; };
/** Walk the body on the ship to (x, z) in her frame (W held, steering), within tol, or until ms pass. */
async function walkAboard(to, { ms = 20_000, tol = 0.2 } = {}) {
  const t0 = Date.now();
  let me = await P("me()");
  await turn(meLook, aimYaw(me.position, to), 0);
  await b.keyDown("w");
  try {
    while (Date.now() - t0 < ms) {
      await sleep(50);
      me = await P("me()");
      if (Math.hypot(to[0] - me.position[0], to[2] - me.position[2]) < tol) break;
      const want = aimYaw(me.position, to);
      if (Math.abs(wrap(want - me.yaw)) > 0.2) {
        await b.keyUp("w");
        await turn(meLook, want, 0);
        await b.keyDown("w");
      }
    }
  } finally {
    await b.keyUp("w");
  }
  await sleep(300);
  return P("me()");
}
/** Point at an object (near `local` in its frame) and wait for the prompt; returns what it offers. */
async function hoverPrompt(id, local, want = null, ms = 2500) {
  const at = await P(`aimAt(${J(id)}, ${J(local)})`);
  if (!at) return { at: null, prompt: await P("prompt()") };
  await b.move(Math.round(at.x) + 1, Math.round(at.y));
  await b.move(Math.round(at.x), Math.round(at.y));
  if (want) await until(`p.prompt().some((t) => ${want}.test(t))`, ms);
  else await sleep(ms);
  return { at, hovered: await P("hovered()"), prompt: await P("prompt()") };
}
const textOf = async () => (await P("text()")).replace(/\s+/g, " ");

let ids = {};
try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await P("errors").catch(() => null));
  const urls = await P("urls");

  // ─── the maker makes both scenes ──────────────────────────────────────────
  await P(`show("doom", "maker")`);
  await until(`p.running().includes("scene.add")`, 30_000);
  await P("pasteWad()");
  const doomBuilt = await until(`(() => { const l = p.loaded(); return l.total >= 14 && l.loaded === l.total; })()`, 180_000, 200);
  ids.exit = await P(`withTrait("traversal.exit")`);
  ids.spawn = await P(`withTrait("arena.spawn")`);
  ids.home = await P("startAtSpawn()");
  check("the maker lays E1M1 out (14 parts, an exit switch with nowhere to go) and starts it in play at the player 1 start", doomBuilt && !!ids.exit && !!ids.spawn && (await P("doc()")).objects[ids.exit].traits["traversal.exit"].to === undefined, { loaded: await P("loaded()"), exit: ids.exit, home: ids.home });
  await P(`show("aboard", "maker")`);
  await until(`p.templates().includes("ship-at-anchor")`, 30_000);
  Object.assign(ids, await P("makeAboard()", 120_000));
  const shipBuilt = await until(`(() => { const l = p.loaded(); return l.total > 60 && l.loaded === l.total; })()`, 180_000, 200);
  check("the maker sets the ship at anchor with Lost Cities in her cockpit; her companionway has nowhere to go", shipBuilt && !ids.error && !!ids.companionway && !!ids.hatch && (await P("doc()")).objects[ids.companionway].traits["traversal.exit"].to === undefined, { ids, loaded: await P("loaded()") });

  // ─── 1. a visitor opens the ship ──────────────────────────────────────────
  await P("forgetCameras()");
  await P(`show("aboard", "visitor")`);
  const inPlay = await until(`p.activity() === "play" && p.running().includes("sailing") && p.running().includes("traversal") && p.running().includes("joints")`, 30_000);
  await until(`(() => { const l = p.loaded(); return l.total > 60 && l.loaded === l.total; })()`, 120_000, 200);
  await sleep(1500);
  const shipText1 = await textOf();
  check("1. the visitor opens the ship in play (sailing, joints and traversal running); nothing shown mentions E1M1 or Doom", inPlay && !DOOMISH.test(shipText1) && !shipText1.includes(urls.doom) && !(await P("notices()")).some((n) => DOOMISH.test(n)), { running: await P("running()"), text: shipText1.slice(0, 600), notices: await P("notices()") });
  await shot("1-ship-arrive");

  // ─── 2. aboard, and to the companionway ───────────────────────────────────
  await P("focus()");
  await b.key("Enter");
  const boarded = await until(`p.me()?.playing === true && p.me()?.on != null`, 8000);
  const start = await P("me()");
  check("2a. Enter: the visitor comes aboard, walking her deck", boarded, start);
  // Her frame: bow −Z, starboard +X. You come aboard beside the wheel (z 4.25), whose turn sweeps a disc across the
  // well, so you get past it on the side deck; the companionway's washboards are at the cabin's aft end (z 1.83–1.97),
  // and the card table stands between the benches (z 2.47–3.23), leaving the well's forward end too narrow to stand in.
  // So: up onto the side deck on your side, forward past the wheel, down onto the bench, and forward along it beside
  // the table to its forward end.
  const sx = Math.sign(start.position[0]) || 1;
  const route = [[0.6, 0, 4.75], [1.25, 0, 4.6], [1.25, 0, 3.9], [0.6, 0, 3.5], [0.6, 0, 2.25]].map(([x, y, z]) => [sx * x, y, z]);
  const walked = [];
  for (const p of route) walked.push(r3((await walkAboard(p)).position));
  const there = await P("me()");
  details.walk = { start: r3(start.position), route, walked, there: { position: r3(there.position), on: there.on, yaw: there.yaw } };
  check("2b. walking (W, steering by dragging), the visitor gets past the wheel and the card table to the bench's forward end, beside the companionway", Math.hypot(there.position[0] - route.at(-1)[0], there.position[2] - route.at(-1)[2]) < 0.3 && there.on === ids.hull, details.walk);
  // look down at a point (her frame) from the eye, 1.6 m over the feet
  const lookAt = async (p) => {
    const me = await P("me()");
    const e = [me.position[0], me.position[1] + 1.6, me.position[2]];
    return turn(meLook, aimYaw(e, p), Math.atan2(p[1] - e[1], Math.hypot(p[0] - e[0], p[2] - e[2])));
  };

  // ─── 3. its hatch's slide: Open; nowhere to go: no verb ───────────────────
  await lookAt([0, 1.8, 1.6]);
  await shot("3-the-hatch");
  const hatch = await hoverPrompt(ids.hatch, [0, 0.1, -0.2], "/Open/");
  check("3a. her hatch (joints' slide) offers [F] Open within reach", hatch.prompt.some((t) => /F/.test(t) && /Open/.test(t)), hatch);
  // the washboards' upper part, on the cabin's aft face (z 1.97): from the bench, the nearest of them (about 1.3 m)
  await lookAt([0, 1.5, 1.97]);
  await shot("3-the-companionway");
  const none = await hoverPrompt(ids.companionway, [0, 0.8, 0.016]);
  check("3b. looking at her companionway with nowhere to go, within reach, the prompt offers no verb for it", !!none.at && none.at.distance <= 2 && none.hovered === ids.companionway && !none.prompt.some((t) => /Go below|Go\b/.test(t)), none);

  // ─── 4. somewhere to go: Go below ─────────────────────────────────────────
  await P(`lead("aboard", ${J(urls.doom)})`);
  const go = await hoverPrompt(ids.companionway, [0, 0.8, 0.016], "/Go below/");
  check("4a. given somewhere to go, her companionway offers [F] Go below, within reach", go.hovered === ids.companionway && go.prompt.some((t) => /F/.test(t) && /Go below/.test(t)) && go.at.distance <= 2, go);
  const shipText2 = await textOf();
  check("4b. the prompt is the plain verb: nothing shown names where it goes", !DOOMISH.test(shipText2) && !shipText2.includes(urls.doom), shipText2.slice(0, 600));
  await shot("4-go-below");
  await P("shell.follow = true");
  const before = (await P("opened")).length;
  // (the prompt still offering it as the key goes down: she rolls at anchor, and the look with her)
  await until(`p.prompt().some((t) => /Go below/.test(t))`, 3000);
  await b.key("f");
  await until(`p.opened.length > ${before}`, 3000);
  const sent = (await P("opened")).slice(before);
  check("4c. F sends exactly one open-document request, for E1M1, bubbling and composed out of the ship's stage", sent.length === 1 && sent[0].url === urls.doom && sent[0].from === urls.aboard && sent[0].bubbles && sent[0].composed && J(sent[0].detail) === J({ url: urls.doom }), sent);

  // ─── 5. arriving in E1M1 ──────────────────────────────────────────────────
  const play = await (async () => {
    if (!(await until(`p.showing() === "doom" && p.activity() === "play" && p.running().includes("arena")`, 20_000))) return null;
    await until(`(() => { const l = p.loaded(); return l.total >= 14 && l.loaded === l.total; })()`, 120_000, 200);
    await sleep(1200);
    return P(`rect(".arena-play")`);
  })();
  const arrived = play && await until(`p.showing() === "doom" && p.activity() === "play" && p.running().includes("arena")`, 20_000);
  const cam = await P("cam()");
  const doomText1 = await textOf();
  details.arrival = { cam: { position: r3(cam.position), target: r3(cam.target) }, home: ids.home, lobby: play, text: doomText1.slice(0, 400), notices: await P("notices()"), available: await P("available()") };
  check("5a. the shell opens E1M1: the visitor arrives in play, the camera at the player 1 start's eye looking its way, the lobby offering Play", arrived && Math.hypot(...cam.position.map((v, i) => v - ids.home.position[i])) < 0.05 && Math.hypot(...cam.target.map((v, i) => v - ids.home.target[i])) < 0.5 && /Play/.test(play?.text ?? ""), details.arrival);
  check("5b. nothing shown mentions the ship, and there are no notices", !SHIPPY.test(doomText1) && !doomText1.includes(urls.aboard) && (await P("notices()")).length === 0, details.arrival);
  check("5c. no target count in a level without targets", !/target|standing/i.test(doomText1), doomText1.slice(0, 300));
  await shot("5-doom-arrive");

  if (!play) throw new Error("not in E1M1's lobby");
  // ─── 6. Play ──────────────────────────────────────────────────────────────
  await b.click(Math.round(play.x), Math.round(play.y));
  await sleep(1500);
  const eye = (await P("cam()")).position;
  check("6. ▶ Play: first person at the start, where the view already was", Math.hypot(eye[0] - ids.home.position[0], eye[2] - ids.home.position[2]) < 0.3 && Math.abs(eye[1] - ids.home.position[1]) < 0.3 && !(await P(`rect(".arena-play")`)), { eye: r3(eye), home: ids.home.position });
  await shot("6-doom-play");

  // ─── 7. the exit switch ───────────────────────────────────────────────────
  // its frame: the middle of its line on its floor; the wall faces +X (Doom's east). Stand 1.6 m off it, facing it.
  const sw = await P(`worldOf(${J(ids.exit)})`);
  const standAt = [sw[12] + 1.6, sw[13] + 0.05, sw[14]];
  await b.key("Escape");
  await sleep(400);
  await P(`moveSpawn(${J(standAt)}, ${Math.PI / 2})`);
  await sleep(300);
  const play2 = await P(`rect(".arena-play")`);
  if (play2) await b.click(Math.round(play2.x), Math.round(play2.y));
  await sleep(1200);
  const e0 = (await P("cam()")).position;
  await turn(() => P("yawPitch()"), Math.PI / 2, -0.1);
  await b.keyDown("w");
  await sleep(250);
  await b.keyUp("w");
  await sleep(500);
  const e1 = (await P("cam()")).position;
  details.exitWalk = { switch: r3([sw[12], sw[13], sw[14]]), from: r3(e0), to: r3(e1) };
  check("7a. at the exit switch's room, the visitor walks up to it (W)", e1[0] < e0[0] - 0.3 && e1[0] - sw[12] > 0.2 && e1[0] - sw[12] < 1.6, details.exitWalk);
  const noExit = await hoverPrompt(ids.exit, [0, 1.5, 0]);
  check("7b. with nowhere to go, the exit switch offers no verb", !!noExit.at && noExit.hovered === ids.exit && !noExit.prompt.some((t) => /Exit/.test(t)), noExit);
  await P(`lead("doom", ${J(urls.aboard)})`);
  const exit = await hoverPrompt(ids.exit, [0, 1.5, 0], "/Exit/");
  await until(`p.prompt().some((t) => /Exit/.test(t))`, 3000);
  check("7c. given the ship, it offers [F] Exit within reach", exit.hovered === ids.exit && exit.prompt.some((t) => /F/.test(t) && /Exit/.test(t)) && exit.at.distance <= 2, exit);
  const doomText2 = await textOf();
  check("7d. nothing shown names where it goes", !SHIPPY.test(doomText2) && !doomText2.includes(urls.aboard), doomText2.slice(0, 400));
  await shot("7-exit");
  const before2 = (await P("opened")).length;
  await b.key("f");
  await until(`p.opened.length > ${before2}`, 3000);
  const sent2 = (await P("opened")).slice(before2);
  check("7e. F sends exactly one open-document request, for the ship, out of E1M1's stage", sent2.length === 1 && sent2[0].url === urls.aboard && sent2[0].from === urls.doom && sent2[0].bubbles && sent2[0].composed, sent2);

  // ─── 8. back aboard ───────────────────────────────────────────────────────
  const back = await until(`p.showing() === "aboard" && p.activity() === "play" && p.running().includes("sailing")`, 20_000);
  await until(`(() => { const l = p.loaded(); return l.total > 60 && l.loaded === l.total; })()`, 120_000, 200);
  await sleep(1500);
  const shipText3 = await textOf();
  check("8. the shell opens the ship again: in play; nothing shown mentions E1M1 or Doom", back && !DOOMISH.test(shipText3) && !shipText3.includes(urls.doom), shipText3.slice(0, 600));
  await shot("8-ship-again");

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("9. no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(J(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
