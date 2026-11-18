import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { partGeometry } from "./shapes.js";
import { boundsOf, connectorsOf, drawer, lookKey } from "./look/look.js";
import { turned } from "./look/slab.js";
import { ensurePieceGLBs } from "./pieces.js";
import { composePose, copyPose, isCard, kindsUsed, LOOSE, shuffle, tableLayout, writeTable } from "./setup.js";
import { prepareTable } from "./table/made-with.js";
import { composeMatrix, multiply } from "./table/frame.js";
import { TabletopGameDatatype } from "./datatype.js";
import { gameOf, writeGame } from "./game.js";
import { emptyScene } from "./empty-scene.js";
import { parseGLB } from "./glb.js";
import { encodePNG } from "./test/png.js";
import { nodeImages } from "./test/node-images.js";
import { BAG, SEATS, inBag, keptIn, registries, seatsPlugin, sourcePlugin } from "./test/stand-ins.js";
import { fakeRepo, game as builtIn, seeded } from "./test/games.js";

// the seats owner's lay, and a keeper's bind, as the registry would give them (test/stand-ins.js)
const lay = (await seatsPlugin().load()).lay;
const bindTo = (url) => (slot) => ({ "keep.plain": { by: url, slot } });

async function newGame(repo, id = "santorini") {
  const init = {};
  TabletopGameDatatype.init(init);
  const h = await repo.create2(init);
  h.change((d) => writeGame(d, builtIn(id)));
  return h;
}

/** Each kind's GLB as the game page has it: the game's own doc, its box as the hint. */
const gameFiles = (doc) => (kind) => {
  const f = doc?.drawn?.[kind];
  return f?.url ? { url: f.url, hint: f.bounds ? { bounds: f.bounds } : null } : null;
};
/** Every kind's GLB at a made-up URL, with a made-up box (a card's is 1 mm thick). */
const fakeFiles = (game) => (kind) => ({ url: `automerge:${kind}`, hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, isCard(game, kind) || Object.values(game.pieces).some((p) => p.back === kind) ? 0.001 : 0.01, 0.04] } } });

/** An empty scene doc, as tool.js writes a table onto. */
const skeleton = () => emptyScene({ title: "T" });

/**
 * The game page's table: the layout, and the scene writeTable makes of it
 * with each container at "automerge:deck-<key>", bound by a stand-in
 * keeper's trait, and the seats laid by a stand-in owner.
 */
function setUp(game, fileOf, o = {}) {
  const layout = tableLayout(game, { fileOf, ...o });
  const binds = Object.fromEntries(Object.keys(layout.containers).map((k) => [k, bindTo(`automerge:deck-${k}`)]));
  const scene = skeleton();
  writeTable(scene, layout, { binds, seats: lay });
  return { layout, scene, containers: layout.containers, binds };
}

const loadGLB = (glb) => new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");
const draw = (piece, io) => drawer(io).draw(piece);

describe("shapes", () => {
  it("a box stands on its base centre", () => {
    const b = boundsOf([partGeometry({ shape: "box", size: [2, 1, 4], at: [1, 0.5, 0] })]);
    expect(b).toEqual({ min: [0, 0.5, -2], max: [2, 1.5, 2] });
  });

  it("a box's faces point outward", () => {
    const { positions, normals } = partGeometry({ shape: "box", size: [1, 1, 1] });
    for (let i = 0; i < positions.length; i += 3) {
      const c = [positions[i], positions[i + 1] - 0.5, positions[i + 2]];
      expect(c[0] * normals[i] + c[1] * normals[i + 1] + c[2] * normals[i + 2]).toBeGreaterThan(0);
    }
  });

  it("a lathe turns its profile, with outward normals and sharp rims", () => {
    const g = partGeometry({ shape: "lathe", profile: [[0, 0], [1, 0], [1, 2], [0, 2]], segments: 8 });
    expect(boundsOf([g])).toEqual({ min: [-1, 0, expect.closeTo(-1, 6)], max: [1, 2, expect.closeTo(1, 6)] });
    for (let i = 0; i < g.positions.length; i += 3) {
      const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
      const [nx, ny, nz] = [g.normals[i], g.normals[i + 1], g.normals[i + 2]];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
      if (Math.abs(ny) < 1e-6) expect(x * nx + z * nz).toBeGreaterThan(0);
      else expect(Math.sign(ny)).toBe(y > 1 ? 1 : -1);
    }
  });
});

