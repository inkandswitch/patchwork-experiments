import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { partGeometry } from "./shapes.js";
import { boundsOf, connectorsOf, drawer, lookKey } from "./look/look.js";
import { turned } from "./look/slab.js";
import { groupsOf, pieceDrawer, readFile as readFileOf, RETRY_MS } from "./pieces.js";
import { composePose, copyPose, isCard, kindsLaid, kindsUsed, LOOSE, shuffle, tableLayout, writeTable } from "./setup.js";
import { prepareTable } from "./table/made-with.js";
import { composeMatrix, multiply } from "./table/frame.js";
import { TabletopGameDatatype } from "./datatype.js";
import { gameOf, writeGame } from "./game.js";
import { emptyScene } from "./empty-scene.js";
import { parseGLB } from "./glb.js";
import * as Automerge from "@automerge/automerge";
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

/** Draw every kind of a game now (setting up a table draws what it lays out; a face is drawn when it's shown). */
const ensurePieceGLBs = (repo, game, o = {}) => pieceDrawer({ repo, handle: game, ...o }).ensure(Object.keys(game.doc().pieces ?? {}), o);

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
    expect(Object.keys(gameOf(game.doc())).sort()).toEqual(["about", "assets", "format", "pieces", "players", "seats", "setup", "title", "version"]);
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

describe("drawing many pieces at once", () => {
  /**
   * An image backend that takes its time (seeded), and counts: decodes running at once, images
   * decoded and not yet closed, and any use of one that's been closed (a crop on a closed bitmap
   * draws nothing in a browser: the piece would be drawn without its image).
   */
  function slowImages(seed) {
    const rng = seeded(seed);
    const wait = () => new Promise((r) => setTimeout(r, Math.floor(rng() * 4)));
    const n = { decoding: 0, maxDecoding: 0, live: 0, maxLive: 0, opened: 0, closed: 0, usedClosed: 0 };
    const use = async (h) => {
      await wait();
      if (h.closed) n.usedClosed++;
    };
    return {
      n,
      async open(bytes) {
        n.decoding++;
        n.maxDecoding = Math.max(n.maxDecoding, n.decoding);
        await wait();
        n.decoding--;
        n.opened++;
        n.live++;
        n.maxLive = Math.max(n.maxLive, n.live);
        return { width: 400, height: 200, closed: false, id: bytes[0] };
      },
      async crop(h) {
        await use(h);
        return { bytes: new Uint8Array([h.id]), mimeType: "image/png", width: 8, height: 8, hasAlpha: false };
      },
      async shape(h) {
        await use(h);
        return "opaque";
      },
      close(h) {
        if (h.closed) throw new Error("closed twice");
        h.closed = true;
        n.live--;
        n.closed++;
      },
    };
  }
  // 40 pieces off 12 images, each with the one back: measured (aspect), cut out (shape) and cropped
  const files = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`automerge:img${i}`, { content: new Uint8Array([i]), mimeType: "image/png" }]));
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    name: `P${i}`,
    parts: [{ shape: "slab", outline: i % 5 ? "rect" : "cutout", size: [0.05, 0.05], thickness: 0.002, color: "#ffffff", ...(i % 3 ? {} : { aspect: "image" }), top: { file: `automerge:img${(i * 7) % 12}` }, bottom: { file: "automerge:img12" } }],
  }));

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`never decodes more than it may at once, never holds more decoded than it may, and never closes one in use (seed ${seed})`, async () => {
      const images = slowImages(seed);
      const d = drawer({ read: async (u) => files[u] ?? null, images, decodes: 4, held: 6 });
      const out = await Promise.all(pieces.map((p) => d.draw(p)));
      // every piece drawn with its images
      expect(out.flatMap((o) => o.notes)).toEqual([]);
      expect(images.n.usedClosed).toBe(0);
      expect(images.n.maxDecoding).toBeLessThanOrEqual(4);
      expect(images.n.maxDecoding).toBeGreaterThan(1);
      expect(images.n.maxLive).toBeLessThanOrEqual(6);
      // and once it's closed, every image it decoded is closed, once
      d.close();
      await new Promise((r) => setTimeout(r, 0));
      expect(images.n.closed).toBe(images.n.opened);
      expect(images.n.live).toBe(0);
    });
  }

  it("one at a time: one decode at a time, and a sheet decoded once for every piece cut from it", async () => {
    const images = slowImages(9);
    const d = drawer({ read: async (u) => files[u] ?? null, images, decodes: 1, held: 2 });
    for (const p of pieces.filter((x) => x.parts[0].top.file === "automerge:img0")) await d.draw(p);
    expect(images.n.maxDecoding).toBe(1);
    expect(images.n.opened).toBe(2); // the sheet and the back
    d.close();
  });
});

