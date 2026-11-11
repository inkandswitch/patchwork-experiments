import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { meshesBounds, partGeometry, pieceMeshes } from "./shapes.js";
import { connectorsOf, ensurePieceGLBs, glbKey, pieceGLB } from "./pieces.js";
import { fill as loadSantorini, santoriniPieces } from "./games/santorini.js";
import { EXPEDITIONS, fill as loadLostCities, lostCitiesPieces } from "./games/lost-cities.js";
import { kindsUsed, shuffle, supplySpot, tableLayout, writeTable } from "./setup.js";
import { TabletopGameDatatype } from "./datatype.js";
import { emptyScene } from "./empty-scene.js";

/** A doc handle and repo that keep docs in memory. */
function fakeRepo() {
  const docs = new Map();
  let n = 0;
  const handleFor = (url) => ({
    url,
    doc: () => docs.get(url),
    change(fn) {
      const d = structuredClone(docs.get(url));
      fn(d);
      docs.set(url, d);
    },
  });
  return {
    docs,
    async create2(init) {
      const url = `automerge:doc${n++}`;
      docs.set(url, structuredClone(init));
      return handleFor(url);
    },
    async find(url) {
      if (!docs.has(url)) throw new Error("unavailable");
      return handleFor(url);
    },
    handleFor,
  };
}

async function newGame(repo, fill = loadSantorini) {
  const init = {};
  TabletopGameDatatype.init(init);
  const h = await repo.create2(init);
  h.change(fill);
  return h;
}

/** Deterministic random numbers, for shuffles. */
function seeded(seed = 1) {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}

/** Each kind's GLB as the game page has it: the game's own doc, its box as the hint. */
const gameFiles = (game) => (kind) => {
  const p = game?.pieces?.[kind];
  return p?.glbUrl ? { url: p.glbUrl, hint: p.bounds ? { bounds: p.bounds } : null } : null;
};

/** An empty scene doc, as tool.js writes a table onto. */
const skeleton = () => emptyScene({ title: "T" });

/**
 * The game page's table: the layout, and the scene writeTable makes of it
 * with each deck at "automerge:deck-<id>".
 */
function setUp(game, gameUrl, o = {}) {
  const layout = tableLayout(game, { fileOf: gameFiles(game), gameUrl, ...o });
  const urls = Object.fromEntries(Object.keys(layout.decks).map((id) => [id, `automerge:deck-${id}`]));
  const scene = skeleton();
  writeTable(scene, layout, urls);
  return { layout, scene, decks: layout.decks, urls };
}

describe("shapes", () => {
  it("a box stands on its base centre", () => {
    const b = meshesBounds([{ positions: partGeometry({ shape: "box", size: [2, 1, 4], at: [1, 0.5, 0] }).positions }]);
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
    expect(meshesBounds([g])).toEqual({ min: [-1, 0, expect.closeTo(-1, 6)], max: [1, 2, expect.closeTo(1, 6)] });
    // side vertices: horizontal outward normals; caps: straight down / up
    for (let i = 0; i < g.positions.length; i += 3) {
      const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
      const [nx, ny, nz] = [g.normals[i], g.normals[i + 1], g.normals[i + 2]];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
      if (Math.abs(ny) < 1e-6) expect(x * nx + z * nz).toBeGreaterThan(0);
      else expect(Math.sign(ny)).toBe(y > 1 ? 1 : -1);
    }
  });

  it("merges parts of one colour into one mesh, and skips unknown shapes", () => {
    const meshes = pieceMeshes([
      { shape: "box", size: [1, 1, 1], color: "#FF0000" },
      { shape: "box", size: [1, 1, 1], at: [2, 0, 0], color: "#ff0000" },
      { shape: "box", size: [1, 1, 1], color: "#00ff00" },
      { shape: "teapot", color: "#0000ff" },
    ]);
    expect(meshes.map((m) => m.color)).toEqual(["#ff0000", "#00ff00"]);
    expect(meshes[0].indices.length).toBe(72);
  });
});

