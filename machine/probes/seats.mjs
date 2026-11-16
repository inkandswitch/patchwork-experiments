// A machine in a scene with seats, sound and a game given in the scene, in
// headless Chrome: two people on real Automerge docs, with real keys.
//
//   (in scene/, seats/ and machine/) pnpm build
//   [CHROME_LOCK=<dir>] node probes/seats.mjs [--shots <dir>] [--port 4940] [--cdp 9940]
//
// Mounts the BUILT scene tool with the BUILT seats and machine packages
// (probes/scene-probe.html?seats). The success criteria:
//  1. content: Ana puts an empty cabinet in from the parts bin (the
//     machine's scene:part) and drops Unarmed's ROM on it, as a file from the
//     desktop: the cabinet's source becomes a machine doc of its own with
//     the game, a view makes its session, and a seat per port is laid on the
//     cabinet in the same change (the seats package's lay), not lasting, each
//     seat's view in the cabinet's frame, listed by port on the trait;
//  2. seats: Ana sits at P1 and Ben at P2 with the seats picker. Each is in
//     the seat body, looking at the screen from their seat, with that port's
//     pad in hand; the session gives port 0 to Ana and port 1 to Ben, and
//     the machine runs on both views;
//  3. input: Ana presses Start, Ben holds Right. Each port's seat document
//     holds its own player's buttons and not the other's (live input goes
//     as messages; this is where it lands), and the two views drew the same
//     picture for most ticks both drew;
//  4. sound: each view made one AudioContext; its panner stands at the
//     screen's centre as the stage draws it, its listener at that view's
//     seat eye, and it played the machine's audio (buffers with sound in
//     them, the stream resampled to the context's rate);
//  5. Escape puts Ana's pad down and her port stays hers (she still sits);
//     P picks it up again, wherever her pointer is;
//  6. standing up gives the port back: Ana watches (the picker) and her
//     seat in the session ends while Ben plays on, the seat free again
//     (never "away": nothing was written); Ben gets up and the
//     machine stops on both views at one tick, with one picture;
//  7. no errors.
// Prints a JSON report; exits non-zero if any check fails.
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
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "machine-seats-shots")));
const PORT = Number(arg("--port", 4940)), CDP = Number(arg("--cdp", PORT + 5000));
const LOCK = process.env.CHROME_LOCK ?? null;
const WAD = join(PKG, "engines/doom/test/freedoom1.wad"); // the page fetches it; this probe doesn't use it

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

