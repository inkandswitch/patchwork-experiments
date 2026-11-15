// What decides a machine's world (worlds.js), over its bounded spaces: when it
// draws, what its command says, where it is laid out, which WAD file doc it
// is drawn from, and that doom/'s map source is looked for on the registry
// as it is when asked. And, through the extension, a world's lifecycle.
import * as THREE from "three";
import { WORLD, MAP_SOURCE, WORLD_SIZE, GAP, registered, worldCommand, stateOf, besideCabinet, wadFile } from "./worlds.js";
import { content as doomContent, QUERY } from "../doom.js";
import ext from "./extension.js";

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A registry of `type` whose plugins can be added and removed after it was handed out, as Patchwork's is. */
function liveRegistry(ids = []) {
  const plugins = new Set(ids);
  return { plugins, filter: (fn) => [...plugins].map((id) => ({ id })).filter(fn) };
}

test("doom/'s map source is looked for in the registry as it is when asked: installed after the machine started, or removed later", async () => {
  const reg = liveRegistry(["something-else"]);
  const asked = [];
  const here = registered((type) => (asked.push(type), Promise.resolve(reg)), "scene:source", MAP_SOURCE);
  expect(here()).toBe(false); // the registry hasn't come yet
  await flush();
  expect(asked).toEqual(["scene:source"]);
  expect(here()).toBe(false);
  reg.plugins.add(MAP_SOURCE); // the doom package registers after the machine's extension started
  expect(here()).toBe(true);
  reg.plugins.delete(MAP_SOURCE); // and is uninstalled
  expect(here()).toBe(false);
  // a registry handed out at once, none at all, or one that fails
  const now = liveRegistry([MAP_SOURCE]);
  const sync = registered(() => now, "scene:source", MAP_SOURCE);
  await flush();
  expect(sync()).toBe(true);
  for (const registry of [undefined, () => null, () => Promise.reject(new Error("no plugins here"))]) {
    const none = registered(registry, "scene:source", MAP_SOURCE);
    await flush();
    expect(none()).toBe(false);
  }
});

// ---- the command's state

const IWAD = new Uint8Array([73, 87, 65, 68, 0, 0, 0, 0, 12, 0, 0, 0]); // "IWAD", no lumps: only its count matters here
const PWAD = new Uint8Array([80, 87, 65, 68, 0, 0, 0, 0, 12, 0, 0, 0]);
const contentOf = (wads) => doomContent({ wads, args: ["-skill", "3"] });

test("Lay out its world: offered on a Doom only, enabled only when it runs, doom/'s map source is here and the game is its IWAD alone", () => {
  const ENTRIES = {
    none: null,
    snes: { kind: "snes", m: {}, content: new Uint8Array(4) },
    "no game": { kind: null, m: null, note: "No game yet" },
    "doom starting, saying why": { kind: "doom", m: null, note: "Joining…" },
    "doom starting": { kind: "doom", m: null, note: null },
    "doom, IWAD": { kind: "doom", m: {}, content: contentOf([IWAD]) },
    "doom, IWAD and PWAD": { kind: "doom", m: {}, content: contentOf([IWAD, PWAD]) },
  };
  let cases = 0;
  for (const [what, e] of Object.entries(ENTRIES))
    for (const mapSource of [false, true]) {
      const got = worldCommand(e, mapSource);
      const want = {
        none: null,
        snes: null,
        "no game": null,
        "doom starting, saying why": { disabled: true, title: "Joining…" },
        "doom starting": { disabled: true, title: "Starting…" },
        "doom, IWAD": mapSource ? { title: expect.any(String) } : { disabled: true, title: expect.stringMatching(/doom package/) },
        "doom, IWAD and PWAD": mapSource ? { disabled: true, title: expect.stringMatching(/one WAD/) } : { disabled: true, title: expect.stringMatching(/doom package/) },
      }[what];
      expect(got, `${what}, map source ${mapSource}`).toEqual(want);
      cases++;
    }
  expect(cases).toBe(14);
});

// ---- when a world draws

/** Doom's level record (doom.js level()): state, episode, map. */
const levelBytes = (state, episode, map) => {
  const b = new Uint8Array(16);
  b[0] = ["level", "intermission"].indexOf(state);
  b[2] = episode;
  b[3] = map;
  return b;
};
const LEVELS = { none: null, "on E1M1": levelBytes("level", 1, 1), "on E1M2": levelBytes("level", 1, 2), "between levels": levelBytes("intermission", 1, 1) };
const FRAME = { map: "E1M1", anchor: [1272, 636, 0], unitsPerMetre: 36 };
/** A doomWorld of E1M1 as far as stateOf uses one: playing() and read(). */
const e1m1 = () => ({ playing: (l) => l?.state === "level" && l.episode === 1 && l.map === 1, read: (q) => ({ read: q }) });