describe("a look, drawn", () => {
  it("merges parts of one colour into one mesh, and skips unknown shapes", async () => {
    const { glb } = await draw({ name: "P", parts: [
      { shape: "box", size: [1, 1, 1], color: "#FF0000" },
      { shape: "box", size: [1, 1, 1], at: [2, 0, 0], color: "#ff0000" },
      { shape: "box", size: [1, 1, 1], color: "#00ff00" },
      { shape: "teapot", color: "#0000ff" },
    ] });
    const { json } = parseGLB(glb);
    expect(json.meshes).toHaveLength(2);
    expect(json.accessors[json.meshes[0].primitives[0].indices].count).toBe(72);
  });

  it("places a part at its `at`, turned by its `rotation` about it", async () => {
    // a 2 × 1 × 1 box standing at x = 1, turned a quarter about Y: its length now runs along z
    const { bounds } = await draw({ name: "P", parts: [{ shape: "box", size: [2, 1, 1], at: [1, 0, 0], rotation: [0, Math.PI / 2, 0], color: "#ffffff" }] });
    expect(bounds.min.map((v) => +v.toFixed(5))).toEqual([0.5, 0, -1]);
    expect(bounds.max.map((v) => +v.toFixed(5))).toEqual([1.5, 1, 1]);
  });

  it("each image turn moves the reading frame's corners where it says: four turns, four corners", () => {
    // the reading frame's top-left (0, 0) shows which pixel of a turned image
    expect(turned(0, 0, 0)).toEqual([0, 0]);
    expect(turned(0, 0, 90)).toEqual([0, 1]); // turned clockwise, the image's bottom-left is at the face's top-left
    expect(turned(0, 0, 180)).toEqual([1, 1]);
    expect(turned(0, 0, 270)).toEqual([1, 0]);
    // and four quarter turns come back: for every corner
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      let p = [u, v];
      for (let k = 0; k < 4; k++) p = turned(p[0], p[1], 90);
      expect(p).toEqual([u, v]);
    }
  });

  /** A w × h PNG: the left half red, the right half blue, the top row's alpha `topAlpha`. */
  const png = (w, h, topAlpha = 255) => {
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(x < w / 2 ? [255, 0, 0, y ? 255 : topAlpha] : [0, 0, 255, y ? 255 : topAlpha], (y * w + x) * 4);
    return encodePNG(w, h, px);
  };
  const files = (map) => async (url) => map[url] ?? null;

  it("a slab carries its images on top and bottom, cropped to their cells, and says where they came from", async () => {
    const images = nodeImages();
    const sheet = { content: png(8, 4), mimeType: "image/png", extension: "png", origin: { urls: ["https://example.org/sheet.png"] } };
    const read = files({ "automerge:sheet": sheet });
    const out = await draw(
      { name: "Card", parts: [{ shape: "slab", outline: "rect", size: [0.06, 0.09], thickness: 0.001, color: "#eeeeee", top: { file: "automerge:sheet", rect: [0, 0, 0.5, 1] }, bottom: { file: "automerge:sheet", rect: [0.5, 0, 0.5, 1], turn: 180 } }] },
      { read, images },
    );
    const { json } = parseGLB(out.glb);
    expect(json.images).toHaveLength(2);
    // each cell cropped once, the left half and the right
    expect(images.log.crops.map((c) => [c.sx, c.sw])).toEqual([[0, 4], [4, 4]]);
    expect(out.origins).toEqual(["https://example.org/sheet.png"]);
    expect(out.bounds).toEqual({ min: [-0.03, 0, -0.045], max: [0.03, 0.001, 0.045] });
    // the sides are a mesh of their own, untextured
    const textured = json.meshes.filter((m) => m.primitives[0].attributes.TEXCOORD_0 != null);
    expect(textured).toHaveLength(2);
  });

  it("a slab whose image is missing is drawn in its colour, with a note; a missing image never fails a drawing", async () => {
    const out = await draw({ name: "Tile", parts: [{ shape: "slab", outline: "hex", size: [0.05, 0.05], thickness: 0.004, color: "#336699", top: { file: "automerge:gone" } }] }, { read: files({}), images: nodeImages() });
    expect(out.notes).toEqual(["missing image: automerge:gone"]);
    expect(parseGLB(out.glb).json.images ?? []).toHaveLength(0);
  });

  it("a cut-out slab follows its image: a round one is a disc, any other alpha-masked without sides", async () => {
    // a disc: opaque inside a circle, clear outside
    const W = 32;
    const px = new Uint8Array(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px.set([200, 50, 50, Math.hypot(x + 0.5 - W / 2, y + 0.5 - W / 2) < W / 2 - 1 ? 255 : 0], (y * W + x) * 4);
    const disc = { content: encodePNG(W, W, px), mimeType: "image/png", extension: "png" };
    const notch = { content: png(8, 8, 0), mimeType: "image/png", extension: "png" };
    const io = { read: files({ "automerge:disc": disc, "automerge:notch": notch }), images: nodeImages() };
    const triangles = (json) => json.meshes.reduce((n, m) => n + json.accessors[m.primitives[0].indices].count / 3, 0);
    const round = parseGLB((await draw({ name: "T", parts: [{ shape: "slab", outline: "cutout", size: [0.03, 0.03], thickness: 0.003, color: "#ffffff", top: { file: "automerge:disc" } }] }, io)).glb).json;
    const cut = parseGLB((await draw({ name: "T", parts: [{ shape: "slab", outline: "cutout", size: [0.03, 0.03], thickness: 0.003, color: "#ffffff", top: { file: "automerge:notch" } }] }, io)).glb).json;
    // the disc: a 48-sided top, bottom and sides; the cut-out: two squares, no sides, both faces masked (its bottom shows its top's image)
    expect(triangles(round)).toBe(48 * 4);
    expect(triangles(cut)).toBe(4 + 4);
    expect(cut.materials.map((m) => m.alphaMode)).toEqual(["MASK"]);
  });

  it("a model is its OBJ through its matrix: a mirror re-winds it, so it still faces out", async () => {
    // one triangle, facing +z
    const obj = { content: "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", extension: "obj", mimeType: "text/plain" };
    const io = { read: files({ "automerge:m": obj }) };
    const facing = async (matrix) => {
      const { glb } = await draw({ name: "M", parts: [{ shape: "model", file: "automerge:m", color: "#ffffff", ...(matrix ? { matrix } : {}) }] }, io);
      const gltf = await loadGLB(glb);
      const mesh = gltf.scene.children[0];
      const p = mesh.geometry.getAttribute("position");
      const i = mesh.geometry.getIndex();
      const v = [0, 1, 2].map((k) => [p.getX(i.getX(k)), p.getY(i.getX(k)), p.getZ(i.getX(k))]);
      const e1 = v[1].map((x, k) => x - v[0][k]);
      const e2 = v[2].map((x, k) => x - v[0][k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      return { n, xs: v.map((q) => q[0]) };
    };
    expect((await facing(null)).n[2]).toBeGreaterThan(0);
    // mirrored in z: it now faces −z, and its winding says so
    expect((await facing([1, 0, 0, 0, 1, 0, 0, 0, -1])).n[2]).toBeLessThan(0);
    // mirrored in x and scaled: x runs the other way, and it still faces +z
    const m = await facing([-2, 0, 0, 0, 2, 0, 0, 0, 2]);
    expect(Math.min(...m.xs)).toBeCloseTo(-2, 6);
    expect(m.n[2]).toBeGreaterThan(0);
  });

  it("a model that can't be read is a see-through stand-in, with a note", async () => {
    const out = await draw({ name: "M", parts: [{ shape: "model", file: "automerge:gone", color: "#ffffff" }] }, { read: files({}) });
    expect(out.notes).toEqual(["missing model: automerge:gone"]);
    expect(parseGLB(out.glb).json.materials[0].alphaMode).toBe("BLEND");
  });

  it("a piece given as a document is drawn by what draws its type, as it draws it; with nothing to draw it, a stand-in", async () => {
    const die = { name: "Die", doc: { "@patchwork": { type: "die" }, shape: "d6" } };
    const src = await sourcePlugin("die").load();
    const out = await draw(die, { source: async (type) => (type === "die" ? src : null) });
    expect(new TextDecoder().decode(out.glb)).toBe(`glb of ${JSON.stringify(die.doc)}`);
    expect(out.bounds).toEqual({ min: [-0.01, 0, -0.01], max: [0.01, 0.02, 0.01] });
    const none = await draw(die, {});
    expect(none.notes).toEqual(["nothing installed here draws a “die”: drawn as a stand-in"]);
    expect(parseGLB(none.glb).json.meshes).toHaveLength(1);
  });

  it("a look's key is everything it's drawn from, and nothing else", () => {
    const p = builtIn("santorini").pieces.blue;
    const k = lookKey(p);
    expect(lookKey({ ...p, name: "Another name", locked: true, tags: ["x"], zone: { min: [0, 0, 0], max: [1, 1, 1] } })).toBe(k);
    expect(lookKey({ ...p, parts: [{ ...p.parts[0], color: "#ff0000" }] })).not.toBe(k);
    expect(lookKey({ ...p, snapPoints: [{ position: [0, 0, 0] }] })).not.toBe(k);
    expect(lookKey({ ...p, snapRadius: 0.1 })).not.toBe(k);
  });
});

describe("piece GLBs", () => {
  it("Santorini's board carries its 25 spaces as snap points on the scene", async () => {
    const { glb, bounds } = await draw(builtIn("santorini").pieces.board);
    const gltf = await loadGLB(glb);
    expect(gltf.scene.userData.connectors).toHaveLength(25);
    expect(gltf.scene.userData.connectors).toContainEqual({ position: [0.06, 0.04, -0.12] });
    expect(bounds.max[1]).toBeCloseTo(0.04);
  });

  it("a snap point's frame and tags become its connector's", () => {
    expect(connectorsOf([{ position: [1, 2, 3] }, { position: [0, 0, 1], rotation: [0, 0.5, 0], tags: ["card"] }, { position: [0, 0, 2], tags: [] }])).toEqual([
      { position: [1, 2, 3] },
      { position: [0, 0, 1], rotation: [0, 0.5, 0], tags: ["card"] },
      { position: [0, 0, 2] },
    ]);
  });

  it("Lost Cities' board and hand tray carry card-only connectors", async () => {
    const { pieces } = builtIn("lost-cities");
    for (const kind of ["board", "hand"]) {
      const gltf = await loadGLB((await draw(pieces[kind])).glb);
      const connectors = gltf.scene.userData.connectors;
      expect(connectors.length).toBe(pieces[kind].snapPoints.length);
      for (const c of connectors) expect(c.tags).toEqual(["card"]);
    }
  });

  it("every piece of every built-in game stands on y = 0", async () => {
    for (const id of ["santorini", "lost-cities", "draw-dominoes-2"]) for (const p of Object.values(builtIn(id).pieces)) expect((await draw(p)).bounds.min[1]).toBeCloseTo(0, 6);
  });

  it("draws each kind once and redraws it in place when its look changes", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    expect((await ensurePieceGLBs(repo, game)).drawn).toBe(8);
    const blue = game.doc().drawn.blue;
    expect(repo.docs.get(blue.url)).toMatchObject({ "@patchwork": { type: "file" }, extension: "glb", name: "Blue worker.glb" });
    expect(blue.key).toBe(lookKey(game.doc().pieces.blue));
    expect((await ensurePieceGLBs(repo, game)).drawn).toBe(0);

    const before = repo.docs.get(blue.url).content;
    game.change((d) => (d.pieces.blue.parts[0].color = "#ff0000"));
    expect((await ensurePieceGLBs(repo, game)).drawn).toBe(1);
    expect(game.doc().drawn.blue.url).toBe(blue.url);
    expect(repo.docs.get(blue.url).content).not.toEqual(before);
    // the name isn't the look: no redraw
    game.change((d) => (d.pieces.blue.name = "Azure worker"));
    expect((await ensurePieceGLBs(repo, game)).drawn).toBe(0);
    // the game itself is untouched by drawing: drawn is beside it
    expect(Object.keys(gameOf(game.doc())).sort()).toEqual(["about", "format", "pieces", "players", "seats", "setup", "title", "version"]);
  });

  it("a game of many kinds is drawn in a few changes to the game, not one a kind, saying how far it has got", async () => {
    // an imported game has a thousand kinds (Terraforming Mars: 1368); a change a kind redrew the game
    // page a thousand times, each time over the whole game (probes/setup-bench.mjs)
    const repo = fakeRepo();
    const game = await repo.create2({});
    const kinds = Array.from({ length: 120 }, (_, i) => `k${i}`);
    game.change((d) => {
      TabletopGameDatatype.init(d);
      for (const k of kinds) d.pieces[k] = { name: k, parts: [{ shape: "box", size: [0.01, 0.01, 0.01], color: "#ffffff" }] };
    });
    let changes = 0;
    const change = game.change;
    game.change = (fn) => (changes++, change(fn));
    const progress = [];
    expect((await ensurePieceGLBs(repo, game, { onProgress: (done, total) => progress.push([done, total]) })).drawn).toBe(120);
    expect(changes).toBe(3); // 50, 50, 20
    expect(Object.keys(game.doc().drawn).sort()).toEqual([...kinds].sort());
    expect(progress[0]).toEqual([0, 120]);
    expect(progress.at(-1)).toEqual([120, 120]);
    expect(progress.map(([d]) => d)).toEqual(Array.from({ length: 121 }, (_, i) => i));

    // a drawing that fails part way still records what it drew: no GLB doc is left unnamed
    game.change((d) => {
      d.drawn = {};
    });
    const create2 = repo.create2;
    let made = 0;
    repo.create2 = async (doc) => {
      if (++made > 70) throw new Error("the repo is full");
      return create2(doc);
    };
    await expect(ensurePieceGLBs(repo, game)).rejects.toThrow("the repo is full");
    expect(Object.keys(game.doc().drawn)).toHaveLength(70);
  });

  it("a GLB drawn from file docs carries their origin: provenance travels with what's drawn", async () => {
    const repo = fakeRepo();
    const sheet = await repo.create2({ "@patchwork": { type: "file" }, name: "s.png", extension: "png", mimeType: "image/png", content: encodePNG(2, 2, new Uint8Array(16).fill(255)), origin: { urls: ["https://example.org/s.png"] } });
    const g = await repo.create2({});
    g.change((d) => {
      TabletopGameDatatype.init(d);
      d.pieces.tile = { name: "Tile", parts: [{ shape: "slab", outline: "rect", size: [0.05, 0.05], thickness: 0.004, color: "#ffffff", top: { file: sheet.url } }] };
      d.pieces.plain = { name: "Plain", parts: [{ shape: "box", size: [0.01, 0.01, 0.01], color: "#ffffff" }] };
    });
    await ensurePieceGLBs(repo, g, { images: nodeImages() });
    expect(repo.docs.get(g.doc().drawn.tile.url).origin).toEqual({ urls: ["https://example.org/s.png"] });
    expect(repo.docs.get(g.doc().drawn.plain.url).origin).toBeUndefined();
  });
});

describe("poses", () => {
  // positions are kept to the micrometre
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  /** A pose's matrix, for comparing poses that may be written two ways. */
  const M = (p) => composeMatrix({ position: p.position, rotation: p.rotation ?? [0, 0, 0], scale: 1 });

  it("a pose inside another is the product of the two, for every quarter turn of each about every axis", () => {
    const quarters = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const rotations = [];
    for (const x of quarters) for (const y of quarters) for (const z of quarters) rotations.push([x, y, z]);
    let n = 0;
    for (const or of rotations)
      for (const lr of rotations) {
        const outer = { position: [0.1, 0.2, -0.3], rotation: or };
        const local = { position: [0.05, -0.01, 0.02], rotation: lr };
        expect(close(M(composePose(outer, local)), multiply(M(outer), M(local)))).toBe(true);
        n++;
      }
    expect(n).toBe(64 * 64);
  });

  it("a level pose turned by a level one adds its numbers exactly", () => {
    expect(composePose({ position: [1, 0, 0], rotation: [0, Math.PI, 0] }, { position: [0.5, 0, 0], rotation: [0, 0, Math.PI] })).toEqual({ position: [0.5, 0, 0], rotation: [0, Math.PI, Math.PI], scale: 1 });
    expect(composePose({ position: [0, 0, 0.5] }, { position: [0, 0, 0] })).toEqual({ position: [0, 0, 0.5], rotation: [0, 0, 0], scale: 1 });
  });

  it("a grid lays copies out across and down from `at`, in the thing's own frame", () => {
    const t = { piece: "x", count: 5, at: { position: [1, 0, 2] }, grid: { cols: 3, across: [0.1, 0, 0], down: [0, 0.01, -0.2] } };
    expect([0, 1, 2, 3, 4].map((i) => copyPose(t, i).position)).toEqual([[1, 0, 2], [1.1, 0, 2], [1.2, 0, 2], [1, 0.01, 1.8], [1.1, 0.01, 1.8]]);
    const turnedGrid = { ...t, at: { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] } };
    expect(copyPose(turnedGrid, 1).position).toEqual([0, 0, -0.1]);
  });
});

