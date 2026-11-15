// A running Doom drawn in doom/'s whole map (spectator.js), all finite:
// - the billboard: for every sprite shape (offsets either side, mirrored or
//   not) seen from 16 bearings at 3 heights, through map poses moved, turned
//   and scaled: it stands at the thing's feet in the map's displayed frame,
//   spans what Doom's offsets say to the viewer's left and right, faces the
//   viewer, and shows a mirrored lump right to left;
// - the doors: each door node of the map's content moved up from where it
//   was built by how far its sector's ceiling stands, and put back;
// - recorded demo states (the 4-player demo, needs the IWAD): at every
//   sampled tic (every tic in test:full) every thing the engine draws stands
//   where the engine's own record puts it, through the map's frame (worked
//   out here from the raw query and doom/'s frame rule, not doom-world.js);
//   every player's body is where the players record says; every door's
//   underside is where the engine has its sector's ceiling, and the doors
//   the bots open reach the travel doom/ builds them with.
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { compile } from "../engine.js";
import { FULL } from "../test-tier.js";
import { content, demo, MF, QUERY, level, players as decodePlayers, sectors as decodeSectors, things as decodeThings } from "../doom.js";
import { anchorOf, billboard, directory, doorAt, doomWorld, greyOf, mapLumps, mapOf } from "./doom-world.js";
import { Spectator } from "./spectator.js";

const D = Math.PI / 180;
const V = (a) => new THREE.Vector3(...a);

/** Map poses: moved, turned (about the vertical and tipped), scaled. */
const POSES = [];
for (const position of [[0, 0, 0], [2, 0.5, -1]])
  for (const yaw of [0, 30, 90, 200])
    for (const tilt of [0, 20])
      for (const scale of [1, 1 / 36]) POSES.push(new THREE.Matrix4().compose(V(position), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * D, yaw * D, 0)), V([scale, scale, scale])));

const holders = (view) => Object.fromEntries(view.group.children.map((h) => [h.userData.id, h]));
const worldOf = (o) => (o.updateMatrixWorld(true), o.matrixWorld);

