// Play is the way in: two cabinets with seats in a scene, in headless Chrome,
// two people on real Automerge docs, with real keys and a real pointer.
//
//   (in scene/, seats/ and machine/) pnpm build
//   [CHROME_LOCK=<dir>] node probes/play.mjs [--wad <freedoom1.wad>] [--shots <dir>] [--port 4950] [--cdp 9950]
//
// The lead, 2026-11-16: "in the arcade, i wasn't able to play - the screen
// was dark and play had no keyboard shortcut and clicking had no effect".
// Mounts the BUILT scene tool with the BUILT seats and machine packages
// (probes/scene-probe.html?seats). Ana pastes Doom (Freedoom E1M1, one
// player: one port) and the Super NES (Unarmed, four ports); each gets its
// session and a seat per port. Then, both views in Look (the success
// criteria):
//  1. never black: before anyone plays, both cabinets are stopped at tick 0
//     and each screen shows a picture (the engine's first, found from that
//     state: present/poster.js), not one colour; the note says a click or
//     P plays it;
//  2. the way in: hovering the Doom cabinet in Look, the use prompt offers
//     Play with its key, enabled; P sits Ana at P1 (the seat body, the
//     roster says so), with the pad in hand, port 0 hers in the session,
//     and the machine runs;
//  3. the controls: while the pad is in hand, a panel at the top left of
//     her view says what Doom's keys do; after a few seconds it folds to its
//     title, and hovered it opens again;
//  4. keys reach the engine: Ana walks and turns; her port's input document
//     holds Doom ticcmds that move (forward and turn non-zero), the picture
//     changes far more than while she stood still, and Ben's view draws the
//     same pictures at the same ticks;
//  5. every port taken: Ben's click on Doom (its one port Ana's) says so and
//     sits him nowhere; his P is refused, the verb greyed out saying so;
//  6. getting up gives the port back: Ana watches (the picker); out of the
//     seat body, the pad and the panel gone, port 0 ended in the session,
//     the machine stopped, its screen holding the last picture (not blank);
//     now Ben's click on the Doom screen sits him at P1 with the pad;
//     Escape puts the pad down and keeps the port (still seated), P picks it
//     up, Escape again, and Leave (the body chip's Look) stands him up and
//     gives the port back;
//  7. the use prompt's button: a click on Play at the Super NES sits Ana at
//     its P1 with the pad; the panel says the SNES's keys; Start (Enter)
//     moves its picture; getting up stops it, the picture held;
//  8. Play from Edit: Ana in Edit selects the Super NES (a click there
//     selects, it doesn't play) and presses P with the pointer off it: sat
//     at its P1 with the pad; standing up lands her in Look (nothing stands
//     on Edit);
//  9. no errors. Screenshots of each moment.
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
const WAD = arg("--wad", join(PKG, "engines/doom/test/freedoom1.wad"));
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "machine-play-shots")));
const PORT = Number(arg("--port", 4950)), CDP = Number(arg("--cdp", PORT + 5000));
const LOCK = process.env.CHROME_LOCK ?? null;

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