describe("setting up a table", () => {
  it("makes a scene with every piece, grouped by thing, everything not fixed carryable", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    await ensurePieceGLBs(repo, game);
    const { scene } = setUp(gameOf(game.doc()), gameFiles(game.doc()), { gameUrl: game.url });
    const objects = Object.values(scene.objects);
    const pieces = objects.filter((o) => o.kind !== "group");
    expect(pieces).toHaveLength(1 + 22 + 18 + 14 + 18 + 6);
    expect(objects.filter((o) => o.kind === "group").map((g) => g.name)).toContain("Level 1 (22)");
    expect(scene.order).toHaveLength(objects.length);
    expect(scene.view).toMatchObject({ snap: true, start: { home: { position: expect.any(Array), target: expect.any(Array) } } });
    for (const o of pieces) expect([o.name, !!o.traits?.["scene.carry"]]).toEqual([o.name, !o.locked]);
    expect(pieces.some((o) => o.locked)).toBe(true);
    // Santorini's three seats: people start in the seat body (watching from Blue's, until they sit)
    expect(scene.view.start.body).toBe("seat");
    const board = pieces.find((o) => o.name === "Island board");
    expect(board).toMatchObject({ locked: true, parent: null, providerId: "file-glb", renderUrl: null, sourceUrl: game.doc().drawn.board.url, infoUrl: game.url });
    for (const p of pieces) {
      expect(p.hint.bounds.min[1]).toBeCloseTo(0, 6);
      if (p !== board) expect(scene.objects[p.group].kind).toBe("group");
    }
  });

  it("starts nothing on top of anything else", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    await ensurePieceGLBs(repo, game);
    const { scene } = setUp(gameOf(game.doc()), gameFiles(game.doc()));
    const boxes = Object.values(scene.objects)
      .filter((o) => o.kind !== "group")
      .map((o) => {
        const [x, , z] = o.transform.position;
        const b = o.hint.bounds;
        return { name: o.name, x0: x + b.min[0], x1: x + b.max[0], z0: z + b.min[2], z1: z + b.max[2] };
      });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) throw new Error(`${a.name} overlaps ${b.name}`);
      }
  });

  it("refuses a piece that hasn't been drawn", () => {
    expect(() => tableLayout(builtIn("santorini"), { fileOf: () => null })).toThrow(/no GLB/);
  });

  it("Santorini is untagged and holds nothing: no containers or bags; three seats, by the workers' colours, each looking across the island from its workers' side", () => {
    const g = builtIn("santorini");
    const t = setUp(g, fakeFiles(g));
    expect(Object.values(t.scene.objects).some((o) => "tags" in o)).toBe(false);
    expect([t.containers, t.layout.bags]).toEqual([{}, {}]);
    expect(Object.fromEntries(Object.entries(t.layout.seats).map(([id, s]) => [id, s.name]))).toEqual({ p1: "Blue", p2: "Cream", p3: "Grey" });
    // each seat's camera is on the side its workers start, looking at the island
    const start = (piece) => g.setup.find((x) => x.piece === piece).at.position;
    for (const [sid, piece] of [["p1", "blue"], ["p2", "cream"], ["p3", "grey"]]) {
      const { position, target } = t.layout.seats[sid].camera;
      const side = start(piece);
      expect(position[0] * side[0] + position[2] * side[2], sid).toBeGreaterThan(0);
      expect(Math.hypot(target[0], target[2]), sid).toBeLessThan(0.1);
    }
  });

  it("asks for each kind it shows, the backs included, and no other", () => {
    const lc = builtIn("lost-cities");
    expect(kindsUsed(lc).sort()).toEqual(Object.keys(lc.pieces).sort());
    const asked = new Set();
    tableLayout(lc, { fileOf: (k) => (asked.add(k), { url: `automerge:${k}`, hint: null }) });
    expect([...asked].sort()).toEqual(kindsUsed(lc).sort());
    const sa = builtIn("santorini");
    sa.setup = sa.setup.filter((t) => t.piece !== "dome");
    expect(kindsUsed(sa)).not.toContain("dome");
  });

  it("copies a game's origin onto its table, and its piece traits onto every copy", () => {
    const g = builtIn("santorini");
    g.origin = { tts: { saveName: "S", fileName: "1.json", workshopId: "1" } };
    g.pieces.dome.traits = { "t.lamp": { on: true } };
    const t = setUp(g, fakeFiles(g));
    expect(t.scene.origin).toEqual(g.origin);
    const domes = Object.values(t.scene.objects).filter((o) => o.kind !== "group" && o.name?.startsWith("Dome "));
    expect(domes).toHaveLength(18);
    for (const o of domes) expect(o.traits).toEqual({ "t.lamp": { on: true }, "scene.carry": {} });
  });
});

