import { describe, it, expect, vi } from "vitest";
import TabletopGameTool from "./tool.js";

// A stand-in for the host's plugin registry, holding this package's plugins.
vi.mock("@inkandswitch/patchwork-plugins", async () => {
  const { plugins } = await import("./index.js");
  const registries = new Map();
  const getRegistry = (type) => {
    if (!registries.has(type)) {
      const all = new Map();
      registries.set(type, {
        register: (p) => all.set(p.id, { ...p }),
        filter: (fn) => [...all.values()].filter(fn),
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
    expect(Object.values(game.doc().pieces).every((p) => p.glbUrl)).toBe(true);
    await until(() => element.querySelector(".tables a")?.textContent === "Santorini table 1");

    cleanup();
    expect(element.children).toHaveLength(0);
  });

  it("applies an edited definition, keeping each kind's GLB doc", async () => {
    const repo = fakeRepo();
    const init = {};
    TabletopGameDatatype.init(init);
    const game = repo.add(init);
    const element = document.createElement("div");
    element.repo = repo;
    const cleanup = TabletopGameTool(game, element);
    await until(() => button(element, "Santorini"));
    button(element, "Santorini").click();
    await until(() => game.doc().pieces?.dome?.glbUrl);
    const glb = game.doc().pieces.dome.glbUrl;

    const area = element.querySelector(".json");
    const def = JSON.parse(area.value);
    def.pieces.dome.count = 20;
    area.value = JSON.stringify(def);
    button(element, "Apply").click();
    expect(game.doc().pieces.dome.count).toBe(20);
    expect(game.doc().pieces.dome.glbUrl).toBe(glb);
    expect(element.querySelector(".definition .muted").textContent).toBe("Applied.");

    element.querySelector(".json").value = "{ nope";
    button(element, "Apply").click();
    expect(element.querySelector(".definition .muted").textContent).toMatch(/Not applied/);
    cleanup();
  });

  it("sets up Lost Cities with its deck in a doc of its own, for the players to shuffle", async () => {
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
    expect(element.querySelector(".deck summary").textContent).toMatch(/60 cards of 50 kinds, shuffled by the players face down; deals 8 to Player 1's hand, 8 to Player 2's hand/);
    button(element, "Set up a table").click();
    await until(() => opened.length === 1, 4000);
    const scene = (await repo.find(opened[0].url)).doc();
    const urls = new Set(Object.values(scene.objects).filter((o) => o.traits?.["tabletop.hidden"]).map((o) => o.traits["tabletop.hidden"].by));
    expect(urls.size).toBe(1);
    const deck = (await repo.find([...urls][0])).doc();
    expect(deck["@patchwork"].type).toBe("secure-deck");
    expect(deck.faces).toHaveLength(60);
    for (const id of Object.keys(deck.slots)) expect(scene.objects[id].name).toBe("Card");
    cleanup();
  });
});