describe("the billboard", () => {
  // sprite shapes, metres: Doom's offsets put the picture either side of the thing, or wholly to one side
  const SHAPES = [
    { width: 1, height: 1.5, left: 0.5, top: 1.5 },
    { width: 0.8, height: 0.6, left: 0.1, top: 1.2 },
    { width: 0.6, height: 0.4, left: -0.2, top: 0.3 },
    { width: 0.5, height: 0.5, left: 0.7, top: -0.1 },
  ];
  const image = { width: 2, height: 2, rgba: new Uint8Array(16) };

  test("at the feet in the map's frame, spanning Doom's offsets to the viewer's left and right, facing the viewer, mirrored right to left", () => {
    let cases = 0;
    for (const F of POSES)
      for (const shape of SHAPES)
        for (const flip of [false, true])
          for (let k = 0; k < 16; k++)
            for (const h of [-2, 0.3, 5]) {
              const feet = [1.25, -0.5, 3];
              const sprite = { id: 7, position: feet, lump: "TROOA1", flip, translation: 0, light: 160, shadow: false, ...shape };
              const a = (k * Math.PI) / 8 + 0.01;
              const eyeLocal = [feet[0] + 4 * Math.cos(a), feet[1] + h, feet[2] + 4 * Math.sin(a)];
              const eye = V(eyeLocal).applyMatrix4(F).toArray();
              const view = new Spectator({ THREE });
              view.draw({ world: { look: (_, at) => (expect(at.every((v, i) => Math.abs(v - eyeLocal[i]) < 1e-9)).toBe(true), [sprite]), image: () => image }, state: { things: [], sectors: [] }, frame: F.toArray(), eye });
              const holder = holders(view)[7];
              const mesh = holder.children[0];
              // the feet, through the frame
              const origin = new THREE.Vector3().setFromMatrixPosition(worldOf(holder));
              expect(origin.distanceTo(V(feet).applyMatrix4(F))).toBeLessThan(1e-9);
              // the viewer's right in the map's frame: level, square to the line of sight
              const look = V(feet).sub(V(eyeLocal)).setY(0).normalize();
              const right = new THREE.Vector3().crossVectors(look, V([0, 1, 0]));
              // the quad's four corners, in the world, against Doom's span from the feet
              const at = (u, v) => V([u, v, 0]).applyMatrix4(worldOf(mesh));
              const want = (x, y) => V(feet).addScaledVector(right, x).add(V([0, y, 0])).applyMatrix4(F);
              const [x0, x1] = [-shape.left, shape.width - shape.left];
              const [y0, y1] = [shape.top - shape.height, shape.top];
              // uv u = 0 is the picture's left edge: on the viewer's left, or on their right when mirrored
              const [uLeft, uRight] = flip ? [x1, x0] : [x0, x1];
              for (const [u, x] of [[0, uLeft], [1, uRight]])
                for (const [v, y] of [[0, y0], [1, y1]]) expect(at(u, v).distanceTo(want(x, y))).toBeLessThan(1e-9);
              // it faces the viewer: the quad's +z (its front) toward the eye, across the level
              const front = V([0, 0, 1]).transformDirection(worldOf(holder));
              const toEye = V(eye).sub(origin);
              expect(front.dot(toEye)).toBeGreaterThan(0);
              expect(Math.abs(V([1, 0, 0]).transformDirection(worldOf(holder)).dot(toEye))).toBeLessThan(1e-9);
              view.dispose();
              cases++;
            }
    expect(cases).toBe(POSES.length * SHAPES.length * 2 * 16 * 3);
  });

  test("billboard(): an eye straight above faces it north; offsets are the lump's whatever the eye", () => {
    const s = { position: [0, 0, 0], width: 1, height: 2, left: 0.25, top: 1.75, flip: true };
    expect(billboard(s, [0, 9, 0])).toEqual({ feet: [0, 0, 0], right: [-1, 0, -0], facing: [0, 0, -1], x: [-0.25, 0.75], y: [-0.25, 1.75], flip: true });
    for (const eye of [[3, 0, 0], [0, 0, -3], [-1, 5, 1]]) expect(billboard(s, eye)).toMatchObject({ x: [-0.25, 0.75], y: [-0.25, 1.75] });
  });

  test("things come and go with the engine's: a thing no longer drawn is gone, each lump decoded once per player colour", () => {
    const view = new Spectator({ THREE });
    let decoded = 0;
    const world = (things) => ({ look: () => things, image: () => (decoded++, image) });
    const thing = (id, lump, translation = 0) => ({ id, position: [id, 0, 0], lump, flip: false, translation, light: 255, shadow: false, ...SHAPES[0] });
    const F = new THREE.Matrix4().toArray();
    view.draw({ world: world([thing(1, "A"), thing(2, "A"), thing(3, "B"), thing(4, null)]), state: { sectors: [] }, frame: F, eye: [0, 1, 5] });
    expect(Object.keys(holders(view)).map(Number)).toEqual([1, 2, 3]); // no lump, not drawn
    expect(decoded).toBe(2);
    view.draw({ world: world([thing(2, "A"), thing(3, "A", 2)]), state: { sectors: [] }, frame: F, eye: [0, 1, 5] });
    expect(Object.keys(holders(view)).map(Number)).toEqual([2, 3]);
    expect(decoded).toBe(3); // "A" in player 3's colours is another picture
    expect(holders(view)[3].userData.lump).toBe("A");
    view.rest();
    expect(view.group.children).toHaveLength(0);
    view.dispose();
  });

  test("lit as doom/ lights its walls: the light level read as sRGB; a spectre dark and see-through", () => {
    const view = new Spectator({ THREE });
    const things = [0, 64, 160, 255].map((light, i) => ({ id: i, position: [0, 0, 0], lump: "A", flip: false, translation: 0, light, shadow: i === 3, ...SHAPES[0] }));
    view.draw({ world: { look: () => things, image: () => image }, state: { sectors: [] }, frame: new THREE.Matrix4().toArray(), eye: [0, 1, 5] });
    const mats = Object.values(holders(view)).map((h) => h.children[0].material);
    expect(mats.slice(0, 3).map((m) => m.color.r)).toEqual([greyOf(0), greyOf(64), greyOf(160)]);
    expect(greyOf(255)).toBe(1);
    expect(mats[3]).toMatchObject({ transparent: true, opacity: 0.45 });
    expect(mats[3].color.r).toBe(0);
    view.dispose();
  });
});

