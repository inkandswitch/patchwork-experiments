import { describe, it, expect, vi } from "vitest";
import TabletopGameTool from "./tool.js";

// A stand-in for the host's plugin registry, holding this package's plugins
// and, as other packages would register them, whoever owns seats and a
// keeper of each kind and the bag maker (test/stand-ins.js).
// `absent` hides plugins by id, so a test can uninstall a keeper, the seats owner or the bag maker.
const installed = vi.hoisted(() => ({ absent: new Set() }));
vi.mock("@inkandswitch/patchwork-plugins", async () => {
  const { plugins: own } = await import("./index.js");
  const { bagPlugin, keeperPlugin, seatsPlugin } = await import("./test/stand-ins.js");
  const plugins = [...own, seatsPlugin(), keeperPlugin("joint"), keeperPlugin("plain"), bagPlugin()];
  const registries = new Map();
  const getRegistry = (type) => {
    if (!registries.has(type)) {
      const all = new Map();
      registries.set(type, {
        register: (p) => all.set(p.id, { ...p }),
        filter: (fn) => [...all.values()].filter((p) => !installed.absent.has(p.id)).filter(fn),
        async load(id) {
          const p = all.get(id);
          if (p && !p.module) p.module = await p.load();
          return p;
        },
        on: () => () => {},
      });
    }
    return registries.get(type);
  };
  for (const p of plugins) getRegistry(p.type).register(p);
  return { getRegistry };
});
import { TabletopGameDatatype } from "./datatype.js";
import { SEATS, keptIn } from "./test/stand-ins.js";
import { CASES, cardsGame } from "./test/table-notes.js";

/** An in-memory repo whose handles emit "change". */
function fakeRepo() {
  const handles = new Map();
  let n = 0;
  const make = (url, doc) => {
    const listeners = new Set();
    const h = {
      url,
      doc: () => doc,
      change(fn) {
        doc = structuredClone(doc);
        fn(doc);
        for (const l of [...listeners]) l();
      },
      on: (ev, fn) => ev === "change" && listeners.add(fn),
      off: (ev, fn) => listeners.delete(fn),
    };
    handles.set(url, h);
    return h;
  };
  return {
    handles,
    add: (doc) => make(`automerge:doc${n++}`, structuredClone(doc)),
    async create2(doc) {
      return make(`automerge:doc${n++}`, structuredClone(doc));
    },
    async find(url) {
      const h = handles.get(url);
      if (!h) throw new Error("unavailable");
      return h;
    },
  };
}

const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent === text);