describe("Lost Cities", () => {
  it("has 60 cards in five expeditions, every face the same size as the back", async () => {
    const { pieces, setup } = builtIn("lost-cities");
    const deck = setup.find((t) => t.deck).deck;
    expect(deck.cards).toHaveLength(60);
    expect(new Set(deck.cards).size).toBe(50);
    expect(new Set(deck.cards.map((k) => pieces[k].back))).toEqual(new Set(["back"]));
    const back = (await draw(pieces.back)).bounds;
    for (const k of new Set(deck.cards)) {
      const b = (await draw(pieces[k])).bounds;
      for (let i = 0; i < 3; i++) {
        expect(b.min[i]).toBeCloseTo(back.min[i], 6);
        expect(b.max[i]).toBeCloseTo(back.max[i], 6);
      }
    }
  });

  /** A Lost Cities table; `secure: false` for a deck that doesn't ask for its players to shuffle it. */
  async function table(seed = 3, { secure = true } = {}) {
    const repo = fakeRepo();
    const game = await newGame(repo, "lost-cities");
    if (!secure) game.change((d) => delete d.setup.find((t) => t.deck).deck.secure);
    await ensurePieceGLBs(repo, game);
    const t = setUp(gameOf(game.doc()), gameFiles(game.doc()), { rng: seeded(seed), gameUrl: game.url });
    const secrets = t.containers.deck0;
    const truth = Object.fromEntries(Object.entries(t.scene.objects).filter(([, o]) => keptIn(o)).map(([id, o]) => [id, secrets.items[keptIn(o).slot]]));
    return { game: game.doc(), ...t, secrets, truth };
  }

  it("deals 8 face up into each hand tray, stacks the other 44 face down, and seats two", async () => {
    const { game, scene, truth } = await table();
    const cards = Object.entries(scene.objects).filter(([id]) => truth[id]);
    expect(cards).toHaveLength(60);
    const at = (z) => cards.filter(([, o]) => Math.abs(o.transform.position[2] - z) < 0.01);
    const hand1 = at(0.5);
    const hand2 = at(-0.5);
    expect(hand1).toHaveLength(8);
    expect(hand2).toHaveLength(8);
    for (const [, o] of hand1) expect(o.transform.rotation).toEqual([0, 0, 0]);
    // the second tray is turned to face its player: its cards with it
    for (const [, o] of hand2) expect(o.transform.rotation).toEqual([0, Math.PI, 0]);
    const deck = cards.filter(([, o]) => o.transform.position[0] === 0.3);
    expect(deck).toHaveLength(44);
    for (const [, o] of deck) expect(o.transform.rotation[2]).toBe(Math.PI);
    const ys = deck.map(([, o]) => o.transform.position[1]).sort((a, b) => a - b);
    const h = game.drawn.back.bounds.max[1];
    ys.forEach((y, j) => expect(y).toBeCloseTo((j + 1) * h, 6));
    expect(scene.traits[SEATS]).toEqual({ p1: expect.objectContaining({ name: "Player 1", player: null }), p2: expect.objectContaining({ name: "Player 2", player: null }) });
    const zones = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.zone"]);
    expect(zones.map((o) => [o.name, o.traits["tabletop.zone"].seat])).toEqual([["Player 1's hand", "p1"], ["Player 2's hand", "p2"]]);
    expect(zones.every((o) => o.locked)).toBe(true);
    expect(scene.view.start.body).toBe("seat");
  });

  it("tags every card, and nothing else, 'card'", async () => {
    const { scene, truth } = await table();
    const objects = Object.entries(scene.objects).filter(([, o]) => o.kind !== "group");
    for (const [id, o] of objects) {
      if (truth[id]) expect(o.tags).toEqual(["card"]);
      else expect(o.tags).toBeUndefined();
    }
  });

  it("says nothing in the scene about which card is which", async () => {
    const { game, scene, truth } = await table();
    const text = JSON.stringify(scene);
    for (const kind of new Set(game.setup.find((t) => t.deck).deck.cards)) {
      expect(text).not.toContain(game.drawn[kind].url);
      expect(text).not.toContain(`"${game.pieces[kind].name}`);
      expect(text).not.toContain(kind);
    }
    const cards = Object.entries(scene.objects).filter(([id]) => truth[id]);
    expect(new Set(cards.map(([, o]) => o.name))).toEqual(new Set(["Card"]));
    expect(new Set(cards.map(([, o]) => o.sourceUrl))).toEqual(new Set([game.drawn.back.url]));
    expect(scene.objects[cards[0][1].group].name).toBe("Deck (60)");
    const names = Object.values(truth).map((x) => x.name);
    expect(names.filter((n) => n === "Red wager")).toHaveLength(3);
    expect(names.filter((n) => n === "Blue 7")).toHaveLength(1);
  });

  it("a deck says what its container is to hold, slot by slot, titled by the game, not the host: no doc of any keeper's shape", async () => {
    const { scene, secrets } = await table();
    expect(Object.keys(secrets).sort()).toEqual(["items", "secure", "title"]);
    expect(secrets).toMatchObject({ title: "Lost Cities: Deck", secure: true });
    expect(secrets.items).toHaveLength(60);
    for (const item of secrets.items) expect(Object.keys(item).sort()).toEqual(["name", "sourceUrl"]);
    const cards = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.card"]);
    expect(cards).toHaveLength(60);
    for (const o of cards) {
      expect(o.traits["tabletop.card"]).toEqual({});
      expect(Object.keys(o.traits).sort()).toEqual(["keep.plain", "scene.carry", "tabletop.card"]);
    }
    expect(cards.map((o) => keptIn(o).slot).sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, k) => k));
    expect((await table(3, { secure: false })).secrets.secure).toBe(false);
  });

  it("gives every deck a container of its own, each card bound to its deck's", () => {
    const g = builtIn("lost-cities");
    const deck = g.setup.find((t) => t.deck);
    const wagers = deck.deck.cards.filter((k) => k.endsWith("-wager"));
    deck.deck.cards = deck.deck.cards.filter((k) => !k.endsWith("-wager"));
    g.setup.push({ deck: { name: "Wagers", cards: wagers, faceDown: true }, at: { position: [-0.3, 0, 0] } });
    const { layout, scene, containers } = setUp(g, fakeFiles(g), { rng: seeded(5) });
    expect(Object.keys(containers)).toEqual(["deck0", "deck1"]);
    expect([containers.deck0.secure, containers.deck0.items.length, containers.deck0.title]).toEqual([true, 45, "Lost Cities: Deck"]);
    expect([containers.deck1.secure, containers.deck1.items.length, containers.deck1.title]).toEqual([false, 15, "Lost Cities: Wagers"]);
    const laid = Object.values(layout.objects).filter((o) => o.traits?.["tabletop.card"]);
    for (const key of ["deck0", "deck1"]) expect(laid.filter((o) => o.traits["tabletop.card"].deck === key).map((o) => o.traits["tabletop.card"].slot)).toEqual(containers[key].items.map((_, k) => k));
    expect(new Set(Object.values(scene.objects).filter((o) => keptIn(o)).map((o) => keptIn(o).by))).toEqual(new Set(["automerge:deck-deck0", "automerge:deck-deck1"]));
    // a container with no binding: nothing written
    const d = skeleton();
    expect(() => writeTable(d, layout, { binds: { deck0: bindTo("automerge:main") } })).toThrow(/deck1/);
    expect(d).toEqual(skeleton());
  });

  it("ids, order and every object say nothing about the shuffle: only the containers differ", () => {
    const g = builtIn("lost-cities");
    const a = tableLayout(g, { fileOf: fakeFiles(g), rng: seeded(3) });
    const b = tableLayout(g, { fileOf: fakeFiles(g), rng: seeded(11) });
    expect(a.order).toEqual(b.order);
    expect(JSON.stringify(a.objects)).toBe(JSON.stringify(b.objects));
    expect(a.containers.deck0.items).not.toEqual(b.containers.deck0.items);
    const sorted = (t) => t.containers.deck0.items.map((i) => i.name).sort();
    expect(sorted(a)).toEqual(sorted(b));
  });

  it("deals onto the trays' card slots, each card in its slot's frame in the tray's", () => {
    const g = builtIn("lost-cities");
    const { layout } = setUp(g, fakeFiles(g), { rng: seeded(3) });
    const cards = Object.values(layout.objects).filter((o) => o.traits?.["tabletop.card"]);
    for (const id of ["hand1", "hand2"]) {
      const tray = g.setup.find((t) => t.id === id);
      for (const s of g.pieces.hand.snapPoints.slice(0, 8)) {
        const want = composePose(tray.at, { position: s.position, rotation: s.rotation });
        const on = cards.filter((o) => o.transform.position.every((v, i) => Math.abs(v - want.position[i]) < 1e-6));
        expect(on).toHaveLength(1);
        expect(on[0].transform.rotation).toEqual(want.rotation);
      }
    }
  });

  it("has the seats laid by their owner (which adds them beside any there, under ids it says), and writes the view's every setting", () => {
    const g = builtIn("lost-cities");
    const layout = tableLayout(g, { fileOf: fakeFiles(g) });
    expect(Object.keys(layout.seats)).toEqual(["p1", "p2"]);
    for (const s of Object.values(layout.seats)) expect(Object.keys(s).sort()).toEqual(["camera", "name"]);
    const made = { binds: { deck0: bindTo("automerge:main") } };
    const fresh = skeleton();
    const asked = [];
    writeTable(fresh, layout, { ...made, seats: (d, seats) => (asked.push(seats), lay(d, seats)) });
    expect(asked).toEqual([layout.seats]);
    expect(Object.keys(fresh.traits[SEATS])).toEqual(["p1", "p2"]);
    expect(fresh.view).toEqual({ units: "cm", grid: false, axes: false, bounds: false, snap: true, start: { body: "seat", home: g.camera } });
    expect(fresh.order).toEqual(layout.order);
    const mine = { north: { name: "North", player: "automerge:ana" } };
    const busy = { ...skeleton(), objects: { x: { name: "Lamp" } }, order: ["x"], traits: { [SEATS]: structuredClone(mine) } };
    writeTable(busy, layout, { ...made, seats: lay });
    expect(busy.traits[SEATS]).toEqual({ ...mine, p1: { name: "Player 1", player: null, camera: layout.seats.p1.camera }, p2: { name: "Player 2", player: null, camera: layout.seats.p2.camera } });
    expect(busy.order[0]).toBe("x");
    expect(busy.order).toHaveLength(1 + layout.order.length);
    const bare = skeleton();
    writeTable(bare, layout, made);
    expect(bare.traits).toEqual({});
    expect(JSON.stringify(bare)).not.toMatch(/seats/i);
  });

  it("names the game as About only when there is a game doc", () => {
    const g = builtIn("lost-cities");
    const withGame = tableLayout(g, { fileOf: fakeFiles(g), gameUrl: "automerge:game" });
    const without = tableLayout(g, { fileOf: fakeFiles(g) });
    for (const o of Object.values(withGame.objects)) if (o.kind !== "group") expect(o).toMatchObject({ infoUrl: "automerge:game", infoToolId: "tabletop-game" });
    for (const o of Object.values(without.objects)) expect("infoUrl" in o || "infoToolId" in o).toBe(false);
  });
});

