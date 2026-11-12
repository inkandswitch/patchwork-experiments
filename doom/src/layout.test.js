// Dropping a .wad file doc into a scene: what's laid out, against a stand-in
// for the drop context (STAGE.md, "Drops") that records what it's asked.
import { describe, expect, it } from "vitest";
import ext from "./extension.js";
import { aboutText, EXIT, isWad, placeIn, slideOf, SPAWN_PART, yawOf } from "./layout.js";
import { FREEDOOM_NOTICE, freedoomOrigin } from "./freedoom.js";
import { anchorOf, mapModel, thingAt } from "./parts.js";
import { emptyScene } from "./test/empty-scene.js";
import { fixture, fixtureBytes } from "./test/fixture.js";

const DOORS = [10, 34, 48, 54, 64, 78, 79, 80, 81, 84, 100];

/**
 * A drop context. `parts`: the scene:part registry it offers (id → module),
 * as the plugin registry would; a stand-in for arena's spawn point by default,
 * which puts one object as arena's part does (under its parent, in its group).
 */
function dropContext({ parts = { [SPAWN_PART]: spawnStandIn() }, d = emptyScene() } = {}) {
  const made = [];
  const asked = [];
  let n = 0;
  return {
    d,
    made,
    asked,
    ctx: {
      doc: () => d,
      repo: { create2: async (doc) => (made.push(doc), { url: `automerge:about${made.length}` }) },
      newId: (p) => `${p}${++n}`,
      change: (fn) => fn(d),
      notify: (text, kind) => made.push({ notice: text, kind }),
      registry: async (type) => (type === "scene:part" ? { load: async (id) => (asked.push(id), parts[id] ? { module: parts[id] } : undefined) } : null),
      async addObject(url, opts) {
        const id = `o${++n}`;
        d.objects[id] = { name: opts.name, sourceUrl: url, providerId: opts.render.providerId, render: opts.render, parent: opts.parent ?? null, group: opts.group ?? null, transform: opts.transform, ...opts.fields };
        d.order.push(id);
        return id;
      },
    },
  };
}
function spawnStandIn() {
  return {
    async create(ctx, at) {
      const id = ctx.newId("o");
      ctx.change((d) => {
        d.objects[id] = { name: "Spawn point", providerId: "file-glb", parent: at.parent, group: d.objects[at.parent].group, transform: at.transform, traits: { "arena.spawn": {} } };
        d.order.push(id);
      });
      return id;
    },
  };
}
const wadDoc = () => ({ "@patchwork": { type: "file" }, name: "e1m1.wad", extension: "wad", content: fixtureBytes() });
const partsOf = (d) => Object.entries(d.objects).filter(([, o]) => o.kind !== "group");

