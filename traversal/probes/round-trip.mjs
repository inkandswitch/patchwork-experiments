// The round trip, in headless Chrome with real keys and a real mouse: from a
// door in scene A to scene B, and from a door in B back to A.
//
//   (in scene/, walk/ and traversal/) pnpm build
//   node probes/round-trip.mjs [--shots <dir>] [--show] [--gpu]
//
// Mounts the BUILT plugins of those three packages in a small shell
// (round-trip-probe.html: one scene shown at a time; an open-document event
// is recorded and, once `follow` is on, opens that doc, as Patchwork does).
// Two plain scenes are made in the page: each a floor, a spawn point its
// view.start walks people in at, and a door carrying traversal.exit with
// nowhere to go. Then a visitor:
//  1. opens A: arriving walking at A's spawn point, facing its door; nothing
//     anywhere mentions B;
//  2. walks up to the door (W); with nowhere to go it offers no verb;
//  3. given somewhere to go (its `to`, as a publisher writes it), it offers
//     [F] Go through; F sends one open-document request for B, bubbling and
//     composed out of the stage;
//  4. the shell opens B: the visitor arrives walking at B's spawn point,
//     where B's view.start says; nothing mentions A;
//  5. the same from B's door back to A;
//  6. no errors on the page.
// Prints a JSON report; exits non-zero if any check fails.
//
// Simulated time: the stage runs on the page's manual clock (window.__time),
// so the body walks and a prompt answers only as this steps frames, as fast as
// the CPU allows. A wait on the world is a number of frames (until), never a
// sleep; the wall is waited on only for loading (loads).
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "walk", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
const arg = (name, d = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "round-trip")));

const b = await browser({ root: ROOT, port: 4942, cdp: 9942, page: "/traversal/probes/round-trip-probe.html", width: 1100, height: 640, show: process.argv.includes("--show"), gpu: process.argv.includes("--gpu"), timeout: 300_000 });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const J = JSON.stringify;
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const FRAME = 1000 / 60;
const onP = (expr) => `(() => { const p = window.__p; return (${expr}); })()`;
/** Frame by frame until `expr` (with `p` the page's window.__p) holds, for at most ms of the page's clock → its value, or false. */
const until = (expr, ms = 10_000) => b.soon(onP(expr), { frames: Math.ceil(ms / FRAME) });
/** Loading: the wall's, up to ms (the page's frames going at its pace). */
const loads = (expr, ms = 20_000, every = 60) => b.waitFor(onP(expr), ms, every);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `round-trip-${name}.png`)));
const r3 = (p) => p && p.map((v) => +v.toFixed(3));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
/** What mentions the other scene: its title, and its link. */
const MENTIONS = { a: /meadow/i, b: /cellar/i };
/** The scenes' places, as the page makes them (round-trip-probe.html): where each starts people, and where its door is. */
const PLACES = { a: { spawn: [0, 0, 4], door: [0, 0, -4], yaw: 0 }, b: { spawn: [4, 0, 0], door: [-4, 0, 0], yaw: Math.PI / 2 } };
const flat = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);

/** Point at the door and wait for the prompt (`want`, a regexp source, if given); returns what it offers. */
async function hoverPrompt(local, want = null, ms = 2500) {
  const id = await P(`withTrait("traversal.exit")`);
  const at = await P(`aimAt(${J(id)}, ${J(local)})`);
  if (!at) return { id, at: null, prompt: await P("prompt()") };
  await b.move(Math.round(at.x) + 1, Math.round(at.y));
  await b.move(Math.round(at.x), Math.round(at.y));
  if (want) await until(`p.prompt().some((t) => ${want}.test(t))`, ms);
  else await b.rest(ms);
  return { id, at, hovered: await P("hovered()"), prompt: await P("prompt()") };
}
/** Walk (W held) until the eye is within `near` m of `to` in plan, or ms of the page's clock pass. */
async function walkTo(to, { near = 1.7, ms = 20_000 } = {}) {
  await b.keyDown("w");
  try {
    for (let t = 0; t < ms; t += 50) {
      await b.advance(50);
      if (flat((await P("cam()")).position, to) < near) break;
    }
  } finally {
    await b.keyUp("w");
  }
  await b.rest(300);
  return (await P("cam()")).position;
}
const textOf = async () => (await P("text()")).replace(/\s+/g, " ");

/**
 * One scene's visit: arrive, walk to its door, nothing to go to, then given the
 * other scene, the verb and F. `from` and `to` are "a" and "b".
 */
