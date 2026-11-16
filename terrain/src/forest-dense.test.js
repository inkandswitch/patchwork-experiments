// The dense forest near where people look (a place's trees.skin.all, scrub and bands) and its tiles:
// every claim checked at every node of a made-up place, and for every split into tiles.
import { describe, it, expect } from "vitest";
import { treesAt, skinAt, clumpOf, skinZone, beyondCircles, standHere, isForest, isRoof, skinInstances, skinMesh, tileInstances, treeMesh, standMesh, STAND_BASE, SKIN_LAYOUTS, SKIN_PROFILES, CLUMP_SINK, SPECIES_NAMES } from "./forest.js";
import { encodeGLB, parseGLB } from "./glb.js";
import { COVER } from "./cover.js";

// a made-up 41 × 41 place: water down the west; a wood with patchy second growth (holes and a 3–5 m clearing),
// a town lot under trees, a yard, a bog
const n = 41, cell = 20, x0 = -400, z0 = -400, N = n * n;
const grid = { n, cell, x0, z0 };
const label = new Int8Array(N), cover = new Uint8Array(N), canopy = new Float32Array(N), dist = new Float32Array(N);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const k = j * n + i;
  label[k] = i < 6 ? -1 : 1;
  dist[k] = i < 6 ? 0 : (i - 5) * cell;
  if (label[k] < 0) continue;
  cover[k] = j > 32 ? COVER.residential : i > 34 && j < 5 ? COVER.yard : j < 4 && i < 14 ? COVER.wetland : (i + j) % 7 === 0 ? COVER.none : COVER.wood;
  // patchy: every fifth node in a diagonal pattern under 5 m, a clearing of 3–5 m scrub, the town's lots 6–9 m
  canopy[k] = i >= 18 && i <= 22 && j >= 12 && j <= 16 ? 3 + ((i + j) % 3) : i > 26 && (i * 3 + j * 2) % 5 === 0 ? 2 : 6 + ((i * 7 + j * 3) % 22);
}
const trees = {
  fringe: { spruce: 45, hemlock: 25, cedar: 20, pine: 10 },
  inland: { hemlock: 50, cedar: 35, spruce: 10, alder: 5 },
  town: { alder: 100 },
  wetland: { pine: 100 },
  fringeWidth: 40,
  roofSetback: 20,
  townPerHectare: 80,
  stands: [4, 6],
  skin: { crowns: [3, 4], all: true, scrub: { min: 3 } },
  bands: { stands: -60, edges: 100, fringe: 200 },
};
// one circle round the middle, one reaching in from the south-west
const circles = [{ x: 0, z: 0, radius: 260 }, { x: -300, z: 380, radius: 120 }];
const zone = skinZone(grid, circles);
const beyond = beyondCircles(grid, circles);
const o = { grid, label, cover, canopy, dist, trees, zone, beyond };
const so = { grid, label, cover, canopy, dist, zone, skin: trees.skin, setback: 20, trees, beyond };
const allTrees = treesAt(o);
const allClumps = skinAt(so);

describe("beyondCircles", () => {
  it("is each node's distance beyond the nearest circle's rim, negative inside (every node)", () => {
    for (let k = 0; k < N; k++) {
      const i = k % n, j = (k - i) / n, x = x0 + i * cell, z = z0 + j * cell;
      const want = Math.min(...circles.map((c) => Math.hypot(x - c.x, z - c.z) - c.radius));
      expect(beyond[k]).toBeCloseTo(want, 3);
      expect(beyond[k] <= 0).toBe(!!zone[k]);
    }
    expect(beyondCircles(grid, []).every((b) => b === Infinity)).toBe(true);
  });
});

