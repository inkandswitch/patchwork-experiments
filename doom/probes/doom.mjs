// A Doom map in a scene, walked in first person by two people, in headless
// Chrome with real keys and a real mouse.
//
//   (in scene/, arena/, joints/ and doom/) pnpm build
//   node probes/doom.mjs --wad <freedoom1.wad> [--shots <dir>] [--show] [--gpu]
//
// Mounts the BUILT scene tool with the BUILT arena, joints and doom plugins on
// real Automerge docs (two peers, probes/real-repo.js). The WAD is a file doc
// in peer a's repo; A pastes its URL into an empty scene, and the doom
// package lays its first map out: one static object and one per door, all the
// same file doc, and arena's spawn point at the player 1 start. Then (the
// verifier's success criteria):
//  1. both views play E1M1 in first person and walk it (screenshots);
//  2. A walks to a door and opens it with F: both views see it rise, rest,
//     and close itself after its wait;
//  3. B walks into it while it's shut (blocked) and through it while it's
//     open (passes);
//  4. a viewer who joins while a door is open sees every door where the doc
//     has it;
//  5. the doc's history shows two writes for the door's cycle;
//  6. the door, copied into another scene (one with no game: editing only),
//     opens from its menu and closes itself there;
//  7. draw calls and frame time, first person and the whole map.
// Prints a JSON report; exits non-zero if any check fails.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { browser, checklist, sleep } from "./cdp.mjs";
import { readWad } from "../src/wad.js";
import { mapModel, anchorOf, UNITS_PER_METRE as SCALE } from "../src/parts.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const arg = (name, d = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const WAD = arg("--wad");
if (!WAD) throw new Error("usage: node probes/doom.mjs --wad <freedoom1.wad>");
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "doom-shots")));
const PORT = 4920, CDP = 9920;

// where things are, from the map itself: the static part is pasted at the origin, its anchor there
const model = mapModel(readWad(new Uint8Array(readFileSync(WAD))), "E1M1");
const [cx, cy] = model.centre;
const world = (x, y, z = 0) => [(x - cx) / SCALE, z / SCALE, -(y - cy) / SCALE];
const DOOR = 100; // the door south of the great hall: in front of it a corridor from the hall
const door = model.doors.get(DOOR);
const doorAt = world(...anchorOf(model, DOOR));
const travel = (door.open - door.closed) / SCALE;
// the route from the player 1 start (-416, 256) to the corridor in front of the door (found by a walk over the map's lines: see README)
const ROUTE = [[896, 32], [928, 0], [960, -64]].map(([x, y]) => world(x, y));
const FRONT_A = world(960, -84);
const FRONT_B = world(928, -60);
const BEYOND = world(928, -260);

const b = await browser({ root: ROOT, port: PORT, cdp: CDP, page: "/doom/probes/doom-probe.html", width: 1660, height: 960, show: process.argv.includes("--show"), gpu: process.argv.includes("--gpu"), timeout: 600_000, mounts: { "/wad": resolve(WAD) } });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `doom-${name}.png`)));
const r3 = (p) => p && p.map((v) => +v.toFixed(2));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const aimYaw = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));

