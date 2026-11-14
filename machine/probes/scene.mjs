// A machine in a scene, in headless Chrome, two people on real Automerge
// docs, with real keys.
//
//   (in scene/ and machine/) pnpm build
//   [CHROME_LOCK=<dir>] node probes/scene.mjs [--wad <freedoom1.wad>] [--shots <dir>] [--port 4930] [--cdp 9930]
//   (CHROME_LOCK: a directory made while Chrome runs, waited for if it exists)
//
// Mounts the BUILT scene tool with the BUILT machine package (probes/
// scene-probe.html). Ana pastes a Doom machine doc into an empty scene; the
// extension lays out its cabinet and the first view able to makes its
// session on the scene's world time. Then (the success criteria):
//  1. both views open it, stopped at tick 0, and the world's clock is not
//     computed (a machine nobody plays keeps no world going);
//  2. Ana plays (a click selects it, P: a port and the pad in hand), walks
//     with the arrow keys: both views' machines advance, the picture changes
//     (Doom's view as she walks; Unarmed's screens as Start is pressed), and
//     the world is computed while it runs;
//  3. the pictures both views drew for one tick mostly agree; those that
//     don't were drawn from a prediction of the player's input, put right a
//     few ticks later (counted, and held to agreement at the stop);
//  4. Escape gives the port back: the machine stops, both views at the same
//     tick with the same picture on the screen, and the world stops being
//     computed;
//  5. the same for the Super NES (Unarmed), played by Ben;
//  6. the picture sits on the cabinet's screen as the stage draws it (the
//     quad's corners against the bezel's own vertices), and still does after
//     the cabinet is moved and turned, on both views;
//  7. no errors. Screenshots of each moment.
// What a view shows is read from the stage (the screen mesh, the texture it
// draws) and the view's own replica of the session, never from the
// extension, which has no surface for probes.
// Prints a JSON report; exits non-zero if any check fails.
//
// Simulated time: both views and the two peers' network run on the page's
// manual clock (window.__time); loading, identifying 28 MB of content and
// compiling engines are wall work (b.waitFor). One Chrome at a time across
// every agent on this machine: the lock below.
import { mkdirSync, rmdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const arg = (name, d = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const WAD = arg("--wad", join(PKG, "engines/doom/test/freedoom1.wad"));
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "machine-scene-shots")));
const PORT = Number(arg("--port", 4930)), CDP = Number(arg("--cdp", PORT + 5000));
const LOCK = process.env.CHROME_LOCK ?? null;

// ---- one Chrome at a time (a lock older than 30 minutes is stale)
if (LOCK) {
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60_000) rmdirSync(LOCK);
      } catch {}
      console.error("waiting for the Chrome lock…");
      await sleep(20_000);
    }
  }
  process.on("exit", () => {
    try {
      rmdirSync(LOCK);
    } catch {}
  });
}

const b = await browser({ root: ROOT, port: PORT, cdp: CDP, page: "/machine/probes/scene-probe.html", width: 1460, height: 580, timeout: 900_000, mounts: { "/wad": resolve(WAD) } });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `machine-${name}.png`)));

async function finish() {
  report.errors = await P("errors").catch(() => ["(page gone)"]);
  report.logs = b.logs.slice(-20);
  console.log(JSON.stringify(report, null, 2));
  b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
}