describe("where the skin covers all the forest", () => {
  const treesBy = new Map(), clumpsBy = new Map();
  for (const t of allTrees) treesBy.set(t.k, [...(treesBy.get(t.k) ?? []), t]);
  for (const c of allClumps) {
    expect(clumpsBy.has(c.k)).toBe(false);
    clumpsBy.set(c.k, c);
  }
  it("gives every forest node in the zone exactly one source of crowns: a stand at the water or a clump, never both, never neither (every node)", () => {
    let stands = 0, low = 0, roof = 0;
    for (let k = 0; k < N; k++) {
      if (!zone[k] || !isForest(k, label, cover, canopy)) continue;
      const t = treesBy.get(k) ?? [], c = clumpsBy.get(k);
      if (standHere(k, o)) {
        expect(t).toHaveLength(1);
        expect(t[0].crowns).toBeGreaterThanOrEqual(4);
        expect(c).toBeUndefined();
        stands++;
      } else {
        expect(t).toEqual([]);
        expect(c).toBeDefined();
        if (isRoof(k, { n, label, cover, canopy, dist, setback: 20 })) (expect(c.profile).toBeUndefined(), roof++);
        else (expect(c.profile).toBe("low"), low++);
      }
    }
    // each case occurs
    expect(stands).toBeGreaterThan(3);
    expect(low).toBeGreaterThan(10);
    expect(roof).toBeGreaterThan(10);
  });
  it("puts shore pine and salal where the canopy is 3 to 5 m on wild ground or a lot in the zone, and nothing on a node under 3 m (every node)", () => {
    let some = 0;
    for (let k = 0; k < N; k++) {
      const c = clumpsBy.get(k);
      const scrubby = [COVER.none, COVER.wood, COVER.scrub, COVER.wetland, COVER.residential].includes(cover[k]);
      const want = !!zone[k] && label[k] > 0 && canopy[k] >= 3 && canopy[k] <= 5 && scrubby;
      expect(c?.profile === "scrub").toBe(want);
      if (want) some++;
      if (canopy[k] < 3) expect(c).toBeUndefined();
      if (c) expect(c.height).toBeGreaterThanOrEqual(2);
    }
    expect(some).toBeGreaterThan(5);
  });
  it("puts no clump outside the zone, and none where built", () => {
    for (const c of allClumps) expect(zone[c.k]).toBe(1);
    expect(skinAt({ ...so, built: new Uint8Array(N).fill(1) })).toEqual([]);
  });
  it("is the roof's skin alone where the skin isn't `all` and has no scrub (as before)", () => {
    const plain = skinAt({ ...so, skin: { crowns: [3, 4] } });
    for (let k = 0; k < N; k++) expect(plain.some((c) => c.k === k)).toBe(!!zone[k] && isRoof(k, { n, label, cover, canopy, dist, setback: 20 }));
    expect(plain.every((c) => !c.profile)).toBe(true);
  });
  it("is local: tile by tile is the whole, for the trees and the clumps (every split into rows of tiles)", () => {
    for (const rows of [1, 3, 8, 41]) {
      const t = [], c = [];
      for (let j0 = 0; j0 < n; j0 += rows) {
        t.push(...treesAt(o, j0 * n, Math.min(n, j0 + rows) * n));
        c.push(...skinAt(so, j0 * n, Math.min(n, j0 + rows) * n));
      }
      expect(t).toEqual(allTrees);
      expect(c).toEqual(allClumps);
    }
  });
  it("clumpOf names each node's clump as skinAt places it (every node)", () => {
    for (let k = 0; k < N; k++) expect(clumpOf(k, { ...so, n }) ?? undefined).toBe(clumpsBy.has(k) ? clumpsBy.get(k).profile ?? "roof" : undefined);
  });
});

describe("the bands: detail falling off beyond the circles", () => {
  it("stands only within `stands` of the circles, edge trees within `edges`, the fringe's single trees within `fringe`, then none (every tree)", () => {
    for (const t of allTrees) {
      if (!isForest(t.k, label, cover, canopy)) continue;
      if (t.crowns) expect(beyond[t.k]).toBeLessThanOrEqual(trees.bands.stands);
      if (dist[t.k] > trees.fringeWidth) expect(beyond[t.k]).toBeLessThanOrEqual(trees.bands.edges);
      else expect(beyond[t.k]).toBeLessThanOrEqual(trees.bands.fringe);
    }
  });
  it("leaves every forest node within the bands what it had without them, and those beyond nothing (every node)", () => {
    const noBands = treesAt({ ...o, trees: { ...trees, bands: undefined } });
    for (let k = 0; k < N; k++) {
      if (!isForest(k, label, cover, canopy) || zone[k]) continue;
      const fringe = dist[k] <= trees.fringeWidth;
      const was = noBands.filter((t) => t.k === k), now = allTrees.filter((t) => t.k === k);
      if (beyond[k] > (fringe ? trees.bands.fringe : trees.bands.edges)) expect(now).toEqual([]);
      // a fringe node outside the stands' band: a tree or two where it had a stand (no `bands`: every fringe node's a stand)
      else if (!(fringe && was[0]?.crowns && !standHere(k, o))) expect(now).toEqual(was);
      else expect(now.every((t) => !t.crowns)).toBe(true);
    }
  });
});