test("a world draws exactly when its machine runs a Doom of the source it was laid out for, its map is built and says its frame, those WADs have it, and the game is on it", () => {
  const MACHINES = ["none", "snes running", "doom starting", "doom running"];
  const SOURCES = ["its machine's", "another", "none"];
  const CONTENTS = ["none", "building", "built, no frame", "built"];
  let cases = 0, drawn = 0;
  for (const machine of MACHINES)
    for (const source of SOURCES)
      for (const content of CONTENTS)
        for (const has of [true, false])
          for (const [lv, level] of Object.entries(LEVELS))
            for (const things of [null, new Uint8Array([1])])
              for (const sectors of [null, new Uint8Array([2])]) {
                const answers = { [QUERY.level]: level, [QUERY.things]: things, [QUERY.sectors]: sectors };
                const host = { query: (k) => answers[k] ?? null };
                const e = { none: null, "snes running": { kind: "snes", url: "automerge:m", m: { host } }, "doom starting": { kind: "doom", url: "automerge:m", m: null }, "doom running": { kind: "doom", url: "automerge:m", m: { host } } }[machine];
                const trait = { machine: "cab", ...(source === "none" ? {} : { source: source === "another" ? "automerge:other" : "automerge:m" }) };
                const c = { none: null, building: { loaded: false }, "built, no frame": { loaded: true, extras: {} }, built: { loaded: true, extras: { doom: FRAME } } }[content];
                const make = () => {
                  if (!has) throw new Error("no map E1M1");
                  return e1m1();
                };
                const got = stateOf({ id: "map" }, trait, e, c, make);
                const draws = machine === "doom running" && source === "its machine's" && content === "built" && has && lv === "on E1M1" && !!things && !!sectors;
                expect(got, JSON.stringify({ machine, source, content, has, lv, things: !!things, sectors: !!sectors })).toEqual(draws ? { read: { things, sectors } } : null);
                cases++;
                drawn += draws;
              }
  expect(cases).toBe(4 * 3 * 4 * 2 * 4 * 2 * 2);
  expect(drawn).toBe(1);
});

test("a world's map is read from the WADs again for another machine entry or another frame, and only then", () => {
  const host = { query: (k) => ({ [QUERY.level]: LEVELS["on E1M1"], [QUERY.things]: new Uint8Array(1), [QUERY.sectors]: new Uint8Array(1) })[k] };
  const made = [];
  const make = (e, frame) => (made.push([e.n, frame.anchor.join()]), e.n === 3 ? null : e1m1());
  const trait = { machine: "cab", source: "automerge:m" };
  const entry = (n) => ({ n, kind: "doom", url: "automerge:m", m: { host } });
  const built = (anchor) => ({ loaded: true, extras: { doom: { ...FRAME, anchor } } });
  const w = { id: "map" };
  const [one, two, three] = [entry(1), entry(2), entry(3)];
  // [entry, its map's anchor, read again?]: the same twice; the machine closed and opened again (another session of the game: another
  // entry, the same id and source); the map built again in another frame; back to one; an entry whose WADs lack the map, asked twice
  const STEPS = [[one, [1, 2, 0], true], [one, [1, 2, 0], false], [two, [1, 2, 0], true], [two, [1, 2, 0], false], [two, [5, 6, 0], true], [one, [5, 6, 0], true], [three, [5, 6, 0], true], [three, [5, 6, 0], false]];
  for (const [e, anchor, again] of STEPS) {
    const before = made.length;
    const got = stateOf(w, trait, e, built(anchor), make);
    expect(made.length - before).toBe(again ? 1 : 0);
    expect(got === null).toBe(e === three);
  }
});

// ---- where a world is laid out

test("a world is laid out beside its cabinet for every pose in a grid, scaled cabinets too: turned as it is, its near edge GAP to its right, centred front to back, its lowest floor at its feet", () => {
  const D = Math.PI / 180;
  const EXTENTS = [
    { min: [-50, -1, -40], max: [50, 3, 40] }, // wider than deep, around its frame's origin
    { min: [-10, 0.5, -80], max: [30, 4, -20] }, // deeper than wide, off to one side and above its origin
    { min: [-1, -0.2, -0.5], max: [0.5, 1, 0.5] }, // smaller than WORLD_SIZE: never enlarged
  ];
  let cases = 0;
  for (const extent of EXTENTS)
    for (const position of [[0, 0, 0], [1.6, 0.4, -2]])
      for (const yaw of [0, 30, 90, 180, 270])
        for (const pitch of [0, 20])
          for (const s of [1, 0.5, 2]) {
            const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, yaw * D, 0));
            const at = new THREE.Matrix4().compose(new THREE.Vector3(...position), turn, new THREE.Vector3(s, s, s));
            const t = besideCabinet(THREE, at.toArray(), extent);
            const side = Math.max(extent.max[0] - extent.min[0], extent.max[2] - extent.min[2]);
            expect(t.scale).toBeCloseTo(Math.min(1, WORLD_SIZE / side), 12);
            const placed = new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation));
            expect(placed.angleTo(turn)).toBeLessThan(1e-6); // (acos near 1 is good to about 1e-8) // turned as the cabinet is, whatever its scale
            // the map's box, through its transform, in the cabinet's frame without its scale (to a micrometre: decompose and the Euler lose some bits)
            const map = new THREE.Matrix4().compose(new THREE.Vector3(...t.position), placed, new THREE.Vector3(t.scale, t.scale, t.scale));
            const cabinet = new THREE.Matrix4().compose(new THREE.Vector3(...position), turn, new THREE.Vector3(1, 1, 1)).invert();
            const box = new THREE.Box3();
            for (const x of [extent.min[0], extent.max[0]])
              for (const y of [extent.min[1], extent.max[1]])
                for (const z of [extent.min[2], extent.max[2]]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(map).applyMatrix4(cabinet));
            expect(box.min.x).toBeCloseTo(GAP * s, 6); // its near edge GAP to the right, as far as the cabinet is big
            expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
            expect(box.min.y).toBeCloseTo(0, 6); // its lowest floor at the cabinet's feet
            expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeCloseTo(Math.min(WORLD_SIZE, side), 6);
            cases++;
          }
  expect(cases).toBe(3 * 2 * 5 * 2 * 3);
});