/** Turn view w to yaw `want` (pitch level) by dragging on its canvas (play without pointer lock: drag to look). */
async function face(w, want, pitchWant = 0) {
  for (let i = 0; i < 14; i++) {
    const { yaw, pitch } = await P(`yawPitch("${w}")`);
    const dy = wrap(want - yaw), dp = pitchWant - pitch;
    if (Math.abs(dy) < 0.01 && Math.abs(dp) < 0.01) return true;
    const mx = Math.round(-dy / 0.0022), my = Math.round(-dp / 0.0022);
    if (await P("locked()")) await P(`nudge("${w}", ${mx}, ${my})`);
    else {
      const c = await P(`canvasRect("${w}")`);
      const x = c.x + c.w / 2, y = c.y + c.h / 2;
      await b.mouse("mouseMoved", x, y);
      await b.mouse("mousePressed", x, y);
      const n = 8;
      for (let k = 1; k <= n; k++) await b.mouse("mouseMoved", x + (mx * k) / n, y + (my * k) / n, { buttons: 1 });
      await b.mouse("mouseReleased", x + mx, y + my);
    }
    await sleep(60);
  }
  return false;
}
const eye = async (w) => (await P(`cam("${w}")`)).position;
/** Walk view w (W held) toward [x, ·, z], steering, until within tol or ms pass. Returns the eye. */
async function walkTo(w, [x, , z], { ms = 15000, tol = 0.4 } = {}) {
  const t0 = Date.now();
  let p = await eye(w);
  await face(w, aimYaw(p, [x, 0, z]));
  await b.keyDown("w");
  try {
    while (Date.now() - t0 < ms) {
      await sleep(70);
      p = await eye(w);
      if (Math.hypot(x - p[0], z - p[2]) < tol) break;
      const want = aimYaw(p, [x, 0, z]);
      if (Math.abs(wrap(want - (await P(`yawPitch("${w}")`)).yaw)) > 0.12) {
        await b.keyUp("w");
        await face(w, want);
        await b.keyDown("w");
      }
    }
  } finally {
    await b.keyUp("w");
  }
  await sleep(250);
  return eye(w);
}
/** Hold W for ms, facing the way it faces. Returns the eye. */
async function push(w, ms) {
  await b.keyDown("w");
  await sleep(ms);
  await b.keyUp("w");
  await sleep(200);
  return eye(w);
}
/** Put the pointer over a world point in view w (what the use prompt looks at without pointer lock). */
async function hover(w, p) {
  const q = await P(`project("${w}", ${JSON.stringify(p)})`);
  if (q) await b.move(Math.round(q.x), Math.round(q.y));
  await sleep(250);
  return q;
}
async function clickAt({ x, y }) {
  await b.click(Math.round(x), Math.round(y));
}
/** Play in view w: switch to play, press ▶ Play. */
async function play(w) {
  if ((await P(`activity("${w}")`)) !== "play") {
    const r = await P(`switchRect("${w}", "Play")`);
    if (r) await clickAt(r);
    else await P(`setActivity("${w}", "play")`);
    await b.waitFor(`window.__p.activity("${w}") === "play" && window.__p.running("${w}").includes("arena")`, 8000);
  }
  await b.waitFor(`!!window.__p.rect(".arena-play", "${w}")`, 8000);
  await clickAt(await P(`rect(".arena-play", "${w}")`));
  await sleep(600);
}
/** The door's height as view w draws it, above where it rests shut. */
const rise = async (id, w) => {
  const d = await P(`drawn(${JSON.stringify(id)}, "${w}")`);
  return d ? +(d[1] - doorAt[1]).toFixed(3) : null;
};