describe("piece GLBs", () => {
  const loadGLB = (glb) => new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), "");

  it("the board carries its 25 spaces as snap points on the scene", async () => {
    const { glb, bounds } = pieceGLB(santoriniPieces().board);
    const gltf = await loadGLB(glb);
    expect(gltf.scene.userData.connectors).toHaveLength(25);
    expect(gltf.scene.userData.connectors).toContainEqual({ position: [0.06, 0.04, -0.12] });
    // the spaces sit on the board's top surface
    expect(bounds.max[1]).toBeCloseTo(0.04);
  });

  it("a snap point's tags become its connector's", () => {
    expect(connectorsOf([[1, 2, 3], { position: [0, 0, 1], yaw: 0.5, tags: ["card"] }, { position: [0, 0, 2], tags: [] }])).toEqual([
      { position: [1, 2, 3] },
      { position: [0, 0, 1], rotation: [0, 0.5, 0], tags: ["card"] },
      { position: [0, 0, 2] },
    ]);
  });

  it("Lost Cities' board and hand trays carry card-only connectors", async () => {
    const pieces = lostCitiesPieces();
    for (const kind of ["board", "hand1", "hand2"]) {
      const gltf = await loadGLB(pieceGLB(pieces[kind]).glb);
      const connectors = gltf.scene.userData.connectors;
      expect(connectors.length).toBe(pieces[kind].snapPoints.length);
      for (const c of connectors) expect(c.tags).toEqual(["card"]);
    }
  });

  it("each piece stands on y = 0", () => {
    for (const p of Object.values(santoriniPieces())) expect(pieceGLB(p).bounds.min[1]).toBeCloseTo(0, 6);
  });

  it("draws each kind once and redraws it in place when its parts change", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    expect(await ensurePieceGLBs(repo, game)).toBe(8);
    const blue = game.doc().pieces.blue;
    expect(repo.docs.get(blue.glbUrl)).toMatchObject({ "@patchwork": { type: "file" }, extension: "glb", name: "Blue worker.glb" });
    expect(blue.glbKey).toBe(glbKey(blue));
    expect(await ensurePieceGLBs(repo, game)).toBe(0);

    const before = repo.docs.get(blue.glbUrl).content;
    game.change((d) => (d.pieces.blue.parts[0].color = "#ff0000"));
    expect(await ensurePieceGLBs(repo, game)).toBe(1);
    expect(game.doc().pieces.blue.glbUrl).toBe(blue.glbUrl);
    expect(repo.docs.get(blue.glbUrl).content).not.toEqual(before);
    // the count isn't geometry: no redraw
    game.change((d) => (d.pieces.blue.count = 3));
    expect(await ensurePieceGLBs(repo, game)).toBe(0);
  });
});

describe("setting up a table", () => {
  it("lays a supply out in rows", () => {
    const s = { at: [1, 2], cols: 3, gap: [0.1, -0.2] };
    expect(supplySpot(s, 0)).toEqual([1, 0, 2]);
    expect(supplySpot(s, 4)).toEqual([1.1, 0, 1.8]);
  });

  it("makes a scene with every piece, grouped by kind, opening in the hand", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    await ensurePieceGLBs(repo, game);
    const { scene } = setUp(game.doc(), game.url);
    const objects = Object.values(scene.objects);
    const pieces = objects.filter((o) => o.kind !== "group");
    expect(pieces).toHaveLength(1 + 22 + 18 + 14 + 18 + 6);
    expect(objects.filter((o) => o.kind === "group").map((g) => g.name)).toContain("Level 1 (22)");
    expect(scene.order).toHaveLength(objects.length);
    expect(scene.view).toMatchObject({ tool: "hand", snap: true, home: { position: expect.any(Array), target: expect.any(Array) } });
    // (Santorini has no seats, zones or hidden cards: nothing to play, so the doc doesn't say "play")
    expect(scene.view).not.toHaveProperty("activity");
    expect(scene.camera).toBeUndefined();

    const board = pieces.find((o) => o.name === "Island board");
    expect(board).toMatchObject({ locked: true, parent: null, providerId: "file-glb", renderUrl: null, sourceUrl: game.doc().pieces.board.glbUrl, infoUrl: game.url });
    for (const p of pieces) {
      expect(p.hint.bounds.min[1]).toBeCloseTo(0, 6);
      if (p !== board) expect(scene.objects[p.group].kind).toBe("group");
    }
  });

  it("starts nothing on top of anything else", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    await ensurePieceGLBs(repo, game);
    const { scene } = setUp(game.doc(), game.url);
    // the board's footprint is the sea; the rest is each piece's own box
    const boxes = Object.values(scene.objects)
      .filter((o) => o.kind !== "group")
      .map((o) => {
        const [x, , z] = o.transform.position;
        const b = o.hint.bounds;
        return { name: o.name, x0: x + b.min[0], x1: x + b.max[0], z0: z + b.min[2], z1: z + b.max[2] };
      });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        if (overlap) throw new Error(`${a.name} overlaps ${b.name}`);
      }
    }
  });

  it("refuses a piece that hasn't been drawn", () => {
    const d = {};
    loadSantorini(d);
    expect(() => tableLayout(d, { fileOf: gameFiles(d), gameUrl: "automerge:x" })).toThrow(/no GLB/);
  });

  it("Santorini is untagged: every piece may stand on every space", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    await ensurePieceGLBs(repo, game);
    const { scene } = setUp(game.doc(), game.url);
    expect(Object.values(scene.objects).some((o) => "tags" in o)).toBe(false);
    for (const p of Object.values(game.doc().pieces)) for (const c of connectorsOf(p.snapPoints)) expect(c.tags).toBeUndefined();
  });

  it("a game with nothing hidden has no decks and no seats", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo);
    await ensurePieceGLBs(repo, game);
    const t = setUp(game.doc(), game.url);
    expect(t.decks).toEqual({});
    expect(t.layout.seats).toEqual({});
    expect(t.scene.traits).toEqual({});
  });
});