describe("cards anywhere, and bags", () => {
  /** A small game: a back, two cards, a bag, a pawn, a hand. */
  const small = () => ({
    format: "tabletop-game",
    version: 1,
    title: "Small",
    about: "",
    pieces: {
      back: { name: "Card", parts: [{ shape: "box", size: [0.06, 0.001, 0.09], color: "#333333" }], tags: ["card"] },
      a: { name: "Ace", parts: [{ shape: "box", size: [0.06, 0.001, 0.09], color: "#ff0000" }], back: "back" },
      b: { name: "Bee", parts: [{ shape: "box", size: [0.06, 0.001, 0.09], color: "#ffff00" }], back: "back" },
      bag: { name: "Bag", parts: [{ shape: "lathe", profile: [[0, 0], [0.08, 0], [0, 0.15]], color: "#7a5a3a" }], bag: { rule: "random" } },
      pawn: { name: "Pawn", parts: [{ shape: "box", size: [0.02, 0.03, 0.02], color: "#0000ff" }] },
      tray: { name: "Tray", parts: [{ shape: "box", size: [0.3, 0.002, 0.1], color: "#224422" }], zone: { min: [-0.15, 0, -0.05], max: [0.15, 0.1, 0.05] }, locked: true },
    },
    setup: [
      { piece: "a", at: { position: [0.2, 0, 0] } },
      { piece: "tray", seat: "s1", at: { position: [0, 0, 0.4] } },
      { piece: "bag", at: { position: [-0.2, 0, 0] }, contents: [{ piece: "pawn", count: 3 }, { piece: "b" }, { deck: { name: "Little deck", cards: ["a", "b"] } }, { piece: "bag", contents: [{ piece: "pawn" }] }] },
    ],
    seats: { s1: { name: "Seat 1" } },
  });

  it("keeps a loose card as a deck's are, in the game's one container for loose cards; a card in a bag too", () => {
    const g = small();
    const { layout } = setUp(g, fakeFiles(g));
    expect(Object.keys(layout.containers)).toEqual([LOOSE, "deck0"]);
    expect(layout.containers[LOOSE]).toEqual({ title: "Small: Cards", secure: false, items: [{ sourceUrl: "automerge:a", name: "Ace" }, { sourceUrl: "automerge:b", name: "Bee" }] });
    // on the table: the loose ace, as its back
    const ace = Object.values(layout.objects).find((o) => o.traits?.["tabletop.card"]);
    expect(ace).toMatchObject({ name: "Card", sourceUrl: "automerge:back", tags: ["card"], traits: { "tabletop.card": { deck: LOOSE, slot: 0 } } });
  });

  it("puts a bag's things in the bag and never in the scene; a bag in a bag holds its own", () => {
    const g = small();
    const { layout } = setUp(g, fakeFiles(g));
    const ids = Object.keys(layout.bags);
    expect(ids).toHaveLength(2);
    const [outer, inner] = ids;
    expect(layout.order).toContain(outer);
    expect(layout.order).not.toContain(inner);
    const items = layout.bags[outer].items;
    // three pawns, the bee, the little deck's two cards, the inner bag: members, never groups
    expect(items.map((i) => i.object.name)).toEqual(["Pawn 1", "Pawn 2", "Pawn 3", "Card", "Card", "Card", "Bag"]);
    expect(items.every((i) => i.object.kind !== "group" && !layout.objects[i.id])).toBe(true);
    expect(layout.bags[inner].items.map((i) => i.object.name)).toEqual(["Pawn"]);
    expect(layout.bags[outer]).toMatchObject({ title: "Bag", rule: "random" });
    // a group for the pawns is never made: nothing in the scene is named for them
    expect(Object.values(layout.objects).some((o) => /Pawn/.test(o.name))).toBe(false);
  });

  it("makes the containers, then the bags innermost first, each holding its things bound; then writes the bag's trait", async () => {
    const g = small();
    const layout = tableLayout(g, { fileOf: fakeFiles(g) });
    const repo = fakeRepo();
    const made = await prepareTable({ repo, registry: async (t) => registries(seatsPlugin())[t] ?? null }, layout);
    expect(made.notes).toEqual([]);
    const bagDocs = [...repo.docs.values()].filter((d) => d["@patchwork"].type === "bag").map(inBag);
    // the inner bag was made first, so the outer one holds it already given its document
    expect(bagDocs.map((d) => d.length)).toEqual([1, 7]);
    const innerInOuter = bagDocs[1].find((o) => o.name === "Bag");
    expect(innerInOuter.traits[BAG]).toEqual(made.bags[Object.keys(layout.bags)[1]][BAG]);
    // the cards in the bag are bound to their containers
    const cardsInBag = bagDocs[1].filter((o) => o.name === "Card");
    expect(cardsInBag.every((o) => keptIn(o) && Object.keys(o.traits["tabletop.card"]).length === 0)).toBe(true);
    const scene = skeleton();
    writeTable(scene, layout, made);
    const bagObject = Object.values(scene.objects).find((o) => o.name === "Bag");
    expect(bagObject.traits[BAG].doc).toMatch(/^automerge:/);
    expect(scene.objects[Object.keys(layout.bags)[0]].traits).toEqual({ "scene.carry": {}, [BAG]: { doc: bagObject.traits[BAG].doc } });
  });

  it("a hand is a seat's only where it's placed for one", () => {
    const g = small();
    g.setup.push({ piece: "tray", name: "Spare tray", at: { position: [0, 0, -0.4] } });
    const { layout } = setUp(g, fakeFiles(g));
    const trays = Object.values(layout.objects).filter((o) => o.sourceUrl === "automerge:tray");
    expect(trays.map((o) => [o.name, o.traits?.["tabletop.zone"]?.seat ?? null])).toEqual([["Tray", "s1"], ["Spare tray", null]]);
  });
});