try {
  await b.waitFor("window.__ready", 120_000);
  const setupErrors = await P("errors");
  check("the page set up", setupErrors.length === 0, setupErrors);

  /** Both views' reading of machine `id`: [a, b]. */
  const both = async (id) => b.js(`[__p.shows("a")?.["${id}"] ?? null, __p.shows("b")?.["${id}"] ?? null]`);
  /** Frames, sampling what each view showed at each tick; → { pairs, mismatched, ticks }. */
  async function sample(id, frames, during = null) {
    const seen = { a: new Map(), b: new Map() };
    for (let f = 0; f < frames; f++) {
      if (during) await during(f);
      await b.step(1);
      const [sa, sb] = await both(id);
      if (sa?.shown) seen.a.set(sa.shown.tick, sa.shown);
      if (sb?.shown) seen.b.set(sb.shown.tick, sb.shown);
    }
    // A view draws its head, whose remote inputs may still be predictions
    // (GGPO); a late input puts the state right a few ticks on. So the
    // pictures two views drew for one tick mostly agree, and the ones that
    // don't were predictions: counted here, held to agreement at the stop.
    let pairs = 0, mismatched = 0;
    for (const [t, x] of seen.a) {
      const y = seen.b.get(t);
      if (y) (pairs++, x.hash !== y.hash && mismatched++);
    }
    const pictures = new Set([...seen.a.values()].map((x) => x.hash)).size; // how many different pictures a drew: the game moved
    return { pairs, mismatched, pictures, ticks: [Math.max(...seen.a.keys()), Math.max(...seen.b.keys())] };
  }

  async function machine(kind, { who, at, keys, frames }) {
    const url = await P(`machines.${kind}`);
    await P(`paste("a", ${JSON.stringify(url)})`);
    const id = await b.waitFor(`__p.byUrl(${JSON.stringify(url)})`, 30_000);
    check(`${kind}: the pasted machine doc is laid out as a cabinet with the machine trait`, !!id && (await P(`doc().objects["${id}"].providerId`)) === "machine", { id });
    if (at) await P(`setTransform("${id}", ${JSON.stringify(at)})`);
    const session = await b.waitFor(`__p.trait("${id}")?.session`, 120_000);
    check(`${kind}: a view made its session and wrote it on the trait`, !!session);
    const ready = await b.waitFor(`(() => { const s = [__p.shows("a")?.["${id}"], __p.shows("b")?.["${id}"]]; return s.every((x) => x && x.tick !== null && x.shown) })()`, 180_000);
    check(`${kind}: both views opened it and show a picture`, !!ready, await both(id));
    const c = at ?? [0, 0, 0];
    for (const w of ["a", "b"]) await P(`setCamera("${w}", { position: [${c[0]}, 1.35, ${c[2] + 1.6}], target: [${c[0]}, 1.3, ${c[2]}] })`);
    await b.step(90);
    const stopped = await both(id);
    const sess0 = await P(`session(${JSON.stringify(session)})`);
    check(`${kind}: stopped at tick 0 on both views while nobody plays`, stopped.every((s) => s.tick === 0 && !s.running), { stopped, clock: sess0.clock });
    check(`${kind}: a machine nobody plays keeps no world going (neither view computes the scene's clock)`, !(await P(`clock("a").computing`)) && !(await P(`clock("b").computing`)), [await P(`clock("a")`), await P(`clock("b")`)]);
    check(`${kind}: the screen says it's stopped`, (await P(`labels("${who}")`)).some((t) => /nobody plays/.test(t)), await P(`labels("${who}")`));
    await shot(`${kind}-stopped`);

    // the picture on the cabinet's screen, where it stands and moved and turned
    const BEZEL = 0.06, PROUD = 0.002, CORNER = Math.hypot(BEZEL, BEZEL, PROUD);
    const placed = (p) => !!p && p.faceCorners === 4 && p.corners.every((d) => Math.abs(d - CORNER) < 1e-4) && Math.abs(p.centres - PROUD) < 1e-4;
    const at0 = [await P(`placement("a", "${id}")`), await P(`placement("b", "${id}")`)];
    check(`${kind}: the picture sits on the cabinet's screen, on both views`, at0.every(placed), at0);
    await P(`setTransform("${id}", [${c[0] + 0.3}, 0, ${c[2] - 0.4}], [0, 0.7, 0])`);
    await b.step(60);
    const at1 = [await P(`placement("a", "${id}")`), await P(`placement("b", "${id}")`)];
    check(`${kind}: and after the cabinet is moved and turned`, at1.every(placed) && at1.every((p) => p.world?.[12] !== at0[0].world?.[12]), at1);
    await P(`setTransform("${id}", ${JSON.stringify(c)})`);
    await b.step(60);

    // play: select it and press P, the pad in hand
    // a click on the cabinet (in Edit, a plain click selects), then P
    const front = await P(`project("${who}", [${c[0]}, 1.0, ${c[2] + 0.36}])`);
    await b.click(front.x, front.y);
    report.numbers[`${kind}-selected`] = await P(`selected("${who}")`);
    await b.key("p");
    const tool = await P(`held("${who}")`);
    check(`${kind}: P takes a port and puts the pad in ${who}'s hand (the held tool)`, !!tool && /P1/.test(tool.name ?? ""), tool ?? { selected: await P(`selected("${who}")`), notices: await P(`notices("${who}")`), shows: await both(id) });
    const playing = await sample(id, frames, keys);
    const during = await both(id);
    report.numbers[`${kind}-playing`] = { ...playing, during };
    check(`${kind}: both views' machines advance while it's played, the keys moving the game`, during.every((s) => s.tick > 60 && s.running) && playing.pictures >= 3, { during, pictures: playing.pictures });
    check(`${kind}: one view computes the world while the machine runs`, (await P(`clock("a").computing`)) !== (await P(`clock("b").computing`)), [await P(`clock("a")`), await P(`clock("b")`)]);
    check(`${kind}: the two views drew the same picture for most ticks both drew (the rest predictions put right)`, playing.pairs > 100 && playing.mismatched / playing.pairs < 0.1, playing);
    await shot(`${kind}-playing`);

    // Escape: the port back; the last player gone, the machine stops for everyone
    await b.key("Escape");
    check(`${kind}: Escape puts the pad down`, !(await P(`held("${who}")`)));
    const still = await b.waitFor(`(() => { const s = [__p.shows("a")?.["${id}"], __p.shows("b")?.["${id}"]]; return s.every((x) => !x.running) && s[0].tick === s[1].tick && s[0].shown?.tick === s[0].tick && s[1].shown?.tick === s[1].tick })()`, 60_000);
    await b.step(120);
    const end = await both(id);
    report.numbers[`${kind}-stopped`] = end;
    check(`${kind}: stopped again, both views at the same tick`, !!still && end[0].tick === end[1].tick && end[0].tick > 60 && end.every((s) => !s.running), end);
    check(`${kind}: and the same picture on both screens`, !!end[0].shown?.hash && end[0].shown.hash === end[1].shown?.hash, end.map((s) => s.shown));
    await b.step(60);
    const held = await both(id);
    check(`${kind}: and the pictures hold there while the world runs on`, held.every((s, i) => s.shown?.hash === end[i].shown?.hash && s.tick === end[i].tick), held.map((s) => s.shown));
    const settled = await b.waitFor(`!__p.clock("a").computing && !__p.clock("b").computing`, 30_000);
    check(`${kind}: and the world is no longer computed for it`, !!settled, [await P(`clock("a")`), await P(`clock("b")`)]);
    const sess = await P(`session(${JSON.stringify(session)})`);
    report.numbers[`${kind}-session`] = sess;
    check(`${kind}: the session's stop is at the tick both views stopped at`, Math.floor(sess.clock.until * (kind === "doom" ? 35 : 21477270 / 357366) + 1e-6) === end[0].tick || Math.round(sess.clock.until * (kind === "doom" ? 35 : 21477270 / 357366)) === end[0].tick, { clock: sess.clock, tick: end[0].tick });
    await shot(`${kind}-stopped-again`);
    return id;
  }

  const ONLY = process.env.ONLY ?? null; // "doom" or "snes": one machine only (while iterating)
  // Doom: Ana walks forward through E1M1's start room
  if (ONLY !== "snes") await machine("doom", {
    who: "a",
    frames: 300,
    keys: async (f) => {
      if (f === 10) await b.keyDown("ArrowUp");
      if (f === 150) await b.keyUp("ArrowUp");
      if (f === 160) await b.keyDown("ArrowLeft");
      if (f === 220) await b.keyUp("ArrowLeft");
    },
  });
  // the Super NES beside it: Ben presses Start through Unarmed's title and lore
  if (ONLY !== "doom") await machine("snes", {
    who: process.env.WHO ?? "b",
    at: [1.6, 0, 0],
    frames: 420,
    keys: async (f) => {
      if (f % 120 === 100) await b.keyDown("Enter");
      if (f % 120 === 106) await b.keyUp("Enter");
    },
  });
  for (const w of ["a", "b"]) await P(`setCamera("${w}", { position: [0.8, 1.6, 3.6], target: [0.8, 1.1, 0] })`);
  await shot("both");
  const errors = await P("errors");
  // SwiftShader's own notice about a WebGL extension is the browser's, not ours
  const ours = errors.filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("no errors or warnings on the page", ours.length === 0, ours.slice(0, 8));
} catch (e) {
  check("the probe ran to the end", false, String(e?.stack ?? e));
}
await finish();
