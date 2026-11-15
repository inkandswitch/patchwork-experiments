// A running Doom seen from outside the game, in headless Chrome: its
// monsters, players and doors drawn in doom/'s own 3D map from the engine's
// state, on two views of real Automerge docs, with real keys.
//
//   (in scene/, doom/ and machine/) pnpm build
//   [CHROME_LOCK=<dir>] node probes/world.mjs [--wad <freedoom1.wad>] [--shots <dir>] [--port 4940] [--cdp 9940]
//
// Mounts the BUILT scene tool with the BUILT doom and machine packages
// (probes/scene-probe.html?doom). Ana pastes a Doom machine doc (Freedoom's
// E1M1, one player, skill 3) into an empty scene; its session is made. Then:
//  1. "Lay out its world" (the machine's command on the cabinet) puts doom/'s
//     whole map of E1M1 beside it, a model 3 m across, carrying the trait
//     that has this machine drawn in it, and both views build and draw it;
//  2. at tick 0, on both views: every thing the map spawns at the game's
//     skill (read from the WAD's THINGS here, as P_SpawnMapThing reads them,
//     not from the engine or the extension) stands at its place, one sprite
//     each, and on the floor doom/ drew under it (a ray straight down onto
//     the map's own geometry), but the two that hang from a ceiling;
//     every door node shut, where doom/ built it;
//  3. Ana plays: P, then steers the marine through the great hall to door
//     100 by the arrow keys (her own body, read off the drawn world, says
//     where she is) and presses E (Use): on both views the door's node rises
//     2 units a tic, Doom's speed, to the 124 units doom/ built it to travel;
//     her body stays on the drawn floor, and the things that moved moved on
//     both views;
//  4. Escape: stopped, both views draw the same things at the same places
//     and the same doors;
//  5. the map moved, turned and scaled: every thing keeps its place in the
//     map's frame, on both views;
//  6. no errors. Screenshots of each moment.
// What a view shows is read from the stage (the scene graph, the map's
// content and its extras), never from the extension, which has no surface
// for probes. Prints a JSON report; exits non-zero if any check fails.
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
const SHOTS = resolve(arg("--shots", join(process.env.TMPDIR || tmpdir(), "machine-world-shots")));
const PORT = Number(arg("--port", 4940)), CDP = Number(arg("--cdp", PORT + 5000));
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

const b = await browser({ root: ROOT, port: PORT, cdp: CDP, page: "/machine/probes/scene-probe.html?doom", width: 1460, height: 580, timeout: 900_000, mounts: { "/wad": resolve(WAD) } });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], numbers: {} };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `world-${name}.png`)));

async function finish() {
  report.errors = await P("errors").catch(() => ["(page gone)"]);
  report.logs = b.logs.slice(-20);
  console.log(JSON.stringify(report, null, 2));
  b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
}

const DOOR = 100; // the door Ana opens: doom/ builds it shut at 0, to travel 124 units (doom/README.md)
const TRAVEL = 124;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