describe("shuffle", () => {
  it("is a permutation", () => {
    const a = Array.from({ length: 60 }, (_, i) => i);
    const b = shuffle(a, seeded(7));
    expect(b).not.toEqual(a);
    expect([...b].sort((x, y) => x - y)).toEqual(a);
  });
});

describe("Lost Cities", () => {
  it("has 60 cards in five expeditions, every face the same size as the back", () => {
    const pieces = lostCitiesPieces();
    const cards = Object.values(pieces).filter((p) => p.hidden);
    expect(cards.reduce((n, p) => n + p.count, 0)).toBe(60);
    expect(cards).toHaveLength(EXPEDITIONS.length * 10);
    expect(new Set(cards.map((p) => p.back))).toEqual(new Set(["back"]));
    const back = pieceGLB(pieces.back).bounds;
    for (const p of cards) {
      const b = pieceGLB(p).bounds;
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeCloseTo(back.min[k], 6);
        expect(b.max[k]).toBeCloseTo(back.max[k], 6);
      }
    }
  });

  /** A Lost Cities table; `secure: false` for the plain secrets doc. */
  async function table(seed = 3, { secure = true } = {}) {
    const repo = fakeRepo();
    const game = await newGame(repo, loadLostCities);
    if (!secure) game.change((d) => (d.decks.main.secure = false));
    await ensurePieceGLBs(repo, game);
    const t = setUp(game.doc(), game.url, { rng: seeded(seed) });
    // which object is which card, as far as setup knows (before any shuffle by the players)
    const secrets = t.decks.main;
    const truth = secrets.objects ?? Object.fromEntries(Object.entries(secrets.slots).map(([id, k]) => [id, secrets.faces[k]]));
    t.secrets = secrets;
    return { game: game.doc(), ...t, truth };
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
    for (const [, o] of hand2) expect(o.transform.rotation).toEqual([0, Math.PI, 0]);
    const deck = cards.filter(([, o]) => o.transform.position[0] === 0.3);
    expect(deck).toHaveLength(44);
    for (const [, o] of deck) expect(o.transform.rotation[2]).toBe(Math.PI);
    // a stack: each a card's height above the last
    const ys = deck.map(([, o]) => o.transform.position[1]).sort((a, b) => a - b);
    const h = game.pieces.back.bounds.max[1];
    ys.forEach((y, j) => expect(y).toBeCloseTo((j + 1) * h, 6));

    expect(scene.traits["tabletop.seats"]).toEqual({ p1: expect.objectContaining({ name: "Player 1", player: null }), p2: expect.objectContaining({ name: "Player 2", player: null }) });
    const zones = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.zone"]);
    expect(zones.map((o) => o.traits["tabletop.zone"].seat).sort()).toEqual(["p1", "p2"]);
    expect(zones.every((o) => o.locked)).toBe(true);
  });

  it("tags every card, and nothing else, 'card'", async () => {
    const { scene, truth } = await table();
    const objects = Object.entries(scene.objects).filter(([, o]) => o.kind !== "group");
    for (const [id, o] of objects) {
      if (truth[id]) expect(o.tags).toEqual(["card"]);
      else expect(o.tags).toBeUndefined(); // the board and the trays
    }
    expect(objects.filter(([, o]) => o.tags)).toHaveLength(60);
  });

  it("says nothing in the scene about which card is which", async () => {
    const { game, scene, truth } = await table();
    const text = JSON.stringify(scene);
    for (const [kind, p] of Object.entries(game.pieces)) {
      if (!p.hidden) continue;
      expect(text).not.toContain(p.glbUrl);
      expect(text).not.toContain(`"${p.name}`);
      expect(text).not.toContain(kind);
    }
    // the cards are all just "Card", and in one group named for the deck
    const cards = Object.entries(scene.objects).filter(([id]) => truth[id]);
    expect(new Set(cards.map(([, o]) => o.name))).toEqual(new Set(["Card"]));
    expect(new Set(cards.map(([, o]) => o.sourceUrl))).toEqual(new Set([game.pieces.back.glbUrl]));
    expect(scene.objects[cards[0][1].group].name).toBe("Deck (60)");
    // and the secrets say exactly which 60
    const names = Object.values(truth).map((x) => x.name);
    expect(names.filter((n) => n === "Red wager")).toHaveLength(3);
    expect(names.filter((n) => n === "Blue 7")).toHaveLength(1);
  });

  it("a secure deck becomes a secure-deck doc for the players to shuffle: every card, one slot each", async () => {
    const { scene, secrets } = await table();
    expect(secrets).toMatchObject({ "@patchwork": { type: "secure-deck" }, group: "rfc3526-2048", phase: "waiting", participants: [], cards: null, epochs: {}, queue: [], op: null });
    expect(secrets.back).toMatchObject({ name: "Card" });
    expect(secrets.back.sourceUrl).toMatch(/^automerge:/);
    expect(secrets.faces).toHaveLength(60);
    expect(Object.values(secrets.slots).sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, k) => k));
    for (const id of Object.keys(secrets.slots)) expect(scene.objects[id].name).toBe("Card");
  });

  it("an ordinary deck gets a plain secrets doc", async () => {
    const { secrets } = await table(3, { secure: false });
    expect(secrets["@patchwork"].type).toBe("plain-deck");
    expect(Object.keys(secrets.objects)).toHaveLength(60);
  });

  it("gives every deck a doc of its own, each card pointing at its deck's", async () => {
    const repo = fakeRepo();
    const game = await newGame(repo, loadLostCities);
    // a second deck: the wagers, kept apart and not secure
    game.change((d) => {
      d.decks.wagers = { name: "Wagers", at: [-0.3, 0], faceDown: true };
      for (const ex of EXPEDITIONS) d.pieces[`${ex.key}-wager`].deck = "wagers";
    });
    await ensurePieceGLBs(repo, game);
    const { layout, scene, decks } = setUp(game.doc(), game.url, { rng: seeded(5) });
    expect(Object.keys(decks).sort()).toEqual(["main", "wagers"]);
    expect(decks.main["@patchwork"].type).toBe("secure-deck");
    expect(decks.main.faces).toHaveLength(45);
    expect(decks.wagers["@patchwork"].type).toBe("plain-deck");
    expect(Object.keys(decks.wagers.objects)).toHaveLength(15);
    // in the layout each card names its deck by id; written, by url
    const byOf = (objects) => new Set(Object.values(objects).filter((o) => o.traits?.["tabletop.hidden"]).map((o) => o.traits["tabletop.hidden"].by));
    expect(Object.values(layout.objects).filter((o) => o.traits?.["tabletop.hidden"])).toHaveLength(60);
    expect(byOf(layout.objects)).toEqual(new Set(["deck:main", "deck:wagers"]));
    expect(byOf(scene.objects)).toEqual(new Set(["automerge:deck-main", "automerge:deck-wagers"]));
    // a deck with no doc: nothing written
    const d = skeleton();
    expect(() => writeTable(d, layout, { main: "automerge:main" })).toThrow(/wagers/);
    expect(d).toEqual(skeleton());
  });

  it("shuffles differently each time", async () => {
    const a = await table(3);
    const b = await table(11);
    const handOf = (t) => Object.entries(t.scene.objects).filter(([id, o]) => t.truth[id] && o.transform.position[2] > 0.4).map(([id]) => t.truth[id].name).sort();
    expect(handOf(a)).not.toEqual(handOf(b));
  });
});