let failed = false;
try {
  check("page set up", await b.waitFor("window.__ready === true", 60_000), await P("errors"));
  report.numbers.wadDocMs = Math.round(await P("wadMs"));

  // ─── the map, laid out from the WAD ──────────────────────────────────────
  const wadUrl = await P("wadUrl");
  await P(`focus("a")`);
  const t0 = Date.now();
  await P(`paste("a", ${JSON.stringify(wadUrl)})`);
  const laidOut = await b.waitFor(`window.__p.loaded("a").total >= 13`, 30_000);
  const built = await b.waitFor(`(() => { const a = window.__p.loaded("a"), b = window.__p.loaded("b"); return a.total >= 13 && a.loaded === a.total && b.total >= 13 && b.loaded === b.total; })()`, 120_000);
  report.numbers.buildAndLoadMs = Date.now() - t0;
  const doc = await P(`doc("a")`);
  const objs = Object.entries(doc.objects);
  const group = objs.find(([, o]) => o.kind === "group");
  const parts = objs.filter(([, o]) => o.kind !== "group");
  // (arena's spawn point is a passthrough GLB: no render doc)
  const renders = await Promise.all(parts.map(([, o]) => (o.renderUrl ? P(`find(${JSON.stringify(o.renderUrl)})`) : null)));
  const doors = parts.filter(([, o]) => o.traits?.["joints.slide"]);
  const spawn = parts.find(([, o]) => o.traits?.["arena.spawn"]);
  const staticObj = parts.find(([, o]) => !o.parent);
  const maps = parts.filter(([, o]) => o.providerId === "doom-map");
  const mapRenders = renders.filter((_, i) => parts[i][1].providerId === "doom-map");
  details.layout = { objects: parts.map(([, o], i) => `${o.name}: ${o.providerId} ${JSON.stringify(renders[i]?.params ?? null)}`), group: group?.[1].name };
  check("pasting the WAD lays out its first map: one static part, a part per door (11), arena's spawn point, in a group", laidOut && parts.length === 13 && maps.length === 12 && doors.length === 11 && !!spawn && spawn[1].providerId !== "doom-map" && group?.[1].name === "E1M1" && parts.every(([, o]) => o.group === group[0]), details.layout);
  check("every part of the map is the same WAD file doc, seen through the doom-map provider with params of its own: { map, door }", maps.every(([, o]) => o.sourceUrl === wadUrl) && mapRenders.every((r) => r.parent === wadUrl && r.params.map === "E1M1" && Object.keys(r.params).sort().join() === "door,map") && new Set(mapRenders.map((r) => r.params.door)).size === 12 && mapRenders.filter((r) => r.params.door == null).length === 1, mapRenders.map((r) => r.params));
  check("the doors and the spawn are attached to the static part; the map's parts are locked", parts.every(([id, o]) => (id === staticObj[0] ? !o.parent : o.parent === staticObj[0])) && maps.every(([, o]) => o.locked === true));
  check("each door has a slide (up, by its travel, closing itself after its wait), closed", doors.every(([, o]) => { const s = o.traits["joints.slide"]; return s.at === "closed" && s.axis.join() === "0,1,0" && s.stops.open > 0 && s.wait > 4 && s.speed > 0; }), doors.map(([, o]) => o.traits["joints.slide"]));
  check("the scene is a level with a sky of its own; the start is its spawn", doc.traits?.["arena.level"]?.look === "sky" && !!spawn);
  check("every part built and loaded in both views", built, { a: await P(`loaded("a")`), b: await P(`loaded("b")`), status: await P(`status("a")`) });
  const about = group ? await P(`find(${JSON.stringify(group[1].infoUrl)})`) : null;
  const wadDoc = await P("wadDoc()");
  check("the WAD file doc now carries Freedoom's notice (it says it's Freedoom 0.13.0; its terms come from the release)", /Redistribution and use in source and binary forms/.test(wadDoc.origin?.notice ?? "") && wadDoc.origin?.name === "Freedoom 0.13.0", wadDoc.origin && { name: wadDoc.origin.name, urls: wadDoc.origin.urls });
  check("the map's About carries the notice, says it isn't Freedoom, and lists what doesn't work here", /All rights reserved/.test(about?.content ?? "") && /not Freedoom/.test(about?.content ?? "") && /Lift: sectors 98, 103/.test(about?.content ?? "") && /Locked door: sectors 51, 71/.test(about?.content ?? ""), about?.content?.split("\n").slice(0, 24));
  const staticRender = renders[parts.indexOf(staticObj)];
  details.status = await P(`status("a")`);
  details.staticRender = { builtFrom: staticRender.builtFrom, status: staticRender.status };

  // ─── 1. both walk it in first person ─────────────────────────────────────
  await play("a");
  check("A plays in first person: a sky, the arena's walker at the player 1 start", (await P(`atmosphere("a")`))?.sky?.top === "#5d8fc9" && (await P(`running("a")`)).includes("joints"), { atmosphere: await P(`atmosphere("a")`), running: await P(`running("a")`) });
  const startA = await eye("a");
  const spawnAt = world(-416, 256);
  check("A starts at the player 1 start", Math.hypot(startA[0] - spawnAt[0], startA[2] - spawnAt[2]) < 0.3, { eye: r3(startA), spawn: r3(spawnAt) });
  report.numbers.firstPersonStart = await P(`timeFrames("a", 2500)`);
  await shot("1-a-start");
  await face("a", Math.PI / 2 - 0.3, -0.05); // looking north-ish round the start room
  await shot("1-a-start-north");
  await face("a", -Math.PI / 2, 0); // east, into the hall
  await shot("1-a-start-east");
  // A walks the route to the door
  for (const p of ROUTE) await walkTo("a", p);
  const atDoorA = await walkTo("a", FRONT_A, { tol: 0.25 });
  check("A walks from the start through the hall to the door (about 38 m)", Math.hypot(atDoorA[0] - FRONT_A[0], atDoorA[2] - FRONT_A[2]) < 0.5, { eye: r3(atDoorA), want: r3(FRONT_A) });
  await face("a", aimYaw(atDoorA, doorAt), 0.1);
  await shot("1-a-door-shut");
  // B plays too, and walks the same way, to beside A
  await P(`focus("b")`);
  await play("b");
  const startB = await eye("b");
  await shot("1-b-start");
  for (const p of ROUTE) await walkTo("b", p);
  const atDoorB = await walkTo("b", FRONT_B, { tol: 0.25 });
  check("B walks the same way, to beside A", Math.hypot(atDoorB[0] - FRONT_B[0], atDoorB[2] - FRONT_B[2]) < 0.5, { start: r3(startB), eye: r3(atDoorB) });
  check("each sees the other (arena avatars)", (await P(`avatars("a")`)).length === 1 && (await P(`avatars("b")`)).length === 1, { a: await P(`avatars("a")`), b: await P(`avatars("b")`) });

  // ─── 3a. B is stopped by the shut door ────────────────────────────────────
  const doorId = doors.find(([, o]) => o.name === `Door ${DOOR}`)[0];
  await face("b", aimYaw(atDoorB, BEYOND));
  const pushed = await push("b", 1500);
  const doorFace = doorAt[2] - 0.0; // the door's middle (its faces are within a few cm of it)
  check("B walking into the shut door moves (over a metre toward it) and is stopped in front of it", pushed[2] > atDoorB[2] + 1 && pushed[2] < doorAt[2] - 0.25, { before: r3(atDoorB), after: r3(pushed), moved: +(pushed[2] - atDoorB[2]).toFixed(2), shortOfDoor: +(doorAt[2] - pushed[2]).toFixed(2), door: r3(doorAt) });
  await shot("3-b-blocked");

  // ─── 2. A opens it with F: both see it rise, rest open, and close ───────
  await P(`focus("a")`);
  // without pointer lock (headless) the use prompt goes by the pointer: put it on the door
  const q = await hover("a", [doorAt[0], doorAt[1] + 1.4, doorAt[2] - 0.2]);
  details.lookAtDoor = await P(`pickAt("a", ${Math.round(q.x)}, ${Math.round(q.y)})`);
  await b.waitFor(`window.__p.useText("a").length > 0`, 3000);
  const prompt = await P(`useText("a")`);
  check("A, looking at the door within reach, is offered [F] Open", prompt.some((t) => /F/.test(t) && /Open/.test(t)), prompt);
  const writes0 = (await P("writes(1)")).length;
  await b.key("f");
  const samples = [];
  const tOpen = Date.now();
  let passed = null;
  let late = null;
  // sample both views while it rises; B walks through once it's up; C joins once it rests open
  while (Date.now() - tOpen < 4200) {
    samples.push({ t: Date.now() - tOpen, a: await rise(doorId, "a"), b: await rise(doorId, "b") });
    if (!late && (await P(`doc("b")`)).objects[doorId].traits["joints.slide"].at === "open") late = await lateJoin();
    if (!passed && samples.at(-1).b > 2.2) {
      await P(`focus("b")`);
      await shot("2-b-sees-it-rising");
      passed = await push("b", 1400);
      await P(`focus("a")`);
    }
    await sleep(60);
  }
  const top = Math.max(...samples.map((s) => s.a ?? 0));
  const topB = Math.max(...samples.map((s) => s.b ?? 0));
  check(`both views see it rise its full travel (${travel.toFixed(2)} m)`, Math.abs(top - travel) < 0.02 && Math.abs(topB - travel) < 0.02, { travel, top, topB, samples: samples.filter((_, i) => i % 6 === 0) });
  check("it rises smoothly in B too (intermediate heights seen, not a jump)", samples.filter((s) => s.b > 0.3 && s.b < travel - 0.3).length >= 3, samples.map((s) => s.b));
  // ─── 3b. B passes while it's open ─────────────────────────────────────────
  check("B walks through while it's open", !!passed && passed[2] > doorAt[2] + 0.6, { passed: r3(passed), door: r3(doorAt) });
  await P(`focus("b")`);
  await face("b", aimYaw(passed, atDoorA));
  await shot("3-b-through-looking-back");
  await P(`focus("a")`);
  const restOpen = (await P(`doc("a")`)).objects[doorId];
  check("its rest, written once it got there: open, by A's view", restOpen.traits["joints.slide"].at === "open" && typeof restOpen.traits["joints.slide"].by === "string", restOpen.traits["joints.slide"]);
  await shot("2-a-open");

  // ─── 4. a viewer who joined while it rested open (lateJoin, above) ───────
  details.lateJoin = late && { ms: late.ms, joinedAt: late.joinedAt, open: late.doors.filter((d) => d.at === "open"), posesSent: (await P(`poses(${JSON.stringify(doorId)})`)).filter((p, i, all) => p.landed !== undefined || p.y == null || i % 5 === 0 || i === all.length - 1), writes: (await P("writes(1)")).slice(writes0) };
  check("a viewer who joins while it's open sees every door where the doc has it (this one open, the rest shut)", !!late && late.doors.every((d) => d.drawn && d.doc && d.drawn.every((v, i) => Math.abs(v - d.doc[i]) < 1e-3) && !d.heldBy) && late.doors.filter((d) => d.at === "open").length === 1 && late.doors.find((d) => d.at === "open").id === doorId, details.lateJoin ?? null);
  await b.waitFor(`(() => { const l = window.__p.loaded("c"); return l.total >= 13 && l.loaded === l.total; })()`, 60_000);
  await shot("4-c-joined");

  // it closes itself after its wait
  const closed = await b.waitFor(`(() => { const s = window.__p.doc("a").objects[${JSON.stringify(doorId)}].traits["joints.slide"]; return s.at === "closed"; })()`, 12_000, 100);
  const closeSamples = [];
  for (let i = 0; i < 10; i++) closeSamples.push({ a: await rise(doorId, "a"), b: await rise(doorId, "b"), c: await rise(doorId, "c") }), await sleep(100);
  check("it closes itself after its wait, in every view", closed && closeSamples.at(-1).a === 0 && closeSamples.at(-1).b === 0 && closeSamples.at(-1).c === 0, closeSamples.at(-1));
  report.numbers.openToShutMs = Date.now() - tOpen;
  await shot("2-a-shut-again");

  // ─── 5. two writes for the cycle ─────────────────────────────────────────
  const cycle = (await P("writes(1)")).slice(writes0).filter((w) => w.moved.length);
  check("the doc's history shows two writes for the door's cycle (open, closed), and nothing else moved", cycle.length === 2 && cycle.every((w) => w.moved.length === 1 && w.moved[0] === doorId) && cycle[0].slides[0] === "open" && cycle[1].slides[0] === "closed", cycle);

  // ─── 7. draw calls and frame time ────────────────────────────────────────
  report.numbers.firstPersonAtDoor = await P(`timeFrames("a", 2500)`);
  // the whole map from above, in edit
  await b.key("Escape");
  await P(`setActivity("a", "edit")`);
  await b.waitFor(`window.__p.activity("a") === "edit"`, 5000);
  await sleep(500);
  await P(`setCamera("a", { position: [0, 95, 30], target: [0, 0, 0], fov: 60 })`);
  await sleep(400);
  report.numbers.wholeMap = await P(`timeFrames("a", 2500)`);
  await shot("7-whole-map");
  details.drawCalls = { firstPerson: report.numbers.firstPersonStart.calls, atDoor: report.numbers.firstPersonAtDoor.calls, wholeMap: report.numbers.wholeMap.calls };
  check("the whole map draws in under 200 calls (one per texture of the static part, a few per door)", report.numbers.wholeMap.calls > 0 && report.numbers.wholeMap.calls < 200, details.drawCalls);

  // ─── 6. the door, copied into another scene, still works ────────────────
  const row = await P(`rowRect("a", ${JSON.stringify(doorId)})`);
  if (row) await clickAt(row);
  await sleep(300);
  // (inside a folded row it isn't shown: then select it as the outline would)
  if ((await P(`selected("a")`)) !== doorId) await P(`select("a", ${JSON.stringify(doorId)})`), (details.selectedBy = "local.selected");
  await P(`focus("a")`);
  check("the door selected in A's outline", (await P(`selected("a")`)) === doorId, { row, selected: await P(`selected("a")`) });
  await cmdKey("c", "copy");
  const d = await P(`canvasRect("d")`);
  await b.click(Math.round(d.x + d.w / 2), Math.round(d.y + d.h * 0.8));
  await cmdKey("v", "paste");
  await b.waitFor(`Object.values(window.__p.doc("d").objects).some((o) => o.traits?.["joints.slide"])`, 10_000);
  const copied = Object.entries(await P(`doc("d")`)).length && Object.entries((await P(`doc("d")`)).objects).find(([, o]) => o.traits?.["joints.slide"]);
  const copiedRender = copied ? await P(`find(${JSON.stringify(copied[1].renderUrl)})`) : null;
  check("the copy is the same WAD seen as the same door (its own render doc, the same params), its slide shut and nobody's", !!copied && copied[1].sourceUrl === wadUrl && copiedRender?.params?.map === "E1M1" && copiedRender?.params?.door === DOOR && copied[1].renderUrl !== parts.find(([id]) => id === doorId)[1].renderUrl && copied[1].traits["joints.slide"].at === "closed" && !("by" in copied[1].traits["joints.slide"]), copied && { traits: copied[1].traits, params: copiedRender?.params });
  await b.waitFor(`window.__p.loaded("d").loaded === window.__p.loaded("d").total && window.__p.loaded("d").total > 0`, 30_000);
  // a slide alone makes no game: scene 2 is edited only, and the door is opened from its menu (right-click)
  check("scene 2 offers only editing (a slide offers no activity of its own)", JSON.stringify(await P(`available("d")`)) === '["edit"]', await P(`available("d")`));
  const copyId = copied[0];
  const cw = await P(`docWorld(${JSON.stringify(copyId)}, "d")`);
  // an orbiting eye a few metres off: no reach needed from the menu
  await P(`setCamera("d", { position: [${cw[0] + 2}, ${cw[1] + 3}, ${cw[2] + 6}], target: [${cw[0]}, ${cw[1] + 1.2}, ${cw[2]}], fov: 60 })`);
  await sleep(400);
  const onIt = await P(`project("d", [${cw[0]}, ${cw[1] + 0.05}, ${cw[2]}])`);
  details.copyPick = await P(`pickAt("d", ${Math.round(onIt.x)}, ${Math.round(onIt.y)})`);
  await b.move(Math.round(onIt.x), Math.round(onIt.y));
  await b.click(Math.round(onIt.x), Math.round(onIt.y), { button: "right" });
  await b.waitFor(`!!window.__p.menuItem("d", "Open")`, 4000);
  const item = await P(`menuItem("d", "Open")`);
  await shot("6-copy-menu");
  const writes2 = (await P("writes(2)")).length;
  if (item) await clickAt(item);
  const opened2 = await b.waitFor(`window.__p.doc("d").objects[${JSON.stringify(copyId)}].traits["joints.slide"].at === "open"`, 8000, 100);
  const drawnOpen = await P(`drawn(${JSON.stringify(copyId)}, "d")`);
  const docOpen = await P(`docWorld(${JSON.stringify(copyId)}, "d")`);
  await shot("6-copy-open");
  const shut2 = await b.waitFor(`window.__p.doc("d").objects[${JSON.stringify(copyId)}].traits["joints.slide"].at === "closed"`, 15000, 100);
  const cycle2 = (await P("writes(2)")).slice(writes2).filter((w) => w.moved.length);
  check("copied into another scene, it opens from its menu (no key, no reach, while editing) and closes itself, in two writes", !!item && item.ext === "joints" && opened2 && shut2 && cycle2.length === 2 && cycle2[0].slides[0] === "open" && cycle2[1].slides[0] === "closed" && docOpen[1] - cw[1] > 3 && Math.abs(drawnOpen[1] - docOpen[1]) < 1e-3, { pick: details.copyPick, item, cycle2, shut: cw, open: docOpen, drawnOpen });

  // ─── 7b. one view alone, at 1660 × 960: the whole map, and first person ──
  await P(`solo("a")`);
  await P(`focus("a")`);
  await sleep(800);
  await P(`setCamera("a", { position: [0, 95, 30], target: [0, 0, 0], fov: 60 })`);
  await sleep(500);
  report.numbers.alone = { wholeMap: await P(`timeFrames("a", 3000)`) };
  await shot("7-alone-whole-map");
  await play("a");
  await face("a", -Math.PI / 2, 0);
  report.numbers.alone.firstPerson = await P(`timeFrames("a", 3000)`);
  await shot("7-alone-first-person");
  details.drawCalls.alone = { wholeMap: report.numbers.alone.wholeMap.calls, firstPerson: report.numbers.alone.firstPerson.calls };

  details.statusAtEnd = { a: await P(`status("a")`), b: await P(`status("b")`) };
  details.builds = await P("builds");
  details.renderStatusAtEnd = await Promise.all(maps.map(([, o]) => P(`find(${JSON.stringify(o.renderUrl)})`).then((r) => ({ params: r.params, status: r.status, error: r.error, builtAt: r.builtAt }))));
  check("no errors in the page", (await P("errors")).filter((e) => !/KHR_parallel_shader_compile|pointer ?lock/i.test(e)).length === 0, await P("errors"));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}