describe("the tabletop-game tool", () => {
  it("starts from Santorini, draws the pieces, and sets up a table it opens in the scene", async () => {
    const repo = fakeRepo();
    const init = {};
    TabletopGameDatatype.init(init);
    const game = repo.add({ "@patchwork": { type: "tabletop-game" }, ...init });
    const element = document.createElement("div");
    element.repo = repo;
    document.body.append(element);
    const opened = [];
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    const cleanup = TabletopGameTool(game, element);

    expect(button(element, "Set up a table").disabled).toBe(true);
    await until(() => button(element, "Santorini"));
    expect(button(element, "Lost Cities")).toBeTruthy();
    button(element, "Santorini").click();
    await until(() => game.doc().title === "Santorini");
    expect(element.querySelectorAll(".pieces tbody tr")).toHaveLength(8);

    button(element, "Set up a table").click();
    await until(() => opened.length === 1);
    const { url, toolId } = opened[0];
    expect(toolId).toBe("scene");
    const scene = (await repo.find(url)).doc();
    expect(scene["@patchwork"].type).toBe("scene");
    expect(Object.values(scene.objects).filter((o) => o.kind !== "group")).toHaveLength(79);
    expect(game.doc().tables).toEqual([url]);
    expect(Object.keys(game.doc().drawn).sort()).toEqual(Object.keys(game.doc().pieces).sort());
    // every object shows the game's own GLB (it redraws with the game), the game its About
    const glbs = new Set(Object.values(game.doc().drawn).map((f) => f.url));
    for (const o of Object.values(scene.objects)) if (o.kind !== "group") expect(o).toMatchObject({ sourceUrl: expect.any(String), infoUrl: game.url });
    for (const o of Object.values(scene.objects)) if (o.kind !== "group") expect(glbs.has(o.sourceUrl)).toBe(true);
    expect(scene).toMatchObject({ title: "Santorini table 1", assets: {}, dimensions: {} });
    expect(scene.view).not.toHaveProperty("tool");
    expect(scene.view.start.body).toBe("seat");
    await until(() => element.querySelector(".tables a")?.textContent === "Santorini table 1");
    // made with the packages list the stage fills in; with no scene package
    // registered here, it says only that it's a scene
    expect(scene.packages).toEqual([]);
    expect(scene["@patchwork"]).toEqual({ type: "scene" });
    // with the scene package registered (at the heads the module watcher
    // loaded), the next table carries it, bare, as its suggested import
    const SCENE = "automerge:2zt6LbnDAzvNj9WDNDA4ew21R85F";
    const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
    getRegistry("patchwork:datatype").register({ type: "patchwork:datatype", id: "scene", importUrl: `${SCENE}#${"H".repeat(48)}` });
    button(element, "Set up a table").click();
    await until(() => opened.length === 2);
    expect((await repo.find(opened[1].url)).doc()["@patchwork"]).toEqual({ type: "scene", suggestedImportUrl: SCENE });
    // a dev server's copy is nobody else's to load: left off
    getRegistry("patchwork:datatype").register({ type: "patchwork:datatype", id: "scene", importUrl: "http://localhost:5173/" });
    button(element, "Set up a table").click();
    await until(() => opened.length === 3);
    expect((await repo.find(opened[2].url)).doc()["@patchwork"]).toEqual({ type: "scene" });

    cleanup();
    expect(element.children).toHaveLength(0);
  });

  it("applies an edited definition that's a valid game, keeping each kind's GLB doc; refuses one that isn't, saying why", async () => {
    const repo = fakeRepo();
    const init = {};
    TabletopGameDatatype.init(init);
    const game = repo.add(init);
    const element = document.createElement("div");
    element.repo = repo;
    const cleanup = TabletopGameTool(game, element);
    await until(() => button(element, "Santorini"));
    button(element, "Santorini").click();
    await until(() => game.doc().drawn?.dome?.url);
    const glb = game.doc().drawn.dome.url;

    const area = element.querySelector(".json");
    const def = JSON.parse(area.value);
    // the definition is the game, and only the game: GAME-FORMAT.md
    expect(Object.keys(def).sort()).toEqual(["about", "format", "pieces", "players", "seats", "setup", "title", "version"]);
    def.setup.find((t) => t.piece === "dome").count = 20;
    area.value = JSON.stringify(def);
    button(element, "Apply").click();
    expect(game.doc().setup.find((t) => t.piece === "dome").count).toBe(20);
    expect(game.doc().drawn.dome.url).toBe(glb);
    expect(element.querySelector(".definition .muted").textContent).toBe("Applied.");

    element.querySelector(".json").value = "{ nope";
    button(element, "Apply").click();
    expect(element.querySelector(".definition .muted").textContent).toMatch(/Not applied/);

    def.setup.push({ piece: "teapot" });
    element.querySelector(".json").value = JSON.stringify(def);
    button(element, "Apply").click();
    expect(element.querySelector(".definition .muted").textContent).toMatch(/Not applied: unknown-piece at \$\.setup\[8\]\.piece: no piece "teapot"/);
    expect(game.doc().setup).toHaveLength(8);
    cleanup();
  });

  it("sets up Lost Cities with its deck in a container of its own, from a keeper whose players shuffle, and its seats from their owner", async () => {
    const repo = fakeRepo();
    const init = {};
    TabletopGameDatatype.init(init);
    const game = repo.add(init);
    const element = document.createElement("div");
    element.repo = repo;
    const opened = [];
    element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
    const cleanup = TabletopGameTool(game, element);
    await until(() => button(element, "Lost Cities"));
    button(element, "Lost Cities").click();
    await until(() => game.doc().title === "Lost Cities");
    expect(element.querySelector(".deck summary").textContent).toMatch(/60 cards of 50 kinds face down, to be shuffled by the players; deals 8 to Player 1's hand, 8 to Player 2's hand/);
    button(element, "Set up a table").click();
    await until(() => opened.length === 1, 4000);
    const scene = (await repo.find(opened[0].url)).doc();
    const cards = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.card"]);
    expect(cards).toHaveLength(60);
    const urls = new Set(cards.map((o) => keptIn(o).by));
    expect(urls.size).toBe(1);
    expect(new Set(cards.map((o) => keptIn(o).kind))).toEqual(new Set(["joint"]));
    const deck = (await repo.find([...urls][0])).doc();
    expect(deck.title).toBe("Lost Cities: Deck");
    expect(deck.items).toHaveLength(60);
    for (const o of cards) expect(o.name).toBe("Card");
    expect(Object.keys(scene.traits[SEATS])).toEqual(["p1", "p2"]);
    cleanup();
  }, 30_000); // builds the whole game: ~7 s seen under load (default 5 s)
});