describe("the doors", () => {
  const sector = (gap, riseFloor = 0) => ({ gap, rise: { floor: riseFloor, ceiling: 0 } });

  test("each door node moves up from where it was built by doorAt(its sector); rest() and a new root put them back", () => {
    const root = new THREE.Group();
    const node = (door, y) => Object.assign(new THREE.Group(), { userData: { door } }).translateY(y);
    const doors = [node(0, 0), node(2, -3.5), node(5, 4)];
    doors.forEach((n) => root.add(n));
    const other = new THREE.Group().translateY(1); // not a door: never moved
    root.add(other);
    const view = new Spectator({ THREE });
    const none = { look: () => [], image: () => null };
    const F = new THREE.Matrix4().toArray();
    let cases = 0;
    for (const gaps of [[0, 0, 0], [1, 2, 3], [0.25, 0, 3.44]]) {
      const sectors = [sector(gaps[0]), sector(9), sector(gaps[1], 0.5), sector(9), sector(9), sector(gaps[2])];
      view.draw({ world: none, state: { things: [], sectors }, frame: F, eye: [0, 0, 0], root });
      expect(doors.map((n) => n.position.y)).toEqual([0 + doorAt(sectors[0]), -3.5 + doorAt(sectors[2]), 4 + doorAt(sectors[5])]);
      expect(other.position.y).toBe(1);
      expect(view.stats.doors).toBe(3);
      cases++;
    }
    expect(doorAt(sector(2, 0.5))).toBe(2.5); // a door's floor never moves in Doom; were it to, it still shuts to where the map has it
    view.rest();
    expect(doors.map((n) => n.position.y)).toEqual([0, -3.5, 4]);
    view.draw({ world: none, state: { things: [], sectors: [sector(1), sector(1), sector(1), sector(1), sector(1), sector(1)] }, frame: F, eye: [0, 0, 0], root });
    view.draw({ world: none, state: { things: [], sectors: [] }, frame: F, eye: [0, 0, 0], root: new THREE.Group() });
    expect(doors.map((n) => n.position.y)).toEqual([0, -3.5, 4]);
    expect(cases).toBe(3);
    view.dispose();
  });
});

// ---------------------------------------------------------------------
// Recorded demo states

const dir = new URL("../../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", dir).pathname;
const haveIwad = existsSync(iwadPath);