try {
  await b.waitFor("window.__ready", 120_000);
  const setupErrors = await P("errors");
  check("the page set up", setupErrors.length === 0, setupErrors);

  // ---- the machine, as scene.mjs has it
  const url = await P("machines.doom");
  await P(`paste("a", ${JSON.stringify(url)})`);
  const id = await b.waitFor(`__p.byUrl(${JSON.stringify(url)})`, 30_000);
  const session = await b.waitFor(`__p.trait("${id}")?.session`, 120_000);
  check("the pasted Doom machine is a cabinet with a session", !!id && !!session, { id, session });
  const ready = await b.waitFor(`(() => { const s = [__p.shows("a")?.["${id}"], __p.shows("b")?.["${id}"]]; return s.every((x) => x && x.tick !== null && x.shown) })()`, 180_000);
  check("both views opened it", !!ready);

  // ---- 1. its world
  const offered = await P(`commandState("a", "world", "${id}")`);
  check("the cabinet offers Lay out its world (the doom package is here)", !!offered && !offered.disabled, offered);
  await P(`run("a", "world", "${id}")`);
  const wid = await b.waitFor(`__p.worldId()`, 120_000);
  const o = wid ? await P(`object("${wid}")`) : null;
  check("a map object carries the world trait naming the cabinet, built by doom/'s source", o?.traits?.["machine.world"]?.machine === id && o?.providerId === "doom-map", o && { providerId: o.providerId, traits: o.traits, transform: o.transform });
  const drawn = await b.waitFor(`(() => { const v = [__p.worldView("a", "${wid}"), __p.worldView("b", "${wid}")]; return v.every((x) => x && x.things.length > 0) })()`, 240_000);
  check("both views built the map and draw the game in it", !!drawn);
  report.numbers.transform = o?.transform;

  const args = await b.js("window.__doomArgs");
  const spawned = await P(`spawns("E1M1", ${JSON.stringify(args)})`);
  const floors = await P(`floors("E1M1")`);
  const views = async () => [await P(`worldView("a", "${wid}")`), await P(`worldView("b", "${wid}")`)];
  // camera: above the model, looking down into the hall
  const lookAtWorld = async () => {
    const v = await P(`worldView("a", "${wid}")`);
    const [x, y, z] = [v.world[12], v.world[13], v.world[14]];
    for (const w of ["a", "b"]) await P(`setCamera("${w}", { position: [${x}, ${y + 2.6}, ${z + 2.2}], target: [${x}, ${y}, ${z}] })`);
  };
  await lookAtWorld();
  await b.step(30);

  // ---- 2. tick 0: every spawn at its place, on doom/'s floor; every door shut
  const at0 = await views();
  for (const [w, v] of [["a", at0[0]], ["b", at0[1]]]) {
    const left = [...spawned];
    const unmatched = [];
    for (const t of v.things) {
      const i = left.findIndex((s) => near(s.x, t.at[0]) && near(s.y, t.at[1]));
      if (i < 0) unmatched.push(t);
      else left.splice(i, 1);
    }
    check(`${w}: at tick 0 one sprite stands at each place the map spawns a thing at skill ${args.skill} (${spawned.length}, from the WAD's THINGS)`, v.things.length === spawned.length && !unmatched.length && !left.length, { drawn: v.things.length, spawned: spawned.length, unmatched: unmatched.slice(0, 5), missing: left.slice(0, 5) });
    const off = v.things.filter((t) => !t.floors.some((f) => near(t.at[2], f, 0.01)));
    check(`${w}: and on the floor doom/ drew under it (but the two that hang from a ceiling)`, off.length === 2 && off.every((t) => /^GOR/.test(t.lump) && t.at[2] > Math.max(...t.floors)), { off });
    const shut = v.doors.filter((d) => !near(d.y, floors[d.door], 1e-3));
    check(`${w}: every door of doom/'s map shut, where it was built`, v.doors.length === 11 && !shut.length, { doors: v.doors.length, shut });
  }
  report.numbers.tick0 = { things: at0[0].things.length, lumps: new Set(at0[0].things.map((t) => t.lump)).size, scale: at0[0].scale };
  await shot("tick0");

  // ---- 3. Ana plays: P, then steers to door 100 and uses it
  // a click on the cabinet (in Edit, a plain click selects), then P; then back to the model
  await P(`setCamera("a", { position: [0, 1.35, 1.6], target: [0, 1.3, 0] })`);
  await b.step(10);
  const front = await P(`project("a", [0, 1.0, 0.36])`);
  await b.click(front.x, front.y);
  await b.key("p");
  const tool = await P(`held("a")`);
  check("P puts the pad in Ana's hand", !!tool && /P1/.test(tool.name ?? ""), tool);
  await lookAtWorld();

  // her body: the player's sprite in a living frame (A-G: walking, firing, in pain); E1M1's dead marines are PLAYN0 and PLAYW0
  const me = async (w = "a") => (await P(`worldView("${w}", "${wid}")`)).things.find((t) => /^PLAY[A-G]/.test(t.lump ?? "")) ?? null;
  const tickOf = async (w = "a") => (await P(`shows("${w}")`))[id].tick;
  // from the player 1 start to the door: down the stairs, east along the corridor, south up to the door (a walk over E1M1's
  // lines keeping 20 units from every wall Doom won't let a player through, door 100 shut)
  const ROUTE = [[168, 256], [172, 156], [960, 152], [960, -104]];
  const TURN = (640 / 65536) * 2 * Math.PI; // a tic of turning at walking speed (input.js)
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let heading = (spawned.find((s) => s.type === 1).angle * Math.PI) / 180;
  const down = new Set();
  const hold = async (key, on) => {
    if (on && !down.has(key)) (await b.keyDown(key), down.add(key));
    if (!on && down.has(key)) (await b.keyUp(key), down.delete(key));
  };
  const walk = { frames: 0, onFloor: 0, sampled: 0, below: [], route: [] };
  let leg = 0, best = Infinity, still = 0;
  for (let f = 0; f < 2400 && leg < ROUTE.length; f++) {
    const p = await me();
    if (!p) break;
    if (f % 10 === 0) walk.route.push(p.at.map(Math.round));
    walk.sampled++;
    if (p.floors.some((f) => near(p.at[2], f, 0.01))) walk.onFloor++;
    else if (p.at[2] < Math.max(...p.floors) - 0.01) walk.below.push([...p.at.map(Math.round), await P(`sectorOf("E1M1", ${p.at[0]}, ${p.at[1]})`)]);
    const [tx, ty] = ROUTE[leg];
    const d = Math.hypot(tx - p.at[0], ty - p.at[1]);
    if (d < 14) {
      leg++;
      best = Infinity;
      continue;
    }
    if (d < best - 1) (best = d), (still = 0);
    else if (++still > 240) break; // no nearer in 4 s: stuck
    const err = wrap(Math.atan2(ty - p.at[1], tx - p.at[0]) - heading);
    const turn = Math.abs(err) > 0.07 ? Math.sign(err) : 0; // left turns counterclockwise (+)
    await hold("ArrowLeft", turn > 0);
    await hold("ArrowRight", turn < 0);
    await hold("ArrowUp", Math.abs(err) < 0.5);
    const t0 = await tickOf();
    await b.step(1);
    heading = wrap(heading + turn * TURN * Math.max(0, (await tickOf()) - t0)); // the tics stepped while the key was down
    walk.frames++;
  }
  for (const k of [...down]) await hold(k, false);
  const there = await me();
  walk.end = there?.at.map(Math.round);
  report.numbers.walk = walk;
  check("Ana walked the marine to door 100 by the keys, her body drawn where she went", leg === ROUTE.length, { leg, end: walk.end, route: walk.route.slice(-8) });
  // below it only on a lift: Doom lowers a lift the marine walks onto, and doom/ draws lifts where they rest (E1M1's 98 and 103;
  // HOST.md, Decision 40), so there the drawn floor is the lift at rest and the body is on the lift where the engine has it
  const LIFTS = [98, 103];
  walk.lift = walk.below.filter((b) => LIFTS.includes(b[3])).length;
  check("her body stood on the floor doom/ drew (down a stair it falls for a tic or two), never below it but on a lift doom/ draws at rest", walk.below.every((b) => LIFTS.includes(b[3])) && walk.onFloor / walk.sampled > 0.7, { onFloor: walk.onFloor, sampled: walk.sampled, below: walk.below.slice(0, 5), lift: walk.lift });
  await shot("walked");

  // turn to face the door (south), then use it (E)
  for (let f = 0; f < 120 && Math.abs(wrap(-Math.PI / 2 - heading)) > 0.07; f++) {
    const turn = Math.sign(wrap(-Math.PI / 2 - heading));
    await hold("ArrowLeft", turn > 0);
    await hold("ArrowRight", turn < 0);
    const t0 = await tickOf();
    await b.step(1);
    heading = wrap(heading + turn * TURN * Math.max(0, (await tickOf()) - t0));
  }
  await hold("ArrowLeft", false);
  await hold("ArrowRight", false);
  const doorOf = (v) => v.doors.find((d) => d.door === DOOR).y - floors[DOOR];
  await b.keyDown("e"); // Use (KeyE; the probe's keys have no code for Space)
  await b.step(4);
  await b.keyUp("e");
  const rise = { a: [], b: [] };
  for (let f = 0; f < 200; f++) {
    await b.step(1);
    const [va, vb] = await views();
    rise.a.push([await tickOf("a"), doorOf(va)]);
    rise.b.push([await tickOf("b"), doorOf(vb)]);
  }
  const steps = (r) => r.filter(([, y], i) => i && y !== r[i - 1][1]).map(([t, y], i) => [t, y]);
  report.numbers.door = { a: steps(rise.a).slice(0, 6), b: steps(rise.b).slice(0, 6), top: [Math.max(...rise.a.map(([, y]) => y)), Math.max(...rise.b.map(([, y]) => y))] };
  for (const w of ["a", "b"]) {
    const r = rise[w];
    const top = Math.max(...r.map(([, y]) => y));
    // Doom moves a door 2 units a tic (T_VerticalDoor, VDOORSPEED): drawn at its tic, its node is 2 units for each tic since it began, to its travel
    const ys = r.map(([, y]) => y);
    const whole = ys.every((y) => near(y / 2, Math.round(y / 2), 1e-3) || near(y, TRAVEL, 1e-3));
    const rising = ys.every((y, i) => !i || y >= ys[i - 1] - 1e-6);
    check(`${w}: door ${DOOR} rose in the drawn map as the engine opened it, 2 units a tic, to the ${TRAVEL} units doom/ built it to travel`, near(top, TRAVEL, 1e-3) && whole && rising, report.numbers.door);
  }
  // close up, on both views: the marine at the open door, from behind and above her
  const eye = await P(`toWorld("a", "${wid}", [960, 40, 120])`);
  const door = await P(`toWorld("a", "${wid}", [960, -150, 40])`);
  for (const w of ["a", "b"]) await P(`setCamera("${w}", { position: ${JSON.stringify(eye)}, target: ${JSON.stringify(door)}, near: 0.001 })`);
  await shot("door");

  // ---- 4. Escape: stopped; both views draw the same game
  await b.key("Escape");
  await b.waitFor(`(() => { const s = [__p.shows("a")?.["${id}"], __p.shows("b")?.["${id}"]]; return s.every((x) => !x.running) && s[0].tick === s[1].tick })()`, 60_000);
  await b.step(30);
  const [sa, sb] = await views();
  const key = (v) => v.things.map((t) => `${t.id}:${t.lump}:${t.at.map((x) => x.toFixed(6))}`).sort().join("|");
  const doorsKey = (v) => v.doors.map((d) => `${d.door}:${d.y.toFixed(6)}`).sort().join("|");
  check("stopped: both views draw the same things at the same places, in the same frames, and the same doors", key(sa) === key(sb) && doorsKey(sa) === doorsKey(sb), { a: sa.things.length, b: sb.things.length, doors: [doorsKey(sa), doorsKey(sb)] });
  const moved = sa.things.filter((t) => !at0[0].things.some((u) => u.id === t.id && near(u.at[0], t.at[0]) && near(u.at[1], t.at[1])));
  report.numbers.moved = { things: moved.length, lumps: [...new Set(moved.map((t) => t.lump))].slice(0, 12) };
  check("things moved in the game since tick 0, and are drawn where they went", moved.length >= 1, report.numbers.moved);

  // ---- 5. the map moved, turned and scaled: every thing keeps its place in the map's frame
  await P(`setObject("${wid}", { position: [-1.5, 0.4, 1], rotation: [0, 0.9, 0], scale: ${(o.transform.scale * 1.5).toFixed(6)} })`);
  await b.step(60);
  const [ma, mb] = await views();
  const same = (x, y) => x.things.length === y.things.length && x.things.every((t) => { const u = y.things.find((q) => q.id === t.id); return u && t.at.every((c, i) => near(c, u.at[i], 1e-4)); });
  check("the map moved, turned and scaled: every thing keeps its place in the map, on both views", same(ma, sa) && same(mb, sb) && ma.world[12] !== sa.world[12], { before: sa.world.slice(12, 15), after: ma.world.slice(12, 15), scale: [sa.scale, ma.scale] });
  await lookAtWorld();
  await shot("moved");

  const errors = await P("errors");
  const ours = errors.filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("no errors or warnings on the page", ours.length === 0, ours.slice(0, 8));
} catch (e) {
  check("the probe ran to the end", false, String(e?.stack ?? e));
}
await finish();