describe("one table writer: tableLayout + writeTable", () => {
  async function lostCities() {
    const repo = fakeRepo();
    const game = await newGame(repo, loadLostCities);
    await ensurePieceGLBs(repo, game);
    return game;
  }

  it("ids, order and every object say nothing about the shuffle: only the deck differs", async () => {
    const game = await lostCities();
    const a = tableLayout(game.doc(), { fileOf: gameFiles(game.doc()), rng: seeded(3) });
    const b = tableLayout(game.doc(), { fileOf: gameFiles(game.doc()), rng: seeded(11) });
    expect(a.order).toEqual(b.order);
    expect(JSON.stringify(a.objects)).toBe(JSON.stringify(b.objects));
    expect(a.decks.main.slots).toEqual(b.decks.main.slots);
    expect(a.decks.main.faces).not.toEqual(b.decks.main.faces);
  });

  it("deals onto the trays' card slots, each card turned to its slot", async () => {
    const game = await lostCities();
    const g = game.doc();
    const { scene } = setUp(g, game.url, { rng: seeded(3) });
    const hidden = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.hidden"]);
    for (const tray of ["hand1", "hand2"]) {
      const origin = supplySpot(g.pieces[tray].supply, 0);
      const slots = connectorsOf(g.pieces[tray].snapPoints).slice(0, 8);
      for (const c of slots) {
        expect(c.tags).toEqual(["card"]);
        const want = [origin[0] + c.position[0], c.position[1], origin[2] + c.position[2]];
        const on = hidden.filter((o) => o.transform.position.every((v, i) => Math.abs(v - want[i]) < 1e-5));
        expect(on).toHaveLength(1);
        expect(on[0].transform.rotation).toEqual([0, c.rotation[1], 0]);
      }
    }
  });

  it("writes the seats only where the scene has none, and the view's every setting", async () => {
    const game = await lostCities();
    const layout = tableLayout(game.doc(), { fileOf: gameFiles(game.doc()) });
    const urls = { main: "automerge:main" };
    const fresh = skeleton();
    writeTable(fresh, layout, urls);
    expect(Object.keys(fresh.traits["tabletop.seats"])).toEqual(["p1", "p2"]);
    expect(fresh.view).toEqual({ units: "cm", grid: false, axes: false, bounds: false, snap: true, tool: "hand", activity: "play", home: game.doc().camera });
    expect(fresh.order).toEqual(layout.order);

    const mine = { north: { name: "North", player: "automerge:ana" } };
    const busy = { ...skeleton(), objects: { x: { name: "Lamp" } }, order: ["x"], traits: { "tabletop.seats": structuredClone(mine) } };
    writeTable(busy, layout, urls);
    expect(busy.traits["tabletop.seats"]).toEqual(mine);
    expect(busy.order[0]).toBe("x");
    expect(busy.objects.x).toEqual({ name: "Lamp" });
    expect(busy.order).toHaveLength(1 + layout.order.length);
  });

  it("names the game as About only when there is a game doc", async () => {
    const game = await lostCities();
    const withGame = tableLayout(game.doc(), { fileOf: gameFiles(game.doc()), gameUrl: game.url });
    const without = tableLayout(game.doc(), { fileOf: gameFiles(game.doc()) });
    for (const o of Object.values(withGame.objects)) if (o.kind !== "group") expect(o).toMatchObject({ infoUrl: game.url, infoToolId: "tabletop-game" });
    for (const o of Object.values(without.objects)) {
      expect("infoUrl" in o).toBe(false);
      expect("infoToolId" in o).toBe(false);
    }
  });

  it("secure: false makes a secure deck plain", async () => {
    const game = await lostCities();
    const t = tableLayout(game.doc(), { fileOf: gameFiles(game.doc()), secure: false });
    expect(t.decks.main["@patchwork"].type).toBe("plain-deck");
    expect(Object.keys(t.decks.main.objects)).toHaveLength(60);
  });

  it("asks for each kind it shows, the backs included, and no other", async () => {
    const lc = {};
    loadLostCities(lc);
    expect(kindsUsed(lc).sort()).toEqual(Object.keys(lc.pieces).sort());
    const asked = new Set();
    tableLayout(lc, { fileOf: (k) => (asked.add(k), { url: `automerge:${k}`, hint: null }) });
    expect([...asked].sort()).toEqual(kindsUsed(lc).sort());
    const sa = {};
    loadSantorini(sa);
    sa.pieces.dome.count = 0;
    expect(kindsUsed(sa)).not.toContain("dome");
  });
});
