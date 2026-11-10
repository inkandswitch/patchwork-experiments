// What each view dresses for itself: floats on the waves, the sail's belly
// and how far it's raised. The pure maths, then createLooks on a fake stage.
import { describe, it, expect, afterEach } from "vitest";
import { createOcean } from "./ocean.js";
import { FLAT, LOOK, boomToPort, createLooks, floatPose, fullness, ropeIndex, ropeTube } from "./looks.js";
import { createSeaView } from "./sea-view.js";
import { FLOAT, JIB, SAIL, SEA, SHIP, WINCH } from "./traits.js";
import { composeMatrix, fakeNode, fakeThree, fakeWorld } from "./test/fakes.js";
import { parseGLB } from "./glb.js";
import { jibFit, partGLB } from "./ship.js";
import { clothCount, clothVertices } from "./cloth.js";
import { flutterOf, furledClewAt, mainsheetSlack, rigGeometry, trimModelOf, trimOf } from "./trim.js";
import { swungCE } from "./rig-sails.js";

const DEG = Math.PI / 180;

describe("floating", () => {
  const sea = createOcean({ wind: { speed: 9, from: 30 }, seed: 4 });

  it("rides up and down with the water where it's moored", () => {
    const m = composeMatrix({ position: [5, 0, -7], rotation: [0, 0, 0] });
    for (const t of [0, 1.3, 4.2]) {
      const { offset } = floatPose(sea, m, t);
      expect(offset[1]).toBeCloseTo(sea.heightAt(5, -7, t), 6);
      expect(Math.abs(offset[0]) + Math.abs(offset[2])).toBeLessThan(1e-12);
    }
  });

  it("tilts with the slope, in its own frame, and not at all on a flat sea", () => {
    const flat = createOcean({ wind: { speed: 0, from: 0 } });
    expect(floatPose(flat, composeMatrix({ position: [1, 0, 1] }), 3).tilt.map(Math.abs)).toEqual([0, 0]);
    // turned half round, the same water tilts it the other way in its frame
    const t = 2.1;
    const a = floatPose(sea, composeMatrix({ position: [3, 0, 3] }), t).tilt;
    const b = floatPose(sea, composeMatrix({ position: [3, 0, 3], rotation: [0, Math.PI, 0] }), t).tilt;
    expect(b[0]).toBeCloseTo(-a[0], 6);
    expect(b[1]).toBeCloseTo(-a[1], 6);
    // scaled up, the same rise is fewer of its own units
    const big = floatPose(sea, composeMatrix({ position: [3, 0, 3], scale: 2 }), t);
    expect(big.offset[1]).toBeCloseTo(sea.heightAt(3, 3, t) / 2, 6);
  });
});

describe("the sail", () => {
  it("the boom is to port when the rig's aft axis points to the hull's port side, as drawn", () => {
    const hull = composeMatrix({ position: [0, 0, 0], rotation: [0, 1, 0] });
    const rig = (boom) => composeMatrix({ position: [0, 2, 0], rotation: [0, 1 + boom, 0] });
    expect(boomToPort(hull, rig(-0.5))).toBe(true);
    expect(boomToPort(hull, rig(0.5))).toBe(false);
    expect(boomToPort(hull, rig(0))).toBe(false);
  });

  it("is drawn full when the wind meets it, flat while it luffs, and between on the way", () => {
    // beam reach: wind from 90° to starboard, boom out 60° to port: drawing hard
    expect(fullness({ apparentWind: { angle: 90 * DEG }, boom: -60 * DEG })).toBe(1);
    // head to wind, the boom along the wind: flogging
    expect(fullness({ apparentWind: { angle: 2 * DEG }, boom: 1 * DEG })).toBe(FLAT);
    const mid = fullness({ apparentWind: { angle: 30 * DEG }, boom: -20 * DEG });
    expect(mid).toBeGreaterThan(FLAT);
    expect(mid).toBeLessThan(1);
    expect(fullness(null)).toBe(1);
  });
});