describe("dropping a WAD", () => {
  it("takes only .wad files", async () => {
    expect(isWad(wadDoc())).toBe(true);
    expect(isWad({ "@patchwork": { type: "file" }, name: "MAP.WAD" })).toBe(true);
    expect(isWad({ "@patchwork": { type: "file" }, extension: "glb" })).toBe(false);
    expect(isWad({ "@patchwork": { type: "bag" }, extension: "wad" })).toBe(false);
    const { ctx } = dropContext();
    expect(await ext.drop(ctx, { doc: { "@patchwork": { type: "file" }, extension: "stl" } })).toBe(false);
  });

  it("into an empty scene: a group, the static part, a part per door attached to it, all the same file doc; a level, and arena's spawn at the start", async () => {
    const { ctx, d, made, asked } = dropContext();
    const doc = wadDoc();
    let written = null;
    const handle = { change: (fn) => fn((written = { ...doc })) };
    expect(await ext.drop(ctx, { url: "automerge:wad", doc, handle, group: null, at: null })).toBe(true);
    const [gid, group] = Object.entries(d.objects).find(([, o]) => o.kind === "group");
    const parts = partsOf(d);
    expect(group).toMatchObject({ name: "E1M1", infoUrl: "automerge:about1", visible: true });
    const maps = parts.filter(([, o]) => o.providerId === "doom-map");
    expect(maps).toHaveLength(13);
    expect(maps.every(([, o]) => o.sourceUrl === "automerge:wad" && o.group === gid && o.locked === true)).toBe(true);
    // the params: which map, and which door or exit switch (neither: the static part); nothing else
    expect(maps.map(([, o]) => o.render.params)).toEqual([{ map: "E1M1", door: null }, ...DOORS.map((door) => ({ map: "E1M1", door })), { map: "E1M1", line: 407 }]);
    const [root] = maps[0];
    expect(parts.slice(1).every(([, o]) => o.parent === root)).toBe(true);
    expect(d.traits["arena.level"]).toEqual({ look: "sky" });
    // the start: arena's own spawn part, asked for by id, put under the map at the player 1 start, facing its way
    expect(asked).toEqual([SPAWN_PART]);
    const spawns = parts.filter(([, o]) => o.traits?.["arena.spawn"]);
    expect(spawns).toHaveLength(1);
    const m = mapModel(fixture(), "E1M1");
    const t = m.map.things[m.specials.starts.find((s) => s.player === 1).thing];
    expect(spawns[0][1]).toMatchObject({ parent: root, group: gid, transform: { position: placeIn(anchorOf(m, null), thingAt(m, m.map.things.indexOf(t))), rotation: [0, yawOf(t.angle), 0], scale: 1 } });
    // the WAD says it's Freedoom 0.13.0: its notice goes on the file doc, and in the About
    expect(written.origin).toMatchObject({ name: "Freedoom 0.13.0", notice: FREEDOOM_NOTICE });
    expect(made[0]["@patchwork"]).toEqual({ type: "markdown" });
    expect(made[0].content).toContain(FREEDOOM_NOTICE.trim());
    expect(made[0].content).toMatch(/not Freedoom, and neither the Freedoom project nor its contributors endorse it/);
    expect(made[0].content).toMatch(/Player 1 start\*\*: a spawn point/);
    expect(made[0].content).toMatch(/The exit switch\*\* \(line 407\): an object of its own, which leads wherever the scene says/);
  });

  it("the exit switch: its own object at its line, an exit with its verb and nowhere to go", async () => {
    const { ctx, d } = dropContext();
    await ext.drop(ctx, { url: "automerge:wad", doc: wadDoc(), handle: null });
    const exits = partsOf(d).filter(([, o]) => o.traits?.[EXIT]);
    expect(exits).toHaveLength(1);
    const [, exit] = exits[0];
    const m = mapModel(fixture(), "E1M1");
    const [root] = partsOf(d)[0];
    expect(exit).toMatchObject({ name: "Exit switch", parent: root, locked: true, render: { params: { map: "E1M1", line: 407 } }, transform: { position: placeIn(anchorOf(m, null), anchorOf(m, null, 407)), rotation: [0, 0, 0], scale: 1 } });
    // the verb, and no destination: where it leads is the scene's to say
    expect(exit.traits).toEqual({ [EXIT]: { verb: "Exit" } });
    // the middle of line 407 ((-400, 1296), on its floor at -120), from the map's middle
    expect(anchorOf(m, null, 407)).toEqual([-400, 1296, -120]);
  });

  it("into a scene with something in it: a piece of that scene; it leaves the scene's game alone (no level, no spawn)", async () => {
    const d = emptyScene({ objects: { boat: { name: "A boat", transform: { position: [0, 0, 0] } } }, order: ["boat"] });
    const { ctx, asked } = dropContext({ d });
    await ext.drop(ctx, { url: "automerge:wad", doc: wadDoc(), handle: null });
    expect(d.traits["arena.level"]).toBeUndefined();
    expect(asked).toEqual([]);
    expect(partsOf(d).filter(([, o]) => o.traits?.["arena.spawn"])).toEqual([]);
    expect(partsOf(d).filter(([, o]) => o.providerId === "doom-map")).toHaveLength(13);
  });

  it("without arena installed: no spawn, and nothing breaks", async () => {
    const { ctx, d, made, asked } = dropContext({ parts: {} });
    await ext.drop(ctx, { url: "automerge:wad", doc: wadDoc(), handle: null });
    expect(asked).toEqual([SPAWN_PART]);
    expect(partsOf(d)).toHaveLength(13);
    expect(made[0].content).toMatch(/No spawn point/);
  });

  it("each door's slide: up its parent's +Y by its travel in metres, at its speed, closing after Doom's wait", async () => {
    const { ctx, d } = dropContext();
    await ext.drop(ctx, { url: "automerge:wad", doc: wadDoc(), handle: null });
    const door = Object.values(d.objects).find((o) => o.name === "Door 100");
    expect(door.traits["joints.slide"]).toEqual({ axis: [0, 1, 0], stops: { closed: 0, open: +(124 / 36).toFixed(6) }, speed: +(70 / 36).toFixed(6), wait: +(150 / 35).toFixed(6), at: "closed" });
    // its place in the static part's frame: its anchor less the map's, in metres, y up, z south
    const m = mapModel(fixture(), "E1M1");
    expect(door.transform.position).toEqual(placeIn(anchorOf(m, null), anchorOf(m, 100)));
    expect(door.transform.position[1]).toBe(0);
  });

  it("a door that stays open has no wait", () => {
    expect(slideOf({ open: 72, closed: 0, speed: 70, wait: null })).toEqual({ axis: [0, 1, 0], stops: { closed: 0, open: 2 }, speed: round(70 / 36), at: "closed" });
  });

  it("the start faces the way the thing does: Doom's angle 0 is east, and an object faces its -z", () => {
    const face = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)].map((v) => Math.round(v * 1e9) / 1e9 + 0);
    expect(face(yawOf(0))).toEqual([1, 0]); // east: +x
    expect(face(yawOf(90))).toEqual([0, -1]); // north: -z
    expect(face(yawOf(180))).toEqual([-1, 0]);
    expect(face(yawOf(270))).toEqual([0, 1]);
  });
});