// ---- the WAD a world is drawn from

/** A repo of plain docs that counts what it makes; `fail` makes the next create fail. */
function plainRepo() {
  let n = 0;
  const repo = { docs: {}, fail: false };
  repo.create2 = async (value) => {
    await Promise.resolve();
    if (repo.fail) throw ((repo.fail = false), new Error("offline"));
    repo.docs[`automerge:f${++n}`] = value;
    return { url: `automerge:f${n}` };
  };
  return repo;
}

test("a world's WAD file doc: one a world of the same game already uses, else one made for the machine, however often the command runs", async () => {
  const content = contentOf([IWAD]);
  const SCENES = {
    empty: [{}, null],
    "a world of this game": [{ w1: { sourceUrl: "automerge:wad1", traits: { [WORLD]: { machine: "cab", source: "automerge:m" } } } }, "automerge:wad1"],
    "a world of a copy of the cabinet (one source)": [{ w2: { sourceUrl: "automerge:wad2", traits: { [WORLD]: { machine: "copy", source: "automerge:m" } } } }, "automerge:wad2"],
    "a world of this cabinet's game before it was given another": [{ w3: { sourceUrl: "automerge:old", traits: { [WORLD]: { machine: "cab", source: "automerge:before" } } } }, null],
    "something else": [{ x: { sourceUrl: "automerge:x", traits: { other: {} } } }, null],
  };
  for (const [what, [objects, reuse]] of Object.entries(SCENES)) {
    const repo = plainRepo();
    const api = { repo, scene: () => ({ objects }) };
    const e = { id: "cab", url: "automerge:m", content };
    // three clicks at once, then one more
    const urls = [...(await Promise.all([wadFile(api, e, "freedoom1"), wadFile(api, e, "freedoom1"), wadFile(api, e, "freedoom1")])), await wadFile(api, e, "freedoom1")];
    expect(new Set(urls).size, what).toBe(1);
    if (reuse) {
      expect(urls[0]).toBe(reuse);
      expect(Object.keys(repo.docs)).toEqual([]);
    } else {
      expect(Object.keys(repo.docs)).toEqual([urls[0]]);
      expect(repo.docs[urls[0]]).toMatchObject({ "@patchwork": { type: "file" }, name: "freedoom1.wad", extension: "wad" });
      expect([...repo.docs[urls[0]].content]).toEqual([...IWAD]);
    }
  }
  // a file doc that couldn't be made is tried again next time
  const repo = plainRepo();
  repo.fail = true;
  const api = { repo, scene: () => ({ objects: {} }) };
  const e = { id: "cab", url: "automerge:m", content };
  await expect(wadFile(api, e)).rejects.toThrow("offline");
  expect(await wadFile(api, e)).toBe("automerge:f1");
});

// ---- a world's lifecycle, through the extension

test("each object with the world trait has a world drawn in the machines' layer, as built while its machine isn't here; gone with the trait, or the extension", () => {
  const layer = new THREE.Group();
  let objects = { w1: { sourceUrl: "automerge:wad", traits: { [WORLD]: { machine: "gone", source: "automerge:m" } } }, plain: { sourceUrl: "automerge:x", traits: {} } };
  let snap = { objects };
  const api = { THREE, world: () => layer, labels: () => ({ set() {} }), scene: () => snap, loop: () => () => {}, listen: () => {}, root: null, collect: () => [], content: () => null, worldOf: () => null };
  const instance = ext.create(api);
  const names = () => layer.children.map((c) => c.name).sort();
  expect(names()).toEqual(["machine.world:w1"]);
  expect(layer.getObjectByName("machine.world:w1").children.filter((c) => c.visible && c.name.startsWith("thing:"))).toEqual([]); // as built: nothing drawn
  expect(instance.commands.find((c) => c.id === "world").state("w1")).toBe(null); // a map is no machine
  // another world added, the first's trait taken off
  const prev = snap;
  objects = { w1: { ...objects.w1, traits: {} }, w2: { sourceUrl: "automerge:wad", traits: { [WORLD]: { machine: "gone", source: "automerge:m" } } } };
  snap = { objects };
  instance.update(snap, {}, { scene: prev });
  expect(names()).toEqual(["machine.world:w2"]);
  instance.dispose();
  expect(names()).toEqual([]);
});