describe("the sheets' rope", () => {
  const S = LOOK.rope.sides, R = LOOK.rope.radius;
  const at = (a, k) => [a[3 * k], a[3 * k + 1], a[3 * k + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // a straight run, a sagging sheet, a hairpin, one turning back on its own axis, and one with two points on top of each other
  const lines = {
    straight: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
    sag: Array.from({ length: 16 }, (_, i) => [i / 5, -4 * 0.3 * (i / 15) * (1 - i / 15), 0.1 * i]),
    vertical: [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
    hairpin: [[0, 0, 0], [1, 0, 0], [1.2, 0.1, 0], [1, 0.2, 0], [0, 0.2, 0]],
    doubled: [[0, 0, 0], [1, 0, 0], [1, 0, 0], [2, 1, 0]],
  };

  for (const [name, line] of Object.entries(lines)) {
    it(`${name}: each ring is radius out from its point, square to the line there, its normals the unit way out, and every triangle faces out`, () => {
      const n = line.length;
      const pts = Float64Array.from(line.flat());
      const pos = new Float64Array(3 * n * S), nrm = new Float64Array(3 * n * S);
      ropeTube(pos, nrm, pts, n, R, S);
      expect([...pos, ...nrm].every(Number.isFinite)).toBe(true);
      for (let i = 0; i < n; i++) {
        const c = line[i];
        const t = sub(line[Math.min(n - 1, i + 1)], line[Math.max(0, i - 1)]);
        const tl = Math.hypot(...t);
        for (let j = 0; j < S; j++) {
          const v = at(pos, i * S + j), u = at(nrm, i * S + j);
          expect(Math.hypot(...u)).toBeCloseTo(1, 9);
          const r = sub(v, c);
          for (let k = 0; k < 3; k++) expect(r[k]).toBeCloseTo(R * u[k], 9);
          if (tl > 1e-9) expect(Math.abs(dot(u, t) / tl)).toBeLessThan(1e-9);
        }
      }
      // every triangle's normal points away from the line: along the mean of its corners' outward normals
      const I = ropeIndex(n, S);
      expect(I.length).toBe(6 * S * (n - 1));
      expect(Math.max(...I)).toBe(n * S - 1);
      for (let f = 0; f < I.length; f += 3) {
        const [a, b, c] = [I[f], I[f + 1], I[f + 2]];
        const ring = Math.floor(Math.min(a, b, c) / S);
        if (Math.hypot(...sub(line[ring + 1], line[ring])) < 1e-9) continue; // a doubled point's run: no length, so no outside
        const face = cross(sub(at(pos, b), at(pos, a)), sub(at(pos, c), at(pos, a)));
        const out = [0, 1, 2].map((k) => nrm[3 * a + k] + nrm[3 * b + k] + nrm[3 * c + k]);
        expect(dot(face, out)).toBeGreaterThan(0);
      }
    });
  }

  it("a line not drawn yet (every point at the origin) is a finite ring of radius round it", () => {
    const n = 16;
    const pos = new Float64Array(3 * n * S), nrm = new Float64Array(3 * n * S);
    ropeTube(pos, nrm, new Float64Array(3 * n), n, R, S);
    expect([...pos, ...nrm].every(Number.isFinite)).toBe(true);
    for (let v = 0; v < n * S; v++) expect(Math.hypot(...at(pos, v))).toBeCloseTo(R, 12);
  });
});

describe("createLooks", () => {
  let w;
  afterEach(() => w?.done());

  const object = (extra) => ({ name: "Object", parent: null, group: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });

  it("bobs what floats on the clock the sea is drawn at, and puts it back on dispose", () => {
    const doc = {
      objects: { buoy: object({ name: "Buoy", transform: { position: [8, 0, -20], rotation: [0, 0.3, 0], scale: 1 }, traits: { [FLOAT]: {} } }), rock: object({ name: "Rock" }) },
      order: ["buoy", "rock"],
      traits: { [SEA]: { wind: { speed: 8, from: 90 }, seed: 2, scale: 1 } },
      view: {},
    };
    const root = fakeNode();
    const rock = fakeNode();
    w = fakeWorld(doc, { content: { buoy: { loaded: true, root }, rock: { loaded: true, root: rock } } });
    const api = w.join("A");
    const sea = createSeaView(api);
    const looks = createLooks(api, { sea, sim: { ships: () => [] } });
    api.loop((dt, now) => {
      sea.tick(dt, now, false, null);
      looks.tick(dt);
    });
    w.tick(1 / 60, 45);
    const expected = floatPose(sea.ocean, api.worldOf("buoy"), sea.clock());
    expect(root.position.y).toBeCloseTo(expected.offset[1], 9);
    expect(root.rotation.x).toBeCloseTo(expected.tilt[0], 9);
    expect(root.position.y).not.toBe(0);
    expect(rock.position.y).toBe(0);
    looks.dispose();
    expect(root.position.y).toBe(0);
    expect(root.rotation.x).toBe(0);
  });
});


// ─── the trim dressing on a stub stage (DESIGN.md "Trim feedback" §4) ───────

/** A part's GLB as the stage shows it: its extras, and its named nodes as meshes with their own geometry (positions, normals). */
function contentOf(kind, names) {
  const { json, bin } = parseGLB(partGLB(kind).bytes);
  const read = (acc) => {
    const a = json.accessors[acc];
    const v = json.bufferViews[a.bufferView];
    const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Float32Array(bin.buffer.slice(off, off + a.count * 12));
  };
  const geometryOf = (p) => {
    const attr = (array) => ({ array, count: array.length / 3, needsUpdate: false });
    const g = { attributes: { position: attr(read(p.attributes.POSITION)), normal: attr(read(p.attributes.NORMAL)) } };
    g.clone = () => {
      const c = geometryOf(p);
      c.cloned = true;
      return c;
    };
    g.dispose = () => (g.disposed = true);
    return g;
  };
  const nodes = {};
  for (const name of names) {
    const node = json.nodes.find((n) => n.name === name);
    const meshes = json.meshes[node.mesh].primitives.map((p) => ({ isMesh: true, geometry: geometryOf(p), children: [] }));
    const n = fakeNode();
    n.children = meshes;
    n.add = (o) => n.children.push(o);
    n.remove = (o) => n.children.splice(n.children.indexOf(o), 1);
    nodes[name] = n;
  }
  const root = fakeNode(nodes);
  return { loaded: true, root, extras: json.scenes[0].extras };
}

/** The stock sloop on a stub stage: her hull at the origin, her rig and jib held at the read's angles, a read the test can change in place. */
function stockStage({ burgee = false } = {}) {
  const rig = contentOf("rig", ["Sail", "Bunt"]);
  const jib = contentOf("jib", ["Jib", "Roll"]);
  const contract = rig.extras.rig;
  const models = Object.fromEntries(contract.sails.map((x) => [x.id, trimModelOf(x)]));
  const read = {
    boom: -0.5,
    jib: -0.3,
    velocity: [0, 0, -3],
    spin: [0, 0, 0],
    apparentWind: { speed: 8, angle: 0.8 },
    sails: [
      { id: "main", main: true, angle: -0.5, limit: 0.5, from: 0.9, alpha: 10, sheet: 28.6, area: 30, q: 40 },
      { id: "jib", main: false, angle: -0.3, limit: 0.3, from: 0.8, alpha: 12, sheet: 17.2, area: 25, q: 40 },
    ],
  };
  const values = { rig: { raised: 1, sheet: 0.5 }, jib: { sheet: 0.5, held: null, furl: 0 } };
  const objects = {
    ship: { traits: { [SHIP]: { burgee } }, sourceUrl: "automerge:hull" },
    rig: { traits: { [SAIL]: {} } },
    jib: { traits: { [JIB]: {} } },
    wp: { traits: { [WINCH]: { side: "port" } } },
    ws: { traits: { [WINCH]: { side: "starboard" } } },
  };
  const scene = { objects, ids: Object.keys(objects), parents: new Map(["rig", "jib", "wp", "ws"].map((id) => [id, "ship"])) };
  const fit = jibFit();
  // the stage's world matrices, written in place (the stage's, not the looks', allocation): the rig and jib turned about their Y by the read
  const F = composeMatrix({ position: fit.position, rotation: fit.rotation });
  const A = rig.extras.sail.at.position;
  const rigM = new Float64Array(16), jibM = new Float64Array(16);
  const turned = (out, base, th) => {
    const c = Math.cos(th), sn = Math.sin(th);
    // base · R_y(θ): columns x' = c·x − s·z, z' = s·x + c·z
    for (let r = 0; r < 4; r++) {
      const x = base[r], y = base[4 + r], z = base[8 + r];
      out[r] = c * x - sn * z;
      out[4 + r] = y;
      out[8 + r] = sn * x + c * z;
      out[12 + r] = base[12 + r];
    }
    return out;
  };
  const RIG0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, A[0], A[1], A[2], 1];
  const worlds = {
    ship: composeMatrix(null),
    get rig() {
      return turned(rigM, RIG0, read.boom);
    },
    get jib() {
      return turned(jibM, F, read.jib);
    },
    wp: composeMatrix({ position: [-0.95, 1.2, 2.25] }),
    ws: composeMatrix({ position: [0.95, 1.2, 2.25] }),
  };
  const world = new (fakeThree().Group)();
  const content = { rig, jib };
  const api = {
    THREE: fakeThree(),
    scene: () => scene,
    doc: () => ({ assets: { "sailing/hull@4": { url: "automerge:hull" } } }),
    content: (id) => content[id] ?? null,
    worldOf: (id) => worlds[id] ?? null,
    world: () => world,
  };
  let clock = 0;
  const wind = { at: (x, z, t, out = [0, 0]) => ((out[0] = -3), (out[1] = 5), out) };
  const ctx = {
    sea: { ocean: null, wind, clock: () => clock },
    sim: {
      ships: () => ["ship"],
      stationsOf: () => ({ sail: "rig", jib: "jib", winches: ["wp", "ws"] }),
      read: () => read,
      value: (id) => values[id],
      sailModels: () => models,
    },
  };
  return { api, ctx, read, values, rig, jib, world, contract, models, worlds, setClock: (t) => (clock = t) };
}

describe("the trim dressing: the drawn cloth and lines are the pure functions of the read", () => {
  it("the main's and the jib's cloth are clothVertices of trimOf, the sheets' slack and the flutter, exactly", () => {
    const st = stockStage();
    const looks = createLooks(st.api, st.ctx);
    st.setClock(3.7);
    looks.tick();
    const G = rigGeometry(st.contract);
    for (const [name, content, node, id] of [["main", st.rig, "Sail", "main"], ["jib", st.jib, "Jib", "jib"]]) {
      const s = st.read.sails.find((x) => x.id === id);
      const tr = trimOf(s, st.models[id]);
      const cloth = content.extras.sail.cloth;
      let slack;
      if (id === "main") slack = mainsheetSlack(G.main, st.read.boom, s.limit);
      else slack = 0; // the jib at its sheet's limit: taut
      const f = flutterOf({}, G[id].foot, s.q, slack);
      const expected = clothVertices(new Float32Array(clothCount(cloth) * 3), cloth, { belly: tr.belly, flog: tr.flog, sigma: tr.sigma, reef: 0, furl: 0, flat: 1, amp: f.amp, freq: f.freq }, 3.7);
      const mesh = content.root.getObjectByName(node).children[0];
      expect(mesh.geometry.cloned, name).toBe(true);
      expect(mesh.geometry.attributes.position.array, name).toEqual(expected);
      expect(mesh.geometry.attributes.position.needsUpdate).toBe(true);
    }
    looks.dispose();
  });

  it("the mainsheet runs from the boom's sheet point, where the physics swings it, to the traveller; the jib's from the drawn clew, which is the physics' clew", () => {
    const st = stockStage();
    const looks = createLooks(st.api, st.ctx);
    looks.tick();
    const G = rigGeometry(st.contract);
    const group = st.world.children[0];
    const [mainsheet, port, stbd] = group.children;
    const pts = mainsheet.geometry.attributes.position.array;
    const B = swungCE([0, 0, 0], { pivot: G.main.pivot, axis: G.main.axis }, G.main.boom, st.read.boom);
    for (let k = 0; k < 3; k++) expect(pts[k]).toBeCloseTo(B[k], 5);
    for (let k = 0; k < 3; k++) expect(pts[3 * 15 + k]).toBeCloseTo(G.main.traveller[k], 5);
    // the jib's clew as drawn, flog 0 here, is the furled clew swung by read.jib about the luff
    const clew = swungCE([0, 0, 0], { pivot: G.jib.pivot, axis: G.jib.axis }, furledClewAt([0, 0, 0], G.jib, 0), st.read.jib);
    const working = st.read.jib < 0 ? port : stbd;
    const w = working.geometry.attributes.position.array;
    for (let k = 0; k < 3; k++) expect(w[k]).toBeCloseTo(clew[k], 5);
    // the working sheet is taut (at its limit): a straight line; the lazy one sags
    // point 8 of 16 against the straight line's point at u = 8/15
    const mid = (a) => [0, 1, 2].map((k) => a[24 + k] - (a[k] + (8 / 15) * (a[45 + k] - a[k])));
    expect(Math.hypot(...mid(w))).toBeLessThan(0.02);
    const lazy = (st.read.jib < 0 ? stbd : port).geometry.attributes.position.array;
    expect(mid(lazy)[1]).toBeLessThan(-0.05);
    // and on to its winch's drum
    expect(w[3 * 16]).toBeCloseTo(-0.95, 6);
    // each sheet wears its rope: ropeTube of the line it's on, exactly
    const ropes = [mainsheet, port, stbd].map((l) => {
      expect(l.children).toHaveLength(1);
      const rope = l.children[0];
      const a = l.geometry.attributes.position.array;
      const n = a.length / 3;
      const want = ropeTube(new Float32Array(3 * n * LOOK.rope.sides), new Float32Array(3 * n * LOOK.rope.sides), a, n, LOOK.rope.radius, LOOK.rope.sides);
      expect([...rope.geometry.attributes.position.array]).toEqual([...want]);
      expect(rope.geometry.attributes.position.needsUpdate).toBe(true);
      expect(rope.geometry.index).toEqual(ropeIndex(n, LOOK.rope.sides));
      return rope;
    });
    looks.dispose();
    expect(st.world.children.length).toBe(0);
    for (const r of ropes) expect(r.geometry.disposed).toBe(true);
    expect(ropes[0].material.disposed).toBe(true);
  });

  it("reefed, the cloth comes down and the bunt swells; furled, the jib's hidden and its roll is 0.08; dispose puts every geometry back", () => {
    const st = stockStage();
    const looks = createLooks(st.api, st.ctx);
    const sail = st.rig.root.getObjectByName("Sail");
    const original = sail.children[0].geometry;
    st.values.rig.raised = 0.7;
    looks.tick();
    // the one-sided cloth casts but doesn't take shadows (the stage keeps the flag across a toggle)
    for (const m of [sail.children[0], st.jib.root.getObjectByName("Jib").children[0]]) {
      expect(m.userData.receiveShadow).toBe(false);
      expect(m.receiveShadow).toBe(false);
    }
    const bunt = st.rig.root.getObjectByName("Bunt");
    expect(bunt.visible).toBe(true);
    expect(bunt.scale.x * 0.02).toBeCloseTo(0.02 + 0.08 * Math.sqrt(0.3), 9);
    st.values.rig.raised = 0;
    st.values.jib.furl = 1;
    looks.tick();
    expect(sail.visible).toBe(false);
    expect(st.jib.root.getObjectByName("Jib").visible).toBe(false);
    expect(st.jib.root.getObjectByName("Roll").scale.x * 0.02).toBeCloseTo(0.08, 9);
    looks.dispose();
    expect(sail.children[0].geometry).toBe(original);
    expect(sail.children[0].userData.receiveShadow).toBeUndefined();
    expect(sail.visible).toBe(true);
  });

  it("the burgee is drawn only when her trait asks", () => {
    for (const burgee of [false, true]) {
      const st = stockStage({ burgee });
      const looks = createLooks(st.api, st.ctx);
      looks.tick();
      const lines = st.world.children[0].children;
      expect(lines.length).toBe(5);
      expect(lines[4].visible).toBe(burgee);
      looks.dispose();
    }
  });
});

describe("allocation (13)", () => {
  it("warmed, 600 frames of dressing a sloop make no new arrays and keep every buffer", () => {
    const st = stockStage({ burgee: true });
    const looks = createLooks(st.api, st.ctx);
    looks.tick();
    const buffers = () => [
      ...st.rig.root.getObjectByName("Sail").children.map((m) => m.geometry?.attributes?.position?.array),
      ...st.jib.root.getObjectByName("Jib").children.map((m) => m.geometry?.attributes?.position?.array),
      ...st.world.children[0].children.map((l) => l.geometry.attributes.position.array),
    ];
    const before = buffers();
    let made = 0;
    const where = [];
    const counted = (C) => new Proxy(C, { construct: (t, args, nt) => (made++, where.length < 3 && where.push(new Error().stack.split("\n").slice(2, 5).join(" | ")), Reflect.construct(t, args, nt)) });
    const saved = { Array, Float32Array, Float64Array };
    globalThis.Array = counted(Array);
    globalThis.Float32Array = counted(Float32Array);
    globalThis.Float64Array = counted(Float64Array);
    try {
      for (let i = 0; i < 600; i++) {
        // her trim changes as she goes: flogging, drawing, stalled, backed, reefed and furled by turns
        const k = i / 600;
        const main = st.read.sails[0], jib = st.read.sails[1];
        st.read.boom = main.angle = -0.2 - 0.6 * k;
        main.limit = 0.3 + 0.5 * Math.abs(Math.sin(i / 40));
        main.alpha = -4 + 40 * k;
        st.read.jib = jib.angle = i % 200 < 100 ? -0.3 : 0.25;
        jib.sheet = i % 200 < 100 ? 17 : -14;
        jib.limit = 0.25 + 0.3 * k;
        st.values.rig.raised = 1 - 0.4 * k;
        st.values.jib.furl = 0.3 * k;
        st.setClock(i / 60);
        looks.tick();
      }
    } finally {
      Object.assign(globalThis, saved);
    }
    expect(made, where.join("\n")).toBe(0);
    const after = buffers();
    expect(after.length).toBe(before.length);
    after.forEach((b, i) => expect(b).toBe(before[i]));
    looks.dispose();
  });
});