const b = await browser({ root: ROOT, port: PORT, cdp: CDP, page: "/machine/probes/scene-probe.html?seats", width: 1460, height: 580, timeout: 900_000, mounts: { "/wad": resolve(WAD) } });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `seats-${name}.png`)));
const near = (p, q, eps = 1e-3) => !!p && !!q && p.length === q.length && p.every((v, i) => Math.abs(v - q[i]) < eps);

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
  const both = async (id) => b.js(`[__p.shows("a")?.["${id}"] ?? null, __p.shows("b")?.["${id}"] ?? null]`);

  // ---- 1. content: a part, then a ROM dropped on it
  for (const w of ["a", "b"]) await P(`setCamera("${w}", { position: [0, 1.4, 2.6], target: [0, 1.1, 0] })`);
  const id = await P(`part("a", { parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } })`);
  const machineUrl = id ? await P(`doc().objects["${id}"].sourceUrl`) : null;
  check("content: the parts bin's Machine puts in a cabinet with the machine trait", !!id && (await P(`doc().objects["${id}"].providerId`)) === "machine" && !!(await P(`trait("${id}")`)), { id });
  const empty = machineUrl ? await P(`machineDoc(${JSON.stringify(machineUrl)})`) : null;
  check("content: its machine doc is its own, with no game yet", !!empty && empty.kind === null, empty);
  await b.waitFor(`__p.loaded("a").loaded === __p.loaded("a").total`, 60_000);
  await b.step(30);
  check("content: the empty cabinet says how to give it a game", (await P(`labels("a")`)).some((t) => /No game yet/.test(t)), await P(`labels("a")`));
  const front = await P(`project("a", [0, 0.6, 0.36])`);
  await P(`dropFile("a", "unarmed.sfc", ${front.x}, ${front.y})`);
  const given = await b.waitFor(`(async () => { const u = __p.doc().objects["${id}"].sourceUrl; if (u === ${JSON.stringify(machineUrl)}) return null; const d = await __p.machineDoc(u); return d.kind ? d : null })()`, 30_000);
  check("content: a ROM dropped on it is its game, a machine doc of its own the cabinet now points at (kind, content, title)", given?.kind === "snes" && !!given.content && /unarmed/.test(given.title ?? ""), given);
  const emptyAfter = await P(`machineDoc(${JSON.stringify(machineUrl)})`);
  check("content: the empty machine doc is left as it was", !!emptyAfter && emptyAfter.kind === null, emptyAfter);
  const session = await b.waitFor(`__p.trait("${id}")?.session`, 120_000);
  check("content: a view made its session", !!session);
  const seats = await P(`doc().objects["${id}"].traits.seats ?? null`);
  const sids = [1, 2, 3, 4].map((n) => `p${n}`);
  check(
    "content: a seat per port laid on the cabinet with it, not lasting, each named for the game, its view in the cabinet's frame looking at the screen",
    !!seats && sids.every((s) => seats[s]?.camera?.in === id && /unarmed · P\d/.test(seats[s].name) && seats[s].player === null && seats[s].lasting === false) && Object.keys(seats).length === 4,
    seats,
  );
  const listed = await P(`trait("${id}")`);
  check("content: the machine's trait lists its seats by port, and says which source its session is for", JSON.stringify(listed?.seats) === JSON.stringify(sids) && listed?.source === (await P(`doc().objects["${id}"].sourceUrl`)), listed);
  check("content: the scene's own seats are untouched (the cabinet's are its own)", (await P(`doc().traits.seats ?? null`)) === null, await P(`doc().traits.seats ?? null`));
  const ready = await b.waitFor(`(() => { const s = [__p.shows("a")?.["${id}"], __p.shows("b")?.["${id}"]]; return s.every((x) => x && x.tick !== null && x.shown) })()`, 180_000);
  check("both views opened it and show a picture", !!ready, await both(id));
  await b.step(30);
  check("stopped while nobody plays, and the screen says P plays it", (await both(id)).every((s) => s.tick === 0 && !s.running) && (await P(`labels("a")`)).some((t) => /point at it and press P/.test(t)), { shows: await both(id), labels: await P(`labels("a")`) });
  await shot("given");

  // ---- 2. seats: Ana at P1, Ben at P2
  // (the picker shows the seats of what has your attention: each looks at the cabinet first)
  await P(`select("a", "${id}")`);
  await P(`select("b", "${id}")`);
  await b.step(5);
  report.numbers.options = await P(`seatOptions("a")`);
  await P(`pickSeat("a", "${sids[0]}")`);
  await b.step(30);
  await P(`pickSeat("b", "${sids[1]}")`);
  await b.step(60);
  const viewers = await P("viewers");
  const heldA = await P(`held("a")`), heldB = await P(`held("b")`);
  check("seats: each sits in the seat body", (await P(`body("a")`)) === "seat" && (await P(`body("b")`)) === "seat", [await P(`body("a")`), await P(`body("b")`)]);
  check("seats: each holds their port's pad", /P1/.test(heldA?.name ?? "") && /P2/.test(heldB?.name ?? ""), [heldA, heldB]);
  const eyes = [await P(`eye("a")`), await P(`eye("b")`)];
  check("seats: each looks from their seat (the seat's camera, through the cabinet)", near(eyes[0], seats[sids[0]].camera.position, 0.02) && near(eyes[1], seats[sids[1]].camera.position, 0.02), { eyes, seats: [seats[sids[0]].camera, seats[sids[1]].camera] });
  let held = await P(`inputs(${JSON.stringify(session)})`);
  const open = (port) => held.find((s) => s.port === port && s.until === null);
  check("seats: the session gives port 0 to Ana and port 1 to Ben", open(0)?.by === viewers.a && open(1)?.by === viewers.b && held.filter((s) => s.until === null).length === 2, held);
  const running = await both(id);
  check("seats: the machine runs on both views", running.every((s) => s.running), running);
  const written = await P(`doc().objects["${id}"].traits.seats`);
  check("seats: sitting wrote nothing on the seats (each is its sitter's claim, on the cabinet)", sids.every((s) => written[s].player === null) && (await P(`doc().objects["${id}"].claims?.["seat:p1"]?.viewer`)) === viewers.a, { written, claims: await P(`doc().objects["${id}"].claims ?? null`) });
  await shot("seated");

  // ---- 3. input: Ana's Start, Ben's Right, each landing in its own seat's document
  const seen = { a: new Map(), b: new Map() };
  for (let f = 0; f < 360; f++) {
    if (f % 90 === 20) (await P(`focus("a")`), await b.keyDown("Enter"));
    if (f % 90 === 26) await b.keyUp("Enter");
    if (f === 60) (await P(`focus("b")`), await b.keyDown("ArrowRight"));
    if (f === 300) (await P(`focus("b")`), await b.keyUp("ArrowRight"));
    await b.step(1);
    const [sa, sb] = await both(id);
    if (sa?.shown) seen.a.set(sa.shown.tick, sa.shown.hash);
    if (sb?.shown) seen.b.set(sb.shown.tick, sb.shown.hash);
  }
  await b.step(120); // a second's chunk written
  held = await P(`inputs(${JSON.stringify(session)})`);
  const START = 0x8, RIGHT = 0x80;
  const bits = (port) => held.filter((s) => s.port === port).reduce((x, s) => x | s.bits, 0);
  report.numbers.inputs = held;
  check("input: Ana's Start is in port 0's seat document and Ben's Right is not", (bits(0) & START) !== 0 && (bits(0) & RIGHT) === 0, { port0: bits(0) });
  check("input: Ben's Right is in port 1's and Ana's Start is not", (bits(1) & RIGHT) !== 0 && (bits(1) & START) === 0, { port1: bits(1) });
  let pairs = 0, mismatched = 0;
  for (const [t, h] of seen.a) if (seen.b.has(t)) (pairs++, h !== seen.b.get(t) && mismatched++);
  const pictures = new Set(seen.a.values()).size;
  report.numbers.pictures = { pairs, mismatched, pictures };
  check("input: the game moved, and both views drew the same picture for most ticks both drew", pictures >= 3 && pairs > 100 && mismatched / pairs < 0.1, report.numbers.pictures);

  // ---- 4. sound
  const sound = await P("audio()");
  const placed = await P(`placement("a", "${id}")`);
  report.numbers.sound = sound;
  const centre = (() => {
    // the screen's centre in the world: the cabinet stands at the origin unturned, so its frame is the world's
    const s = seats[sids[0]].camera.target;
    return s;
  })();
  check("sound: one AudioContext a view", sound.contexts === 2, sound.contexts);
  check("sound: each view's panner stands at the screen's centre", sound.panners.length === 2 && sound.panners.every((p) => near(p.at, centre, 1e-3)), { panners: sound.panners, centre, placed: placed?.centres });
  const listenerAt = (eye) => sound.listeners.some((l) => near(l, eye, 0.02));
  check("sound: each view's ears are at its seat's eye (one Ana's, one Ben's)", listenerAt(eyes[0]) && listenerAt(eyes[1]), { listeners: sound.listeners, eyes });
  check("sound: both views played the machine's audio (its stream, resampled to the context's rate)", sound.started.length === 2 && sound.started.every((s) => s.loud > 10 && s.rates.length === 1 && s.rates[0] === s.rate), sound.started);

  // ---- 5. Escape: the pad down, the port still Ana's; P picks it up
  await P(`focus("a")`);
  await b.key("Escape");
  await b.step(10);
  held = await P(`inputs(${JSON.stringify(session)})`);
  check("Escape puts Ana's pad down, and port 0 stays hers while she sits", !(await P(`held("a")`)) && open(0)?.by === viewers.a && (await P(`body("a")`)) === "seat", { held: await P(`held("a")`), seats: held });
  await b.key("p");
  await b.step(10);
  check("P picks it up again", /P1/.test((await P(`held("a")`))?.name ?? ""), await P(`held("a")`));

  // ---- 6. standing up gives the port back; the last one up stops it
  await P(`pickSeat("a", "")`);
  await b.step(60);
  held = await P(`inputs(${JSON.stringify(session)})`);
  check("Ana watches: out of the seat body, the pad gone, port 0 given back", (await P(`body("a")`)) !== "seat" && !(await P(`held("a")`)) && !open(0) && open(1)?.by === viewers.b, { body: await P(`body("a")`), seats: held });
  check("and her seat is free: no claim left, and Ben's picker doesn't call it away", !(await P(`doc().objects["${id}"].claims?.["seat:p1"]`)) && !(await P(`seatOptions("b")`)).some(([, t]) => /away/.test(t)), { claims: await P(`doc().objects["${id}"].claims ?? null`), options: await P(`seatOptions("b")`) });
  check("Ben plays on", (await both(id)).every((s) => s.running), await both(id));
  await P(`pickSeat("b", "")`);
  const still = await b.waitFor(`(() => { const s = [__p.shows("a")?.["${id}"], __p.shows("b")?.["${id}"]]; return s.every((x) => !x.running) && s[0].tick === s[1].tick && s[0].shown?.tick === s[0].tick && s[1].shown?.tick === s[1].tick })()`, 60_000);
  await b.step(60);
  const end = await both(id);
  report.numbers.stopped = end;
  check("Ben gets up: the machine stops, both views at one tick, with one picture", !!still && end[0].tick === end[1].tick && end[0].tick > 60 && end.every((s) => !s.running) && end[0].shown?.hash === end[1].shown?.hash, end);
  held = await P(`inputs(${JSON.stringify(session)})`);
  check("and nobody holds a port", held.every((s) => s.until !== null), held);
  await shot("stopped");

  const errors = await P("errors");
  const ours = errors.filter((e) => !/KHR_parallel_shader_compile|AudioContext was not allowed to start/.test(e));
  check("no errors or warnings on the page", ours.length === 0, ours.slice(0, 8));
} catch (e) {
  check("the probe ran to the end", false, String(e?.stack ?? e));
}
await finish();
