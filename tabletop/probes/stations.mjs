// Seats as stations on the use prompt, by two people in headless Chrome.
//
//   (in scene/, tabletop/ and card-table/) pnpm build
//   node probes/stations.mjs [--shots <dir>] [--show]
//
// stations-probe.html: a Lost Cities table from the template, two views A
// (Ana) and B (Ben), and a stand-in for something that walks in first person
// (the `firstPerson` contribution). Real mouse and keys over CDP:
// - watching, not in first person: hovering a tray offers no seat verb (the
//   picker is the way there);
// - in first person, unseated, hovering Player 1's tray offers "Sit as
//   Player 1"; F sits A there (its claim, the notice), leaves first person
//   (the walker's leave) and the seat's view takes the camera;
// - seated, hovering its own tray offers "Stand up"; F: first person at the
//   seat (the walker's enter, with the seat's eye), the seat still A's;
//   there, "Back to your seat"; F sits A down again;
// - hovering a card in the tray is still Flip, never a seat verb;
// - B sits in Player 2 (picker): from first person A is offered "Ben is
//   sitting there", disabled, and F changes nothing;
// - B drops off the network: after the presence TTL, Player 2 is offered as
//   away; F once asks (a notice; the prompt says "F again"), F again takes it:
//   A sits in Player 2, Player 1 is free, B is told.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-stations"));
const PEER_TTL_MS = 15_000; // scene/src/stage/presence.js

const b = await browser({ root: ROOT, port: 4775, cdp: 9775, page: "/tabletop/probes/stations-probe.html", width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 300_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `stations-${name}.png`)));
const J = JSON.stringify;
const near = (p, q, tol = 0.02) => !!p && !!q && p.every((v, i) => Math.abs(v - q[i]) <= tol);