describe.skipIf(!haveIwad)("the 4-player demo, drawn (needs engines/doom/test/freedoom1.wad)", () => {
  const iwad = haveIwad ? readFileSync(iwadPath) : null;
  const four = haveIwad ? demo(readFileSync(new URL("bot4p.lmp", dir))) : null;
  // doom/'s plain doors in E1M1 (doom/README.md), each with its travel (doom/src/specials.js doorTop: the lowest ceiling around, less 4) and where it shuts
  const DOORS = { 10: [-128, -4], 34: [-128, -4], 48: [-128, -12], 54: [144, 212], 64: [-128, -60], 78: [-128, -4], 79: [-128, -4], 80: [-128, -4], 81: [-128, -4], 84: [0, 60], 100: [0, 124] };

  test("every thing where the engine has it, every player's body where the players record says, every door's underside at its ceiling", async () => {
    const engine = (await compile(readFileSync(new URL("../../engines/doom/dist/doom.wasm", import.meta.url)))).boot(content({ wads: [iwad], args: four.args }));
    const world = doomWorld([iwad], "E1M1");
    const lumps = mapLumps(directory(iwad), "E1M1");
    const [ax, ay] = anchorOf(lumps.VERTEXES); // doom/'s frame for its static part: the vertex bounds' middle at height 0
    expect([ax, ay]).toEqual([1272, 636]);
    // the whole map's content, as doom/ builds it: a node per door, shut at its floor, in the static part's frame
    const root = new THREE.Group();
    const nodes = Object.entries(DOORS).map(([door, [closed]]) => {
      const n = Object.assign(new THREE.Group(), { userData: { door: +door } });
      n.position.set(0.123, closed / 36, -4.56); // across, wherever doom/ puts it; up, its shut height
      root.add(n);
      return n;
    });
    const F = POSES[13]; // moved, turned, tipped, at 1/36: the frame is the map object's, whatever it is
    const view = new Spectator({ THREE });
    const every = FULL ? 1 : 105;
    const reached = {};
    let samples = 0, checked = 0;
    for (let t = 0; t < four.tics.length; t++) {
      engine.step(four.tics[t]);
      if (t % every && t !== four.tics.length - 1) continue;
      const q = { things: engine.query(QUERY.things), sectors: engine.query(QUERY.sectors) };
      expect(world.playing(level(engine.query(QUERY.level)))).toBe(true);
      const eye = V([0, 3, 0]).applyMatrix4(F).toArray();
      view.draw({ world, state: world.read(q), frame: F.toArray(), eye, root });
      const drawn = holders(view);
      const raw = decodeThings(q.things).filter((x) => !(x.flags & MF.NOSECTOR));
      expect(Object.keys(drawn).length).toBe(raw.length);
      for (const r of raw) {
        const want = V([(r.x - ax) / 36, r.z / 36, -(r.y - ay) / 36]).applyMatrix4(F);
        const got = new THREE.Vector3().setFromMatrixPosition(worldOf(drawn[r.id]));
        expect([t, r.id, got.distanceTo(want) < 1e-9]).toEqual([t, r.id, true]);
        checked++;
      }
      for (const p of decodePlayers(engine.query(QUERY.players)).filter((p) => p.ingame && p.thing)) {
        const body = drawn[p.thing];
        const feet = V([(p.x - ax) / 36, 0, -(p.y - ay) / 36]).applyMatrix4(F);
        const got = new THREE.Vector3().setFromMatrixPosition(worldOf(body));
        // the players record has the eyes (x, y, z + viewheight): across, they are the body's
        const across = (v) => v.clone().applyMatrix4(F.clone().invert()).setY(0);
        expect(across(got).distanceTo(across(feet))).toBeLessThan(1e-9);
      }
      const sec = decodeSectors(q.sectors);
      for (const n of nodes) {
        const s = n.userData.door;
        expect([t, s, Math.abs(n.position.y * 36 - sec[s].ceiling) < 1e-6]).toEqual([t, s, true]);
        reached[s] = Math.max(reached[s] ?? -Infinity, sec[s].ceiling - DOORS[s][0]);
      }
      samples++;
    }
    // the bots open doors 10 and 100 (doom.test.js): each reaches exactly the travel doom/ builds it with
    expect(reached[10]).toBe(DOORS[10][1] - DOORS[10][0]);
    expect(reached[100]).toBe(DOORS[100][1] - DOORS[100][0]);
    for (const s of Object.keys(DOORS)) if (s !== "10" && s !== "100") expect([s, reached[s]]).toEqual([s, 0]);
    expect(samples).toBe(FULL ? four.tics.length : Math.ceil(four.tics.length / every) + ((four.tics.length - 1) % every ? 1 : 0));
    expect(checked).toBeGreaterThan(samples * 200);
    view.dispose();
  });

  test("a world of another map, or between levels, isn't the game's: playing() says so; mapOf names the level as the WADs name maps", async () => {
    expect(doomWorld([iwad], "E1M2").playing({ state: "level", episode: 1, map: 1 })).toBe(false);
    expect(doomWorld([iwad], "E1M1").playing({ state: "level", episode: 1, map: 1 })).toBe(true);
    expect(doomWorld([iwad], "E1M1").playing({ state: "intermission", episode: 1, map: 1 })).toBe(false);
    expect(doomWorld([iwad], "E2M1").playing({ state: "level", episode: 1, map: 1 })).toBe(false);
    expect(mapOf([iwad], { episode: 3, map: 7 })).toBe("E3M7");
    const iwad2 = new URL("freedoom2.wad", dir).pathname;
    if (existsSync(iwad2)) {
      const w2 = readFileSync(iwad2);
      expect(mapOf([w2], { episode: 1, map: 7 })).toBe("MAP07");
      expect(doomWorld([w2], "MAP07").playing({ state: "level", episode: 1, map: 7 })).toBe(true);
      expect(doomWorld([w2], "MAP07").playing({ state: "level", episode: 1, map: 8 })).toBe(false);
    }
  });

  test("the frame is the part's say when it gives one: its anchor, its scale", () => {
    const own = doomWorld([iwad], "E1M1");
    const said = doomWorld([iwad], "E1M1", { anchor: [1000, 500, 64], unitsPerMetre: 32 });
    expect(own.anchor).toEqual([1272, 636, 0]);
    expect(said.metres([1032, 468, 96])).toEqual([1, 1, 1]);
    expect(said.units([1, 1, 1])).toEqual([1032, 468, 96]);
    // the extent: the map's vertexes across, its lowest floor to its highest ceiling
    const { min, max } = own.extent;
    expect((max[0] - min[0]) * 36).toBe(3952); // doom/'s static part is 3952 units across (source.test.js)
    expect(min[1]).toBeLessThan(0);
  });
});