describe("drawn on demand", () => {
  const WEB = "https://example.org/";
  const png = (w, h) => encodePNG(w, h, new Uint8Array(w * h * 4).fill(200));
  const card = (file, rect) => ({ shape: "slab", outline: "rounded", size: [0.05, 0.07], thickness: 0.0005, color: "#ffffff", top: { file, ...(rect ? { rect } : {}) } });
  /**
   * A board, a back, and four faces off three sheets: a deck of a1, a2 (cut from one sheet) and b1
   * (another: a deck spans sheets, as Terraforming Mars's do), and a deck of c1 alone. Each image on the web.
   */
  const cardGame = () => ({
    pieces: {
      board: { name: "Board", parts: [{ shape: "slab", outline: "rect", size: [0.2, 0.2], thickness: 0.004, color: "#ffffff", top: { file: `${WEB}board.png` } }], locked: true },
      back: { name: "Back", parts: [card(`${WEB}back.png`)], tags: ["card"] },
      a1: { name: "A1", parts: [card(`${WEB}a.png`, [0, 0, 0.5, 1])], back: "back" },
      a2: { name: "A2", parts: [card(`${WEB}a.png`, [0.5, 0, 0.5, 1])], back: "back" },
      b1: { name: "B1", parts: [card(`${WEB}b.png`)], back: "back" },
      c1: { name: "C1", parts: [card(`${WEB}c.png`)], back: "back" },
    },
    setup: [{ piece: "board" }, { deck: { name: "Deck", cards: ["a1", "a2", "b1"], faceDown: true } }, { deck: { name: "Other", cards: ["c1"], faceDown: true } }],
  });
  const DECK = ["a1", "a2", "b1"];
  /** A web of PNGs that counts what's fetched; `down` lists URLs it refuses (a host without CORS). */
  function web({ down = new Set() } = {}) {
    const fetched = [];
    const fetch = async (url) => {
      fetched.push(url);
      if (down.has(url.replace(/^http:/, "https:"))) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, arrayBuffer: async () => png(4, 2).slice().buffer };
    };
    return { fetch, fetched, down };
  }
  async function newCardGame(repo) {
    const h = await repo.create2({});
    h.change((d) => {
      TabletopGameDatatype.init(d);
      Object.assign(d, cardGame());
    });
    return h;
  }
  /** Count a handle's changes. */
  const counted = (h) => {
    const n = { changes: 0 };
    const change = h.change;
    h.change = (fn) => (n.changes++, change(fn));
    return n;
  };
  const settled = async (cond) => {
    for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(cond()).toBe(true);
  };
  /** The game as two peers have it, each drawing before either has heard from the other. */
  const peers = () => {
    const init = {};
    TabletopGameDatatype.init(init);
    Object.assign(init, cardGame());
    const base = Automerge.from(init, { actor: "aa" });
    const peer = (actor) => {
      let d = Automerge.clone(base, { actor });
      return { url: "automerge:game", doc: () => d, change: (fn) => (d = Automerge.change(d, fn)), set: (x) => (d = x) };
    };
    const [p, q] = [peer("bb"), peer("cc")];
    const hear = () => {
      const merged = Automerge.merge(Automerge.clone(p.doc()), q.doc());
      p.set(Automerge.merge(p.doc(), q.doc()));
      q.set(Automerge.merge(q.doc(), merged));
    };
    return { p, q, hear };
  };

  it("a card's group: every card it may share a container with, and every card cut from the same sheets, closed over both", () => {
    const g = cardGame();
    expect(Object.fromEntries(groupsOf(g))).toEqual({ a1: DECK, a2: DECK, b1: DECK, c1: ["c1"] });
    // a sheet two decks are cut from joins them; the loose cards (one container) are one group, in a bag too
    g.pieces.c2 = { name: "C2", parts: [card(`${WEB}b.png`)], back: "back" };
    g.pieces.l1 = { name: "L1", parts: [card(`${WEB}l1.png`)], back: "back" };
    g.pieces.l2 = { name: "L2", parts: [card(`${WEB}l2.png`)], back: "back" };
    g.pieces.bag = { name: "Bag", parts: [{ shape: "box", size: [0.1, 0.1, 0.1], color: "#000000" }], bag: { rule: "draw" } };
    g.setup[2].deck.cards.push("c2");
    g.setup.push({ piece: "l1" }, { piece: "bag", contents: [{ piece: "l2" }] });
    const of = groupsOf(g);
    expect(of.get("a1")).toEqual(["a1", "a2", "b1", "c1", "c2"]);
    expect(of.get("l2")).toEqual(["l1", "l2"]);
    // what isn't a card has none; the faces with no image are one group
    expect(of.has("board")).toBe(false);
    const lc = builtIn("lost-cities");
    const cards = Object.keys(lc.pieces).filter((k) => isCard(lc, k));
    const lcOf = groupsOf(lc);
    expect(new Set(cards.map((k) => lcOf.get(k))).size).toBe(1);
  });

  it("a card's group is never smaller than any of the game's variants makes it", () => {
    const g = cardGame();
    const alone = groupsOf(g).get("c1");
    expect(alone).toEqual(["c1"]);
    // a variant that decks c1 with a1: the group a face is drawn with is the same whichever way the table was set up
    g.variants = [{ name: "joined", setup: [{ deck: { name: "All", cards: ["a1", "c1"] } }] }];
    expect(groupsOf(g).get("c1")).toEqual(groupsOf(g).get("a1"));
    expect(groupsOf(g).get("c1")).toContain("a2");
  });

  it("setting up draws what a table lays out; a face is drawn the first time it's shown, with its group, and kept for everyone", async () => {
    const repo = fakeRepo();
    const game = await newCardGame(repo);
    const w = web();
    const n = counted(game);
    const pd = pieceDrawer({ repo, handle: game, images: nodeImages(), fetch: w.fetch });
    await pd.ensure(kindsLaid(gameOf(game.doc())));
    expect(Object.keys(game.doc().drawn).sort()).toEqual(["back", "board"]);
    expect(w.fetched.sort()).toEqual([`${WEB}back.png`, `${WEB}board.png`]);
    // what was fetched is cached in the game, under its URL
    expect(Object.keys(game.doc().assets).sort()).toEqual([`${WEB}back.png`, `${WEB}board.png`]);
    expect(repo.docs.get(game.doc().assets[`${WEB}board.png`].file)).toMatchObject({ "@patchwork": { type: "file" }, mimeType: "image/png", origin: { urls: [`${WEB}board.png`] } });
    expect(n.changes).toBe(1);

    // a1 shown: drawn here and shown from its bytes at once; its group (its deck: a2, and b1 off another
    // sheet) drawn with it, and all recorded in one change
    const shown = await pd.face("a1");
    expect(shown.glb).toBeInstanceOf(Uint8Array);
    await settled(() => !!game.doc().drawn.b1);
    expect(Object.keys(game.doc().drawn).sort()).toEqual(["a1", "a2", "b1", "back", "board"]);
    expect(w.fetched.filter((u) => /\/[ab]\.png$/.test(u)).sort()).toEqual([`${WEB}a.png`, `${WEB}b.png`]);
    expect(game.doc().assets[`${WEB}a.png`].file).toBeTruthy();
    expect(game.doc().assets[`${WEB}b.png`].file).toBeTruthy();
    expect(n.changes).toBe(2);
    // the next face of that group is its doc: nothing drawn, fetched or written
    const docs = repo.docs.size;
    expect(await pd.face("b1")).toEqual({ url: game.doc().drawn.b1.url });
    expect(await pd.face("a1")).toEqual({ url: game.doc().drawn.a1.url });
    // another viewer (another drawer, a fresh fetch) finds them in the game
    const other = web();
    const them = pieceDrawer({ repo, handle: game, images: nodeImages(), fetch: other.fetch });
    expect(await them.face("a2")).toEqual({ url: game.doc().drawn.a2.url });
    expect([repo.docs.size, n.changes, other.fetched]).toEqual([docs, 2, []]);
    // c1, another group, when it's shown, read from the cache the game has (a sheet cached, not fetched again)
    game.change((d) => (d.assets[`${WEB}c.png`] = { file: game.doc().assets[`${WEB}a.png`].file }));
    expect((await them.face("c1")).glb).toBeInstanceOf(Uint8Array);
    await settled(() => !!game.doc().drawn.c1);
    expect(other.fetched).toEqual([]);
  });

  it("whichever face of a group is shown first, the game records the same: the same kinds and sheets, the same docs made in the same order, in one change", async () => {
    // every case: the game's changes, the docs made and the URLs fetched are the same function of the group alone
    const trace = async (kind) => {
      const repo = fakeRepo();
      const game = await newCardGame(repo);
      const made = [];
      const create2 = repo.create2;
      repo.create2 = async (doc) => (made.push(doc.name ?? doc.origin?.urls?.[0]), create2(doc));
      const n = counted(game);
      const w = web();
      const pd = pieceDrawer({ repo, handle: game, images: nodeImages(), fetch: w.fetch });
      await pd.face(kind);
      await settled(() => DECK.every((k) => game.doc().drawn?.[k]));
      await new Promise((r) => setTimeout(r, 5));
      return { changes: n.changes, drawn: Object.keys(game.doc().drawn), assets: Object.keys(game.doc().assets).sort(), made, fetched: [...w.fetched].sort() };
    };
    const first = await trace(DECK[0]);
    expect(first).toMatchObject({ changes: 1, drawn: DECK, made: expect.arrayContaining(["A1.glb", "A2.glb", "B1.glb"]) });
    expect(first.made.filter((m) => m.endsWith(".glb"))).toEqual(["A1.glb", "A2.glb", "B1.glb"]);
    for (const k of DECK.slice(1)) expect(await trace(k), k).toEqual(first);
  });

  it("two viewers showing different faces of one group at once: each draws and records the whole group; merged, one entry each wins, and both keep working", async () => {
    const repo = fakeRepo();
    const { p, q, hear } = peers();
    const [dp, dq] = [p, q].map((h) => pieceDrawer({ repo, handle: h, images: nodeImages(), fetch: web().fetch }));
    const [sp, sq] = await Promise.all([dp.face("a1"), dq.face("b1")]);
    expect(sp.glb).toBeInstanceOf(Uint8Array);
    expect(sq.glb).toBeInstanceOf(Uint8Array);
    await settled(() => DECK.every((k) => p.doc().drawn?.[k] && q.doc().drawn?.[k]));
    // each recorded the same kinds and sheets: nothing says which face either was shown
    expect(Object.keys(p.doc().drawn)).toEqual(Object.keys(q.doc().drawn));
    expect(Object.keys(p.doc().assets)).toEqual(Object.keys(q.doc().assets));
    // each made its own docs, the sheets' and the faces'
    expect(p.doc().drawn.a1.url).not.toBe(q.doc().drawn.a1.url);
    expect(p.doc().assets[`${WEB}a.png`].file).not.toBe(q.doc().assets[`${WEB}a.png`].file);
    // they hear from each other: one entry for each, the same on both, naming a doc that's there
    hear();
    for (const k of DECK) {
      expect(p.doc().drawn[k]).toEqual(q.doc().drawn[k]);
      expect(repo.docs.has(p.doc().drawn[k].url)).toBe(true);
    }
    expect(p.doc().assets).toEqual(q.doc().assets);
    // and either now shows the one that won
    expect(await dq.face("a1")).toEqual({ url: q.doc().drawn.a1.url });
    expect(await dp.face("b1")).toEqual({ url: p.doc().drawn.b1.url });
  });

  it("two viewers caching different sheets at once: the merge keeps both (the game has its assets map from the start)", async () => {
    const repo = fakeRepo();
    const { p, q, hear } = peers();
    expect(p.doc().assets).toEqual({});
    const [dp, dq] = [p, q].map((h) => pieceDrawer({ repo, handle: h, images: nodeImages(), fetch: web().fetch }));
    await Promise.all([dp.face("a1"), dq.face("c1")]);
    await settled(() => !!p.doc().drawn?.a1 && !!q.doc().drawn?.c1);
    hear();
    expect(Object.keys(p.doc().assets).sort()).toEqual([`${WEB}a.png`, `${WEB}b.png`, `${WEB}c.png`]);
    expect(Object.keys(p.doc().drawn).sort()).toEqual(["a1", "a2", "b1", "c1"]);
    expect(p.doc()).toEqual(q.doc());
  });

  it("the game edited while a viewer caches a sheet: the merge keeps both (assets is written entry by entry)", () => {
    const { p, q, hear } = peers();
    p.change((d) => (d.assets[`${WEB}a.png`] = { file: "automerge:cachedA" }));
    // q edits the game as JSON (tool.js), not having heard of a.png: its definition names another asset, and not a.png
    q.change((d) => writeGame(d, { ...gameOf(q.doc()), title: "Edited", assets: { [`${WEB}z.png`]: { file: "automerge:cachedZ" } } }));
    hear();
    expect(p.doc().title).toBe("Edited");
    expect(p.doc().assets).toEqual({ [`${WEB}a.png`]: { file: "automerge:cachedA" }, [`${WEB}z.png`]: { file: "automerge:cachedZ" } });
    // and an edit that drops an entry it has heard of drops it
    p.change((d) => writeGame(d, { ...gameOf(p.doc()), assets: { [`${WEB}z.png`]: { file: "automerge:cachedZ" } } }));
    expect(Object.keys(p.doc().assets)).toEqual([`${WEB}z.png`]);
  });

  it("a group that can't be kept whole is kept not at all: no entry for part of it, and its faces shown here", async () => {
    const repo = fakeRepo();
    const game = await newCardGame(repo);
    const create2 = repo.create2;
    let glbs = 0;
    repo.create2 = async (doc) => {
      if (doc.extension === "glb" && ++glbs > 1) throw new Error("the repo is full");
      return create2(doc);
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pd = pieceDrawer({ repo, handle: game, images: nodeImages(), fetch: web().fetch });
    const shown = await pd.face("a2");
    expect(shown.glb).toBeInstanceOf(Uint8Array);
    expect(await shown.kept).toBe(null);
    expect(game.doc().drawn).toEqual({});
    // the rest of it is shown from what was drawn here
    expect((await pd.face("b1")).glb).toBeInstanceOf(Uint8Array);
  });

  it("a host that refuses: the face is drawn without its image, its URL noted, and fetched again only after a while", async () => {
    const repo = fakeRepo();
    const game = await newCardGame(repo);
    const w = web({ down: new Set([`${WEB}a.png`]) });
    let t = 1000;
    const pd = pieceDrawer({ repo, handle: game, images: nodeImages(), fetch: w.fetch, now: () => t });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const aOnly = () => w.fetched.filter((u) => /\/a\.png$/.test(u));
    expect((await pd.face("a1")).glb).toBeInstanceOf(Uint8Array);
    await settled(() => !!game.doc().drawn?.b1);
    expect(game.doc().drawn.a1.missing).toEqual([`${WEB}a.png`]);
    expect(game.doc().drawn.b1.missing).toBeUndefined();
    expect(game.doc().assets?.[`${WEB}a.png`]).toBeUndefined();
    const url = game.doc().drawn.a1.url;
    // shown again and again, any face of the group: its doc, nothing fetched or drawn
    const changes = counted(game);
    for (let i = 0; i < 6; i++) expect(await pd.face(DECK[i % 3])).toEqual({ url: game.doc().drawn[DECK[i % 3]].url });
    expect(aOnly()).toEqual([`${WEB}a.png`, `http://example.org/a.png`]); // (and its http twin: look/web.js)
    expect(changes.changes).toBe(0);
    // a while later, the host answers: whichever face is shown, the group's missing ones are drawn again behind it, in place
    t += RETRY_MS + 1;
    w.down.clear();
    expect(await pd.face("b1")).toEqual({ url: game.doc().drawn.b1.url });
    await settled(() => !game.doc().drawn.a1.missing && !game.doc().drawn.a2.missing);
    expect(game.doc().drawn.a1.url).toBe(url);
    expect(aOnly()).toEqual([`${WEB}a.png`, `http://example.org/a.png`, `${WEB}a.png`]);
    expect(game.doc().assets[`${WEB}a.png`].file).toBeTruthy();
    expect(changes.changes).toBe(1);
  });

  it("a viewer who can't write the game draws for themselves, and writes nothing", async () => {
    const repo = fakeRepo();
    const game = await newCardGame(repo);
    const before = JSON.stringify(game.doc());
    const ro = { ...game, url: game.url, doc: game.doc, isReadOnly: () => true, change: () => { throw new Error("read-only"); } };
    const w = web();
    const docs = repo.docs.size;
    const pd = pieceDrawer({ repo, handle: ro, images: nodeImages(), fetch: w.fetch });
    const shown = await pd.face("a1");
    expect(shown.glb).toBeInstanceOf(Uint8Array);
    // the rest of the group drawn too, kept here: b1 is shown from what was drawn, not drawn again
    await new Promise((r) => setTimeout(r, 10));
    expect((await pd.face("b1")).glb).toBeInstanceOf(Uint8Array);
    expect(w.fetched.sort()).toEqual([`${WEB}a.png`, `${WEB}b.png`]);
    expect([JSON.stringify(game.doc()), repo.docs.size]).toEqual([before, docs]);
  });

  it("a slab as wide as its image says is measured when it's drawn", async () => {
    const repo = fakeRepo();
    const sheet = await repo.create2({ "@patchwork": { type: "file" }, extension: "png", mimeType: "image/png", content: png(8, 2) });
    const tile = { name: "Tile", parts: [{ shape: "slab", outline: "rect", size: [0.05, 0.05], thickness: 0.004, aspect: "image", color: "#ffffff", top: { file: sheet.url } }] };
    const io = { read: (u) => readFileOf(repo, u), images: nodeImages() };
    expect((await draw(tile, io)).bounds.max[0]).toBeCloseTo(0.1, 6); // 4:1, half of 0.05 × 4
    expect((await draw({ ...tile, parts: [{ ...tile.parts[0], top: { file: sheet.url, rect: [0, 0, 0.25, 1] } }] }, io)).bounds.max[0]).toBeCloseTo(0.025, 6); // its cell is square
    expect((await draw({ ...tile, parts: [{ ...tile.parts[0], top: { file: sheet.url, turn: 90 } }] }, io)).bounds.max[0]).toBeCloseTo(0.00625, 6); // turned on its face
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

  it("asks for each kind it shows, the backs included, and no other; a card's face only by name when there's a faceOf", () => {
    const lc = builtIn("lost-cities");
    expect(kindsUsed(lc).sort()).toEqual(Object.keys(lc.pieces).sort());
    const asked = new Set();
    tableLayout(lc, { fileOf: (k) => (asked.add(k), { url: `automerge:${k}`, hint: null }) });
    expect([...asked].sort()).toEqual(kindsUsed(lc).sort());
    // what setting up from a game page draws: what a table lays out, a card as its back
    const laid = Object.keys(lc.pieces).filter((k) => !isCard(lc, k));
    expect(kindsLaid(lc).sort()).toEqual(laid.sort());
    asked.clear();
    const t = tableLayout(lc, { fileOf: (k) => (asked.add(k), { url: `automerge:${k}`, hint: null }), faceOf: (kind) => ({ game: "automerge:game", kind }) });
    expect([...asked].sort()).toEqual(laid.sort());
    for (const c of Object.values(t.containers)) for (const item of c.items) expect(item).toEqual({ game: "automerge:game", kind: expect.any(String), name: lc.pieces[item.kind].name });
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
    version: 2,
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