describe("the About", () => {
  const model = mapModel(fixture(), "E1M1");
  const about = (o) => aboutText({ fileName: "x.wad", map: "E1M1", model, origin: null, freedoom: null, start: true, ...o });

  it("a WAD that says nothing of its terms says so", () => {
    const text = about({});
    expect(text).toMatch(/x.wad says nothing of its licence/);
    expect(text).toMatch(/Lift: sectors 98, 103/);
    expect(text).toMatch(/Things: 291/);
    expect(text).not.toMatch(/not Freedoom/);
  });

  it("says it isn't Freedoom when the WAD is Freedoom's, whatever its origin is called; and only then", () => {
    expect(about({ origin: { name: "My map pack", notice: "© me" }, freedoom: "0.13.0" })).toMatch(/It is not Freedoom/);
    expect(about({ origin: { name: "Freedoom-ish", notice: "© me" }, freedoom: null })).not.toMatch(/not Freedoom/);
  });

  it("a Freedoom release whose notice isn't known here: named, its notice asked for, nothing made up", () => {
    const origin = freedoomOrigin("0.12.1");
    expect(origin.notice).toBeUndefined();
    expect(freedoomOrigin("0.13.0").notice).toBe(FREEDOOM_NOTICE);
    const text = about({ origin, freedoom: "0.12.1" });
    expect(text).toMatch(/says it is Freedoom 0.12.1, whose terms ship beside it in its release \(COPYING.txt\) and aren't known here/);
    expect(text).not.toContain("2001-2024");
  });

  it("a release with an unknown notice isn't written onto the file doc", async () => {
    const { ctx, d, made } = dropContext();
    const doc = { ...wadDoc(), content: withFreedoomVersion(fixtureBytes(), "0.12.1") };
    let wrote = false;
    await ext.drop(ctx, { url: "automerge:wad", doc, handle: { change: () => (wrote = true) } });
    expect(made.filter((m) => m.kind === "error")).toEqual([]);
    expect(partsOf(d).length).toBeGreaterThan(0);
    expect(wrote).toBe(false);
    expect(made[0].content).toMatch(/Freedoom 0.12.1/);
  });
});
const round = (x) => Math.round(x * 1e6) / 1e6;

/** The WAD with its FREEDOOM lump saying another version (same length, so nothing else moves). */
function withFreedoomVersion(bytes, version) {
  const out = new Uint8Array(bytes);
  const dv = new DataView(out.buffer);
  const n = dv.getInt32(4, true), dir = dv.getInt32(8, true);
  for (let i = 0; i < n; i++) {
    const at = dir + i * 16;
    const name = new TextDecoder().decode(out.subarray(at + 8, at + 16)).replace(/\0.*$/, "");
    if (name !== "FREEDOOM") continue;
    const pos = dv.getInt32(at, true), size = dv.getInt32(at + 4, true);
    const v = new TextEncoder().encode(version.padEnd(size, " ").slice(0, size));
    out.set(v, pos);
    return out;
  }
  throw new Error("no FREEDOOM lump");
}