describe("what the game page's status line tells the maker (test/table-notes.js: the template says the same)", () => {
  for (const c of CASES)
    it(c.name, async () => {
      // the stand-ins' ids (test/stand-ins.js): t.keep-<kind>, t.seats, t.bag
      installed.absent = new Set([
        ...["joint", "plain"].filter((k) => !c.keepers.includes(k)).map((k) => `t.keep-${k}`),
        ...(c.owner ? [] : ["t.seats"]),
        ...(c.bagMaker ? [] : ["t.bag"]),
      ]);
      try {
        const repo = fakeRepo();
        const game = repo.add({ "@patchwork": { type: "tabletop-game" }, ...cardsGame(c) });
        const element = document.createElement("div");
        element.repo = repo;
        const opened = [];
        element.addEventListener("patchwork:open-document", (e) => opened.push(e.detail));
        const cleanup = TabletopGameTool(game, element);
        await until(() => button(element, "Set up a table") && !button(element, "Set up a table").disabled);
        button(element, "Set up a table").click();
        await until(() => (c.error ? /^Couldn't/.test(element.querySelector(".status")?.textContent) : opened.length === 1) && button(element, "Set up a table"));
        const status = element.querySelector(".status").textContent;
        if (c.error) {
          expect(status).toBe(`Couldn't set up a table: ${c.error}`);
          expect(opened).toEqual([]);
          expect(game.doc().tables ?? []).toEqual([]);
        } else if (c.expected.length) {
          // one line of whole sentences, each warning its own
          expect(c.expected.every((n) => /\.$/.test(n))).toBe(true);
          expect(status).toBe(c.expected.join(" "));
        } else expect(status).toMatch(/^\d+ pieces of \d+ kinds\.$/);
        cleanup();
      } finally {
        installed.absent = new Set();
      }
    });
});

describe("a deck's summary on the game page says how it's shuffled, for every combination of shuffle and secure", () => {
  // a secure deck says what the game asks for: to be shuffled by its players, whatever `shuffle` says (a
  // joint keeper's first shuffle is of every card), not what this install will do (the plain fallback lays it
  // out as `shuffle` says). Ticking secure on an imported deck (which never says shuffle) once read
  // "… kinds by the players face down"; then "…, shuffled by the players", which the fallback belied
  const CASES = [
    { shuffle: false, secure: false, says: "Deck: 3 cards of 1 kinds face down" },
    { shuffle: true, secure: false, says: "Deck: 3 cards of 1 kinds, shuffled face down" },
    { shuffle: false, secure: true, says: "Deck: 3 cards of 1 kinds face down, to be shuffled by the players" },
    { shuffle: true, secure: true, says: "Deck: 3 cards of 1 kinds face down, to be shuffled by the players" },
  ];
  for (const c of CASES)
    it(`shuffle ${c.shuffle ? "yes" : "no"}, secure ${c.secure ? "yes" : "no"}`, () => {
      const g = cardsGame({ secure: c.secure, seats: false });
      if (c.shuffle) g.setup[0].deck.shuffle = true;
      const game = fakeRepo().add({ "@patchwork": { type: "tabletop-game" }, ...g });
      const element = document.createElement("div");
      element.repo = fakeRepo();
      const cleanup = TabletopGameTool(game, element);
      expect(element.querySelector(".deck summary").textContent).toBe(c.says);
      cleanup();
    });
});