async function visit(from, to, n, urls) {
  const there = PLACES[from];
  const arrived = await until(`p.showing() === ${J(from)} && p.bodyId() === "walk" && p.running().includes("traversal") && p.running().includes("walk")`, 20_000);
  await loads(`(() => { const l = p.loaded(); return l.total > 0 && l.loaded === l.total; })()`, 60_000, 100);
  await b.rest(800);
  const cam = (await P("cam()")).position;
  const look = await P("yawPitch()");
  const text1 = await textOf();
  details[`arrival-${from}`] = { cam: r3(cam), look, running: await P("running()"), body: await P("body()"), text: text1.slice(0, 300), notices: await P("notices()") };
  check(`${n}a. ${from === "a" ? "the visitor opens A" : "the shell opens B"}: arriving walking (the walk body; walk and traversal running) at its spawn point, the eye there, facing its door (its view.start)`, arrived && flat(cam, there.spawn) < 0.3 && cam[1] > 1 && Math.abs(Math.abs(look.yaw) - Math.abs(there.yaw)) < 0.3, details[`arrival-${from}`]);
  check(`${n}b. nothing mentions the other scene (the document, what is shown, the notices)`, !JSON.stringify(await P("doc()")).includes(urls[to]) && !MENTIONS[to].test(text1) && !text1.includes(urls[to]) && (await P("notices()")).length === 0, { text: text1.slice(0, 400), notices: await P("notices()") });
  await shot(`${n}-${from}-arrive`);

  // ─── walk up to the door: no verb ─────────────────────────────────────────
  await P("focus()");
  const id = await P(`withTrait("traversal.exit")`);
  const doorAt = (await P(`worldOf(${J(id)})`)).slice(12, 15);
  const e0 = (await P("cam()")).position;
  const e1 = await walkTo(doorAt);
  details[`walk-${from}`] = { door: r3(doorAt), from: r3(e0), to: r3(e1) };
  check(`${n}c. walking (W), the visitor gets up to the door`, flat(e1, doorAt) < 1.8 && flat(e1, doorAt) > 0.3 && flat(e0, doorAt) - flat(e1, doorAt) > 3, details[`walk-${from}`]);
  const none = await hoverPrompt([0, 1.1, 0]);
  check(`${n}d. looking at the door with nowhere to go, within reach, the prompt offers no verb for it`, !!none.at && none.at.distance <= 2 && none.hovered === id && none.prompt.length === 0 && (await P("doc()")).objects[id].traits["traversal.exit"].to === undefined, none);
  await shot(`${n}-${from}-no-verb`);

  // ─── somewhere to go: the verb, and F ─────────────────────────────────────
  await P(`lead(${J(from)}, ${J(urls[to])})`);
  const go = await hoverPrompt([0, 1.1, 0], "/Go through/");
  check(`${n}e. given somewhere to go, the door offers [F] Go through, within reach`, go.hovered === id && go.prompt.some((t) => /F/.test(t) && /Go through/.test(t)) && go.at.distance <= 2, go);
  const text2 = await textOf();
  check(`${n}f. the prompt is the plain verb: nothing shown names where it goes`, !MENTIONS[to].test(text2) && !text2.includes(urls[to]), text2.slice(0, 400));
  await shot(`${n}-${from}-go`);
  await P("shell.follow = true");
  const before = (await P("opened")).length;
  await b.key("f");
  await until(`p.opened.length > ${before}`, 3000);
  await b.rest(300);
  const sent = (await P("opened")).slice(before);
  check(`${n}g. F sends exactly one open-document request, for ${to.toUpperCase()}, bubbling and composed out of ${from.toUpperCase()}'s stage`, sent.length === 1 && sent[0].url === urls[to] && sent[0].from === urls[from] && sent[0].bubbles && sent[0].composed && J(sent[0].detail) === J({ url: urls[to] }), sent);
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await P("errors").catch(() => null));
  const urls = await P("urls");
  // ─── 1–3. A: arrive, walk to the door, go ─────────────────────────────────
  await P("forgetCameras()");
  await P(`show("a")`);
  await visit("a", "b", 1, urls);

  // ─── 4–5. B: arrive where B's start says, walk to its door, go back ────────
  await visit("b", "a", 2, urls);

  // ─── 6. back in A ─────────────────────────────────────────────────────────
  const back = await until(`p.showing() === "a" && p.bodyId() === "walk"`, 20_000);
  await loads(`(() => { const l = p.loaded(); return l.total > 0 && l.loaded === l.total; })()`, 60_000, 100);
  await b.rest(800);
  const cam = (await P("cam()")).position;
  const text3 = await textOf();
  check("3. the shell opens A again: arriving walking at A's spawn point; nothing shown mentions B", back && flat(cam, PLACES.a.spawn) < 0.3 && !MENTIONS.b.test(text3) && !text3.includes(urls.b), { cam: r3(cam), text: text3.slice(0, 300) });
  await shot("3-a-again");

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("4. no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
report.frames = await js("window.__time?.frames() ?? null").catch(() => null); // of the page's clock
console.log(J(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