/**
 * C joins scene 1 (on peer b) while the door rests open, and as soon as it
 * draws the doors (their art may still be loading) says where it draws each,
 * and where the doc has it.
 */
async function lateJoin() {
  const joinedAt = await P("now()");
  await P("joinC()");
  const t = Date.now();
  await b.waitFor(`(() => { const d = window.__p.doc("b"); return Object.keys(d.objects).filter((id) => d.objects[id].traits?.["joints.slide"]).every((id) => window.__p.drawn(id, "c")); })()`, 4000, 20);
  const d = await P(`doc("b")`);
  const ids = Object.keys(d.objects).filter((id) => d.objects[id].traits?.["joints.slide"]);
  const doors = [];
  for (const id of ids) doors.push({ id, drawn: await P(`drawn(${JSON.stringify(id)}, "c")`), doc: await P(`docWorld(${JSON.stringify(id)}, "b")`), at: d.objects[id].traits["joints.slide"].at, heldBy: await P(`heldBy(${JSON.stringify(id)}, "c")`), holds: await P(`holdsOn(${JSON.stringify(id)}, "c")`) });
  return { ms: Date.now() - t, joinedAt, doors };
}

/** a key press carrying an editing command (⌘C / ⌘V reach the page as copy / paste only with it) */
async function cmdKey(key, command) {
  const code = `Key${key.toUpperCase()}`;
  const vk = key.toUpperCase().charCodeAt(0);
  await b.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifiers: 4 });
  await b.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers: 4, commands: [command] });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: 4 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, modifiers: 0 });
  await sleep(500);
}

console.log(JSON.stringify(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