/** hover `id` in view `w` with the real mouse; the prompt's verbs once it shows `want` (a regex source), or what it shows after a wait */
async function hover(w, id, want) {
  let hov = false;
  // aim, move, and see that it's what the view hovers (a view still loading, or its camera
  // still settling, may put something else there): again, a few times
  for (let i = 0; i < 6 && !hov; i++) {
    await until(`aimAt(${J(id)}, ${J(w)})`, 30_000);
    const at = await P(`aimAt(${J(id)}, ${J(w)})`);
    if (!at) continue;
    await b.move(at.x + 1, at.y);
    await b.move(at.x, at.y);
    hov = await until(`hovered(${J(w)}) === ${J(id)}`, 2500);
  }
  // (generous: a deal in progress holds up the main thread for seconds at a time)
  const ok = want ? await until(`prompt(${J(w)}).some((t) => /${want}/.test(t))`, 10_000) : (await sleep(800), true);
  return { ok: hov && ok, hovered: await P(`hovered(${J(w)})`), prompt: await P(`prompt(${J(w)})`) };
}
async function press(w, key) {
  await P(`focus(${J(w)})`);
  await b.key(key);
  await sleep(250);
}
/** first person for view w, standing over a seat's place (above and behind its eye) */
async function walkTo(w, sid) {
  const c = await P(`seatCam(${J(sid)})`);
  const [ex, ey, ez] = c.position, [tx, , tz] = c.target;
  const d = Math.hypot(ex - tx, ez - tz) || 1;
  const eye = [ex + ((ex - tx) / d) * 0.3, ey + 0.4, ez + ((ez - tz) / d) * 0.3];
  await P(`walk(${J(w)}, ${J(eye)}, ${J(c.target)})`);
  await until(`immersive(${J(w)})`, 2000);
  await sleep(400);
  return eye;
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const viewers = await P("viewers");
  check("the start screen offers Lost Cities", await until("templates('a').includes('tabletop.lost-cities')", 15_000), await P("templates('a')"));
  await P("start('a', 'tabletop.lost-cities')");
  check("A is at the table, playing, watching", await until("activity('a') === 'play' && __p.picker('a') === 3", 30_000), await P("activity('a')"));
  await P("open('b')");
  check("B too", await until("activity('b') === 'play' && __p.picker('b') === 3", 30_000));
  const tray1 = await P("tray('p1')"), tray2 = await P("tray('p2')");
  report.seats = { p1: await P("seatCam('p1')"), p2: await P("seatCam('p2')") };

  // ── watching, not in first person: no seat verb ──
  const h0 = await hover("a", tray1, null);
  check("watching, not in first person: hovering Player 1's tray offers no seat verb", h0.hovered === tray1 && !h0.prompt.some((t) => /Sit|Stand|seat/.test(t)), h0);

  // ── first person, unseated: Sit as Player 1 ──
  await walkTo("a", "p1");
  check("A is in first person (the stand-in walker)", await P("immersive('a')"), await P("walker('a')"));
  const h1 = await hover("a", tray1, "Sit as Player 1");
  check("A hovers Player 1's tray: the prompt offers \"Sit as Player 1\"", h1.ok, h1);
  await shot("1-sit-offered");
  await press("a", "f");
  const sessionA = await P("session('a')");
  check("F: A sits in Player 1, holding its claim", await until(`seats().p1.player === ${J(viewers.a)} && __p.claim('p1')?.session === ${J(sessionA)}`, 3000), { seats: await P("seats()"), claim: await P("claim('p1')") });
  check("…told as the picker tells it", await until("notices('a').includes('You sat down as Player 1')", 2000), await P("notices('a')"));
  check("…B is told too", await until("notices('b').some((n) => /Ana sat down as Player 1/.test(n))", 2000), await P("notices('b')"));
  check("…the picker shows it", (await P("picked('a')")) === "p1", await P("picked('a')"));
  check("…first person is left (the walker's leave), and the seat's view takes the camera", await until("immersive('a') === false && !__p.walking('a')", 3000) && (await P("walker('a')")).left === 1, await P("walker('a')"));
  const seat1 = await P("seatCam('p1')");
  check("…the camera is the seat's view", await until(`camera('a') && ${J(seat1.position)}.every((v, i) => Math.abs(v - __p.camera('a').position[i]) < 0.02)`, 3000), { camera: await P("camera('a')"), seat: seat1 });
  await sleep(500);
  await shot("2-seated");
  mark("A sat from first person");

  // ── seated: Stand up ──
  const h2 = await hover("a", tray1, "Stand up");
  check("seated, A hovers its own tray: the prompt offers \"Stand up\"", h2.ok, h2);
  await shot("3-stand-offered");
  await press("a", "f");
  check("F: first person again (the walker's enter)", await until("immersive('a')", 3000) && (await P("walking('a')")), await P("walker('a')"));
  const entered = (await P("walker('a')")).entered.at(-1);
  check("…given the seat, its eye and what it looks at", entered?.seat === "p1" && near(entered.eye, seat1.position) && near(entered.target, seat1.target), { entered, seat1 });
  check("…and the seat is still A's", (await P("seats()")).p1.player === viewers.a && (await P("claim('p1')"))?.session === sessionA, await P("seats()"));
  check("…told so", await until("notices('a').some((n) => /You got up from Player 1; it's still yours/.test(n))", 2000), await P("notices('a')"));
  await sleep(400);
  await shot("4-stood-up");
  const h3 = await hover("a", tray1, "Back to your seat");
  check("in first person, A hovers its own tray: \"Back to your seat\"", h3.ok, h3);
  // a card in the tray is still the hand's
  const card = (await P("handCards('p1')"))[0];
  const hc = await hover("a", card, "Flip");
  check("hovering a card in the tray, the prompt is Flip, not a seat verb", hc.ok && !hc.prompt.some((t) => /Sit|Stand|seat/.test(t)), hc);
  await hover("a", tray1, "Back to your seat");
  await press("a", "f");
  check("F: back in Player 1, out of first person, in the seat's view", await until("immersive('a') === false", 3000) && (await P("seats()")).p1.player === viewers.a && (await until(`camera('a') && ${J(seat1.position)}.every((v, i) => Math.abs(v - __p.camera('a').position[i]) < 0.02)`, 3000)), { camera: await P("camera('a')"), seats: await P("seats()") });
  mark("A back in its seat");

  // ── a present player's seat is refused ──
  await P("pick('b', 'p2')");
  check("B sits in Player 2 (picker)", await until(`seats().p2.player === ${J(viewers.b)}`, 3000), await P("seats()"));
  const h3b = await hover("a", tray1, "Stand up");
  check("seated again, hovering its tray: \"Stand up\" (while the deck deals)", h3b.ok, h3b);
  await press("a", "f");
  check("A stands up again", await until("immersive('a')", 10_000), await P("walker('a')"));
  await walkTo("a", "p2");
  const h4 = await hover("a", tray2, "Ben is sitting there");
  check("at Player 2's tray: \"Ben is sitting there\", disabled", h4.ok && h4.prompt.some((t) => /Ben is sitting there \[disabled\]/.test(t)), h4);
  await shot("5-refused");
  const n0 = (await P("notices('a')")).length;
  await press("a", "f");
  await sleep(300);
  check("F there changes nothing: B keeps Player 2, A keeps Player 1", (await P("seats()")).p2.player === viewers.b && (await P("seats()")).p1.player === viewers.a && (await P("immersive('a')")), { seats: await P("seats()"), notices: (await P("notices('a')")).slice(n0) });

  // ── an away player's seat: F, then F again ──
  await P("cut('b')");
  mark("B cut off");
  const away = await until("options('a')[2][1] === 'Player 2 (away)'", PEER_TTL_MS + 8000);
  mark("A sees p2 away");
  check("after the presence TTL, A sees Player 2 as away", away, await P("options('a')"));
  const h5 = await hover("a", tray2, "Sit as Player 2 \\(Ben is away\\)");
  check("at Player 2's tray: \"Sit as Player 2 (Ben is away)\"", h5.ok, h5);
  await press("a", "f");
  check("F once asks: a notice, and nothing taken yet", (await until("notices('a').some((n) => /Ben is away\\. Press F again to take their seat/.test(n))", 2000)) && (await P("seats()")).p2.player === viewers.b, { notices: await P("notices('a')"), seats: await P("seats()") });
  check("…the prompt now says F again", await until("prompt('a').some((t) => /Take Player 2: F again/.test(t))", 2000), await P("prompt('a')"));
  check("…and no browser dialog", (await P("confirms()")).length === 0, await P("confirms()"));
  await shot("6-away-confirm");
  await press("a", "f");
  const sessionA2 = await P("session('a')");
  check("F again: A sits in Player 2, holding its claim", await until(`seats().p2.player === ${J(viewers.a)} && __p.claim('p2')?.session === ${J(sessionA2)}`, 3000), { seats: await P("seats()"), claim: await P("claim('p2')") });
  check("…Player 1 is let go", (await P("seats()")).p1.player == null, await P("seats()"));
  check("…A is out of first person, in Player 2's view", await until("immersive('a') === false", 3000) && (await until(`camera('a') && ${J((await P("seatCam('p2')")).position)}.every((v, i) => Math.abs(v - __p.camera('a').position[i]) < 0.02)`, 3000)), await P("camera('a')"));
  check("B (still hearing the doc) is told its seat was taken while it was away", await until("notices('b').some((n) => /Ana took Player 2 while you were away/.test(n))", 3000), await P("notices('b')"));
  await sleep(500);
  await shot("7-taken-over");

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