const b = await browser({ root: ROOT, port: PORT, cdp: CDP, page: "/machine/probes/scene-probe.html?seats", width: 1460, height: 580, timeout: 1_200_000, mounts: { "/wad": resolve(WAD) } });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const P = (e) => b.js(`window.__p.${e}`);
const J = JSON.stringify;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `play-${name}.png`)));

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

  // ---- the arcade: Doom on the left, the Super NES on the right, each with its session and seats
  const ids = {};
  const AT = { doom: [-0.6, 0, 0], snes: [0.6, 0, 0] };
  for (const kind of ["doom", "snes"]) {
    const url = await P(`machines.${kind}`);
    for (let i = 0; i < 6 && !ids[kind]; i++) {
      await P(`paste("a", ${J(url)})`);
      ids[kind] = await b.waitFor(`__p.byUrl(${J(url)})`, 5_000);
    }
    await P(`setTransform("${ids[kind]}", ${J(AT[kind])})`);
  }
  for (const kind of ["doom", "snes"]) await b.waitFor(`__p.trait("${ids[kind]}")?.seats?.length > 0 && __p.trait("${ids[kind]}", "b")?.seats?.length > 0`, 180_000);
  await b.waitFor(`__p.running("a").includes("machine") && __p.running("b").includes("machine") && __p.running("b").includes("seats")`, 60_000);
  const laid = Object.fromEntries(["doom", "snes"].map((k) => [k, null]));
  for (const k of ["doom", "snes"]) laid[k] = await P(`trait("${ids[k]}")`);
  check("both cabinets have their session and a seat per port (Doom one, the Super NES four)", J(laid.doom?.seats) === J(["p1"]) && J(laid.snes?.seats) === J(["p1", "p2", "p3", "p4"]), laid);
  for (const w of ["a", "b"]) {
    await P(`enter("${w}", "look")`);
    await P(`edit("${w}", false)`);
    await P(`setCamera("${w}", { position: [0, 1.45, 2.9], target: [0, 1.1, 0] })`);
  }
  await b.waitFor(`(() => { const s = [...Object.values(__p.shows("a")), ...Object.values(__p.shows("b"))]; return s.length === 4 && s.every((x) => x.tick !== null && x.shown && !x.shown.blank) })()`, 180_000).catch(() => null);
  await b.step(30);

  // ---- 1. never black
  const still = { doom: await both(ids.doom), snes: await both(ids.snes) };
  report.numbers.stopped = still;
  check("1. both views are in Look", (await P(`body("a")`)) === "look" && (await P(`body("b")`)) === "look", [await P(`body("a")`), await P(`body("b")`)]);
  check("1. both cabinets are stopped at tick 0 while nobody plays", Object.values(still).flat().every((s) => s?.tick === 0 && !s.running), still);
  check(
    "1. and each screen shows a picture, not one colour: Doom's view of E1M1 (320x200), Unarmed's title (256x224), on both views",
    still.doom.every((s) => s?.shown && !s.shown.blank && J(s.shown.size) === J([320, 200])) && still.snes.every((s) => s?.shown && !s.shown.blank && J(s.shown.size) === J([256, 224])),
    still,
  );
  check("1. both views show the same poster", still.doom[0]?.shown?.hash === still.doom[1]?.shown?.hash && still.snes[0]?.shown?.hash === still.snes[1]?.shown?.hash, still);
  const labels0 = await P(`labels("a")`);
  const NOTE = "Stopped while nobody plays: click it, or point at it and press P";
  check("1. the note under each screen says a click or P plays it", labels0.length === 2 && labels0.every((t) => t === NOTE), labels0);
  await shot("1-stopped");

  // ---- 2. the way in: Play on the use prompt, and P
  const doomFront = await P(`project("a", [${AT.doom[0]}, 1.0, 0.36])`);
  await P(`focus("a")`); // the keys to her view (a click on the cabinet would play it: step 6)
  await b.move(doomFront.x, doomFront.y);
  await b.move(doomFront.x, doomFront.y + 1);
  await b.step(10);
  const prompt = await P(`prompt("a")`);
  check("2. hovering the Doom cabinet in Look, the use prompt offers Play with its key, enabled", prompt.some((v) => /^P\s*Play$/.test(v.text) && !v.disabled), prompt);
  await shot("2-prompt");
  await b.key("p");
  await b.step(30);
  const sat = { body: await P(`body("a")`), sitting: await P(`sitting("a")`), held: await P(`held("a")`) };
  check("2. P sits Ana at Doom's P1: the seat body, the roster says so, the pad in hand", sat.body === "seat" && J(sat.sitting) === J({ of: ids.doom, seat: "p1" }) && /P1/.test(sat.held?.name ?? ""), sat);
  const viewers = await P("viewers");
  let ins = await P(`inputs(${J(laid.doom.session)})`);
  const open = (port) => ins.find((s) => s.port === port && s.until === null);
  check("2. port 0 is hers in the session, and the machine runs on both views", open(0)?.by === viewers.a && (await both(ids.doom)).every((s) => s.running), { ins, shows: await both(ids.doom) });
  report.numbers.notices = await P(`notices("a")`);

  // ---- 3. the controls
  const panel = await P(`controls("a")`);
  report.numbers.panel = panel;
  const doomRows = Object.fromEntries(panel?.rows?.map(([k, l]) => [l, k]) ?? []);
  check(
    "3. while the pad is in hand, the controls say what Doom's keys do",
    !!panel && /P1 · keys$/.test(panel.title) && doomRows.Forward === "↑W" && doomRows.Fire === "Ctrl" && doomRows.Use === "SpaceE" && doomRows.Weapon === "1–7" && /Esc puts the pad down/.test(panel.foot) && !panel.folded && panel.keysShown,
    panel,
  );
  check("3. the panel is at the top left of Ana's view, compact", !!panel && panel.box[0] >= 0 && panel.box[0] <= 30 && panel.box[1] <= 60 && panel.box[2] <= 380 && panel.box[3] - panel.box[1] <= 160, panel?.box);
  await shot("3-seated-controls");

  // ---- 4. keys reach the engine
  const idle = await (async () => {
    const seen = new Set();
    for (let f = 0; f < 90; f++) {
      await b.step(1);
      const [a] = await both(ids.doom);
      if (a?.shown) seen.add(a.shown.hash);
    }
    return seen.size;
  })();
  await P(`focus("a")`);
  const seen = { a: new Map(), b: new Map() };
  for (let f = 0; f < 180; f++) {
    if (f === 5) await b.keyDown("ArrowUp");
    if (f === 60) await b.keyDown("ArrowLeft");
    if (f === 120) await b.keyUp("ArrowLeft");
    if (f === 170) await b.keyUp("ArrowUp");
    await b.step(1);
    const [sa, sb] = await both(ids.doom);
    if (sa?.shown) seen.a.set(sa.shown.tick, sa.shown.hash);
    if (sb?.shown) seen.b.set(sb.shown.tick, sb.shown.hash);
  }
  await b.step(120); // a second's chunk written
  const walking = new Set(seen.a.values()).size;
  let pairs = 0, mismatched = 0;
  for (const [t, h] of seen.a) if (seen.b.has(t)) (pairs++, h !== seen.b.get(t) && mismatched++);
  // Doom's ticcmds, as her port's input documents hold them: forward while ↑ was down (~95 ticks at 35 Hz), a turn while ← was (~35)
  const moves = await P(`ticcmds(${J(laid.doom.session)}, 0)`);
  report.numbers.keys = { idle, walking, pairs, mismatched, moves };
  check("4. her port's input documents hold what she pressed: Doom ticcmds moving forward, and turning", moves.forward >= 60 && moves.turn >= 20, moves);
  check("4. the picture moves with the keys: walking and turning draws far more pictures than standing still", walking >= 60 && walking > 3 * Math.max(1, idle), { idle, walking });
  check("4. and Ben's view drew the same pictures at the same ticks (mostly: a prediction put right)", pairs >= 80 && mismatched / pairs < 0.1, { pairs, mismatched });
  await shot("4-walked");
  // the panel folds to its title once the pad's been in hand a while (8 s of the stage's time), and opens again while hovered
  await b.step(300);
  const folded = await P(`controls("a")`);
  check("3. after a few seconds the panel folds to its title alone", !!folded && folded.folded && !folded.keysShown && /P1 · keys$/.test(folded.title), folded);
  if (folded) await b.move((folded.box[0] + folded.box[2]) / 2, (folded.box[1] + folded.box[3]) / 2);
  await b.step(2);
  const hovered = await P(`controls("a")`);
  check("3. and hovered it opens again", !!hovered && hovered.keysShown, hovered);
  await shot("4-folded-hovered");
  await b.move(doomFront.x, doomFront.y);

  // ---- 5. every port taken: Ben at Doom
  const benFront = await P(`project("b", [${AT.doom[0]}, 1.0, 0.36])`);
  const benNotices0 = (await P(`notices("b")`)).length;
  await b.click(benFront.x, benFront.y); // a click on a cabinet whose every port is taken: says so
  await b.move(benFront.x, benFront.y + 1);
  await b.step(10);
  const benClick = { notices: (await P(`notices("b")`)).slice(benNotices0), body: await P(`body("b")`), sitting: await P(`sitting("b")`) };
  check("5. Ben's click on Doom, whose one port is Ana's, says every port is taken and sits him nowhere", benClick.notices.includes("Every port is taken") && benClick.body === "look" && benClick.sitting === null, benClick);
  const benPrompt = await P(`prompt("b")`);
  check("5. Ben, at Doom whose one port is Ana's: Play is greyed out, its label saying every port is taken", benPrompt.some((v) => /Play \(every port is taken\)$/.test(v.text) && v.disabled), benPrompt);
  const benNotices = (await P(`notices("b")`)).length;
  await b.key("p");
  await b.step(20);
  const refused = { notices: (await P(`notices("b")`)).slice(benNotices), body: await P(`body("b")`), sitting: await P(`sitting("b")`) };
  check("5. P there sits him nowhere, and Ana keeps the port", refused.body === "look" && refused.sitting === null && !(await P(`held("b")`)) && (await P(`inputs(${J(laid.doom.session)})`)).filter((s) => s.until === null).map((s) => s.by).join() === viewers.a, refused);
  await shot("5-taken");

  // ---- 6. getting up gives the port back
  const before = (await both(ids.doom))[0];
  await P(`pickSeat("a", "")`);
  const stopped = await b.waitFor(`(() => { const s = [__p.shows("a")?.["${ids.doom}"], __p.shows("b")?.["${ids.doom}"]]; return s.every((x) => !x.running) && s[0].tick === s[1].tick && s[0].shown?.tick === s[0].tick })()`, 60_000);
  await b.step(30);
  const after = await both(ids.doom);
  ins = await P(`inputs(${J(laid.doom.session)})`);
  const up = { body: await P(`body("a")`), held: await P(`held("a")`), panel: await P(`controls("a")`), sitting: await P(`sitting("a")`) };
  check("6. Ana watches: out of the seat body, the pad and the panel gone", up.body === "look" && !up.held && up.panel === null && up.sitting === null, up);
  check("6. port 0 given back in the session; the machine stopped on both views at one tick", !open(0) && ins.every((s) => s.until !== null) && !!stopped && after.every((s) => !s.running) && after[0].tick === after[1].tick && after[0].tick > before.tick - 1, { ins, after });
  check("6. the stopped screen holds the last picture played, not a blank one, the same on both views", after.every((s) => s.shown && !s.shown.blank) && after[0].shown.hash === after[1].shown.hash && after[0].shown.hash !== still.doom[0].shown.hash, after);
  const labels6 = await P(`labels("a")`);
  check("6. and its note says a click or P plays it", labels6.includes(NOTE), labels6);
  await shot("6-up");
  // a click on the Doom screen, in Look: Play
  const benScreen = await P(`project("b", [${AT.doom[0]}, 1.25, 0.3])`);
  await b.click(benScreen.x, benScreen.y);
  await b.step(30);
  const benSat = { body: await P(`body("b")`), sitting: await P(`sitting("b")`), held: await P(`held("b")`) };
  check("6. now the port is free: Ben's click on the Doom screen sits him at P1 with the pad", benSat.body === "seat" && J(benSat.sitting) === J({ of: ids.doom, seat: "p1" }) && /P1/.test(benSat.held?.name ?? ""), benSat);
  await shot("6-ben-clicked");
  // Escape: the pad down, the port his while he sits; P: back in hand; Escape again, and Leave stands him up
  const benPort = async () => (await P(`inputs(${J(laid.doom.session)})`)).filter((x) => x.until === null).map((x) => [x.port, x.by]);
  await P(`focus("b")`);
  await b.key("Escape");
  await b.step(10);
  const esc1 = { body: await P(`body("b")`), held: await P(`held("b")`), sitting: await P(`sitting("b")`), ports: await benPort(), panel: await P(`controls("b")`) };
  check("6. Escape puts Ben's pad down: still seated, port 0 still his, the panel gone", esc1.body === "seat" && !esc1.held && J(esc1.sitting) === J({ of: ids.doom, seat: "p1" }) && J(esc1.ports) === J([[0, viewers.b]]) && esc1.panel === null, esc1);
  await b.key("p");
  await b.step(10);
  const back = { held: await P(`held("b")`), ports: await benPort() };
  check("6. P picks it up again, on the same port", /P1/.test(back.held?.name ?? "") && J(back.ports) === J([[0, viewers.b]]), back);
  await b.key("Escape");
  await b.step(5);
  const esc2 = { body: await P(`body("b")`), held: await P(`held("b")`) };
  await b.key("Escape");
  await b.step(10);
  const esc3 = { body: await P(`body("b")`), held: await P(`held("b")`), sitting: await P(`sitting("b")`) };
  check("6. a second Escape doesn't stand him up (Escape never pops the body: scene STAGE.md); he's still seated with the pad down", esc2.body === "seat" && !esc2.held && esc3.body === "seat" && !esc3.held && esc3.sitting !== null, { esc2, esc3 });
  await P(`enter("b", "look")`);
  await b.step(30);
  const left = { body: await P(`body("b")`), sitting: await P(`sitting("b")`), ports: await benPort() };
  check("6. Leave (the body chip's Look) stands him up and gives the port back", left.body === "look" && left.sitting === null && J(left.ports) === J([]), left);

  // ---- 7. the use prompt's button, at the Super NES (Ana's camera back where it was: getting up leaves Look at the seat's eye)
  await P(`setCamera("a", { position: [0, 1.45, 2.9], target: [0, 1.1, 0] })`);
  await b.step(10);
  const snesFront = await P(`project("a", [${AT.snes[0]}, 1.0, 0.36])`);
  await b.move(snesFront.x, snesFront.y);
  await b.step(10);
  const sp = await P(`prompt("a")`);
  const play = sp.find((v) => /Play$/.test(v.text));
  check("7. at the Super NES the prompt offers Play, enabled", !!play && !play.disabled, sp);
  if (play) await b.click(play.x, play.y);
  await b.step(30);
  const snesSat = { body: await P(`body("a")`), sitting: await P(`sitting("a")`), held: await P(`held("a")`), panel: await P(`controls("a")`) };
  const snesRows = Object.fromEntries(snesSat.panel?.rows?.map(([k, l]) => [l, k]) ?? []);
  check("7. a click on it sits Ana at the Super NES's P1 with the pad", snesSat.body === "seat" && J(snesSat.sitting) === J({ of: ids.snes, seat: "p1" }) && /P1/.test(snesSat.held?.name ?? ""), snesSat);
  check("7. the panel says the SNES's keys", snesRows.Start === "Enter" && snesRows.B === "Z" && snesRows.A === "X" && snesRows.Up === "↑", snesSat.panel);
  await P(`focus("a")`);
  const snesSeen = new Set();
  for (let f = 0; f < 240; f++) {
    if (f % 60 === 10) await b.keyDown("Enter");
    if (f % 60 === 16) await b.keyUp("Enter");
    await b.step(1);
    const [s] = await both(ids.snes);
    if (s?.shown) snesSeen.add(s.shown.hash);
  }
  report.numbers.snesPictures = snesSeen.size;
  check("7. Start moves its picture", snesSeen.size >= 3, snesSeen.size);
  await shot("7-snes");
  await P(`pickSeat("a", "")`);
  const snesStopped = await b.waitFor(`(() => { const s = __p.shows("a")?.["${ids.snes}"]; return s && !s.running && s.shown?.tick === s.tick })()`, 60_000);
  await b.step(30);
  const snesAfter = await both(ids.snes);
  check("7. getting up stops it, the last picture held (not blank)", !!snesStopped && snesAfter.every((s) => !s.running && s.shown && !s.shown.blank) && (await P(`body("a")`)) === "look", snesAfter);
  await shot("7-snes-up");

  // ---- 8. Play holding the editor: a click selects there; P plays the selection
  await P(`edit("a", true)`);
  await P(`setCamera("a", { position: [0, 1.45, 2.9], target: [0, 1.1, 0] })`);
  await b.step(10);
  const snesAgain = await P(`project("a", [${AT.snes[0]}, 1.0, 0.36])`);
  await b.click(snesAgain.x, snesAgain.y);
  await b.step(10);
  const edit = { body: await P(`body("a")`), editing: await P(`editing("a")`), selected: await P(`selected("a")`), sitting: await P(`sitting("a")`) };
  check("8. holding the editor a click on the Super NES selects it, and sits nobody", edit.body === "look" && edit.editing && J(edit.selected) === J(ids.snes) && edit.sitting === null, edit);
  const off = await P(`project("a", [0, 0.05, 1.6])`); // the floor in front, off both cabinets
  await b.move(off.x, off.y);
  await b.step(5);
  await P(`focus("a")`);
  await b.key("p");
  await b.step(30);
  const fromEdit = { body: await P(`body("a")`), sitting: await P(`sitting("a")`), held: await P(`held("a")`) };
  check("8. P with it selected, the pointer off it, sits Ana at its P1 with the pad", fromEdit.body === "seat" && J(fromEdit.sitting) === J({ of: ids.snes, seat: "p1" }) && /P1/.test(fromEdit.held?.name ?? ""), fromEdit);
  await shot("8-from-edit");
  await P(`pickSeat("a", "")`);
  await b.step(30);
  check("8. standing up lands her in Look, the editor still held (a hand, not a body)", (await P(`body("a")`)) === "look" && (await P(`editing("a")`)) && (await P(`sitting("a")`)) === null, await P(`body("a")`));

  const errors = await P("errors");
  const ours = errors.filter((e) => !/KHR_parallel_shader_compile|AudioContext was not allowed to start/.test(e));
  check("9. no errors or warnings on the page", ours.length === 0, ours.slice(0, 8));
} catch (e) {
  check("the probe ran to the end", false, String(e?.stack ?? e));
}
await finish();