describe("the clumps' meshes and instances", () => {
  it("draws every profile's crowns from just above its foot to its top, 12 triangles each (every profile and layout)", () => {
    for (const p of Object.keys(SKIN_PROFILES)) for (const c of [3, 4]) for (let v = 0; v < SKIN_LAYOUTS[c].length; v++) {
      const m = skinMesh(c, v, cell, undefined, p);
      expect(m.positions.length / 9).toBe(12 * c);
      let lo = Infinity, hi = -Infinity;
      for (let q = 1; q < m.positions.length; q += 3) (lo = Math.min(lo, m.positions[q])), (hi = Math.max(hi, m.positions[q]));
      expect(lo).toBeCloseTo(SKIN_PROFILES[p].foot * Math.min(...SKIN_LAYOUTS[c][v].map((x) => x[2])), 6);
      expect(hi).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
  it("sinks a low or scrub clump's foot into the ground, keeping its top, and a roof clump's not (every clump)", () => {
    const inst = skinInstances(allClumps, () => 10, { meshBase: 0, cell });
    allClumps.forEach((c, q) => {
      const nd = inst.nodes[q];
      const sink = c.profile ? CLUMP_SINK : 0;
      expect(nd.translation[1]).toBeCloseTo(10 - sink, 2);
      expect(nd.translation[1] + nd.scale[1]).toBeCloseTo(10 + c.height, 1);
      expect(inst.kinds[nd.mesh]).toBe(`${c.profile ? `${c.profile}:` : ""}${c.crowns}/${c.variant}`);
    });
  });
  it("keeps a stand's lowest crown within STAND_BASE of its foot (no bare trunks at the shore), every species", () => {
    for (const s of SPECIES_NAMES) {
      const one = treeMesh(s, -0.2, STAND_BASE), st = standMesh(s, 5);
      // the crown's lowest vertices (the foliage's colour) start at STAND_BASE at most
      const foliage = one.colors.slice(one.colors.length - 3);
      let low = Infinity;
      for (let v = 0; v < one.positions.length; v += 3) if (one.colors[v] === foliage[0] && one.colors[v + 1] === foliage[1] && one.colors[v + 2] === foliage[2]) low = Math.min(low, one.positions[v + 1]);
      expect(low).toBeLessThanOrEqual(STAND_BASE + 1e-6);
      expect(st.positions.length).toBe(one.positions.length * 5);
    }
  });
});

describe("tileInstances", () => {
  // nodes on four kinds of mesh (base 5), tiles by a made-up rule
  const nodes = Array.from({ length: 60 }, (_, q) => ({ mesh: 5 + (q % 4), translation: [q, 0, -q], scale: [1, q % 7, 1] }));
  const tileOf = (q) => `t${Math.floor(q / 13) % 3}`;
  const cut = tileInstances(nodes, { meshBase: 5, meshCount: 4, names: ["a", "b", "c", "d"] }, tileOf);
  it("keeps every node, in order, as it was but for its mesh (the union of the tiles is the whole)", () => {
    expect(cut.nodes).toHaveLength(nodes.length);
    cut.nodes.forEach((nd, q) => {
      const { mesh, ...rest } = nd;
      const { mesh: was, ...had } = nodes[q];
      expect(rest).toEqual(had);
      // its mesh is its kind's, or a copy of it
      expect(mesh === was || cut.meshes[mesh - 9].sameAs === was).toBe(true);
    });
  });
  it("gives each (kind, tile) its own mesh and every node of it that mesh (every pair of nodes)", () => {
    for (let a = 0; a < nodes.length; a++) for (let b = 0; b < nodes.length; b++) {
      const same = nodes[a].mesh === nodes[b].mesh && tileOf(a) === tileOf(b);
      expect(cut.nodes[a].mesh === cut.nodes[b].mesh).toBe(same);
    }
    expect(cut.tiles).toBe(3);
    // four kinds in three tiles: the four originals and eight copies
    expect(cut.meshes).toHaveLength(8);
  });
  it("encodes a copy as accessors of its own on the original's bytes", () => {
    const tri = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], colors: [1, 0, 0, 1, 0, 0, 1, 0, 0] };
    const { json } = parseGLB(encodeGLB({ meshes: [tri, { name: "copy", sameAs: 0 }], nodes: [{ mesh: 0 }, { mesh: 1 }] }));
    const [a, b] = json.meshes.map((m) => m.primitives[0]);
    expect(b.attributes.POSITION).not.toBe(a.attributes.POSITION);
    expect(json.accessors[b.attributes.POSITION]).toEqual(json.accessors[a.attributes.POSITION]);
    expect(json.accessors[b.attributes.COLOR_0].bufferView).toBe(json.accessors[a.attributes.COLOR_0].bufferView);
    expect(json.bufferViews.length).toBe(2);
    expect(() => encodeGLB({ meshes: [{ sameAs: 0 }] })).toThrow(/earlier mesh/);
  });
});
