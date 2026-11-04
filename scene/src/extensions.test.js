// Scene extensions: which ones a scene calls for, and every part an instance
// can contribute, through the mounted tool (no WebGL).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FakeRepo, flush } from "./test/fake-repo.js";
import { takesDrop, wants } from "./extensions.js";

vi.mock("@inkandswitch/patchwork-plugins", () => {
  const registries = new Map();
  function makeRegistry() {
    const plugins = new Map();
    return {
      register(p) {
        plugins.set(p.id, { ...p });
      },
      has: (id) => plugins.has(id),
      get: (id) => plugins.get(id),
      filter: (fn) => [...plugins.values()].filter(fn),
      async load(id) {
        const p = plugins.get(id);
        if (!p) return undefined;
        if (!p.module) p.module = await p.load();
        return p;
      },
      on: () => () => {},
    };
  }
  return {
    getRegistry(type) {
      if (!registries.has(type)) registries.set(type, makeRegistry());
      return registries.get(type);
    },
  };
});

const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
const { plugins } = await import("./index.js");
const { SceneDatatype } = await import("./datatype.js");
const { default: SceneTool } = await import("./tool.js");
for (const p of plugins) getRegistry(p.type).register(p);

describe("which extensions a scene calls for", () => {
  const meta = { id: "t", traits: ["t.zone", "t.seats"], legacy: { scene: ["seats"], objects: ["zone"] } };
  it("by a trait on the scene or an object, or an old field it upgrades", () => {
    expect(wants(meta, { objects: {} })).toBe(false);
    expect(wants(meta, { traits: { "t.seats": {} }, objects: {} })).toBe(true);
    expect(wants(meta, { objects: { a: { traits: { "t.zone": {} } } } })).toBe(true);
    expect(wants(meta, { objects: { a: { traits: { "other.thing": {} } } } })).toBe(false);
    expect(wants(meta, { seats: {}, objects: {} })).toBe(true);
    expect(wants(meta, { objects: { a: { zone: {} } } })).toBe(true);
    expect(wants({ id: "x", always: true }, {})).toBe(true);
  });
  it("drops: the datatypes it names, or any for *", () => {
    expect(takesDrop({ drops: ["deck"] }, "deck")).toBe(true);
    expect(takesDrop({ drops: ["deck"] }, "file")).toBe(false);
    expect(takesDrop({ drops: ["*"] }, "file")).toBe(true);
    expect(takesDrop({}, "deck")).toBe(false);
  });
});

/** A test extension with every part, recording what the scene asked of it. */
function testExtension() {
  const calls = { updates: 0, ran: [], dropped: [], panelUpdates: 0, disposed: false };
  const ext = {
    calls,
    secret: { sourceUrl: null, name: "Ace of spades" },
    create(api) {
      calls.api = api;
      return {
        needsMigration: (d) => Object.values(d.objects ?? {}).some((o) => o.oldFlag != null),
        migrate(d) {
          for (const o of Object.values(d.objects ?? {})) {
            if (o.oldFlag == null) continue;
            if (!o.traits) o.traits = {};
            o.traits["test.flag"] = { value: o.oldFlag };
            delete o.oldFlag;
          }
        },
        update(scene) {
          calls.updates++;
          calls.scene = scene;
        },
        looks: () => new Map(Object.keys(calls.scene?.objects ?? {}).filter((id) => calls.scene.objects[id].traits?.["test.flag"]).map((id) => [id, { name: ext.secret.name }])),
        hud: () => [{ text: "Waiting for Bob", state: "loading" }],
        panels: [
          {
            id: "test.table",
            title: "Table",
            mount(el) {
              el.textContent = "seats here";
              return { update: () => calls.panelUpdates++, dispose() {} };
            },
          },
        ],
        commands: [{ id: "poke", name: "Poke", key: "k", appliesTo: (id) => !!calls.scene?.objects[id]?.traits?.["test.flag"], run: (id) => calls.ran.push(id) }],
        async drop({ url, doc }) {
          if (doc?.["@patchwork"]?.type !== "test-deck") return false;
          calls.dropped.push(url);
          return true;
        },
        landing: () => ({ faceUp: true }),
        dispose() {
          calls.disposed = true;
        },
      };
    },
  };
  return ext;
}

describe("a scene with an extension (mounted, no WebGL)", () => {
  let repo, element, cleanup, ext;
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      localStorage.clear();
    } catch {
      // none
    }
    repo = new FakeRepo();
    element = document.createElement("div");
    element.repo = repo;
    document.body.append(element);
    ext = testExtension();
    getRegistry("scene:extension").register({ type: "scene:extension", id: "test", name: "Test", traits: ["test.flag"], legacy: { objects: ["oldFlag"] }, drops: ["test-deck"], load: async () => ext });
  });
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    element.remove();
    vi.restoreAllMocks();
  });
  const newScene = (extra = {}) => {
    const doc = {};
    SceneDatatype.init(doc);
    return repo.add({ "@patchwork": { type: "scene" }, ...doc, ...extra });
  };
  const card = (extra = {}) => ({ name: "Card", sourceUrl: null, providerId: "file-glb", renderUrl: null, parent: null, visible: true, color: null, opacity: 1, wireframe: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...extra });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await flush();
  };

  it("isn't started for a scene that doesn't use it", async () => {
    const scene = newScene({ objects: { a: card() }, order: ["a"] });
    cleanup = SceneTool(scene, element);
    await settle();
    expect(ext.calls.api).toBeUndefined();
    expect(element.querySelector('[data-panel="test.table"]')).toBeNull();
  });

  it("upgrades its old fields, then shows its lens, HUD, panel and commands", async () => {
    const scene = newScene({ objects: { a: card({ oldFlag: 1 }), b: card() }, order: ["a", "b"] });
    cleanup = SceneTool(scene, element);
    await settle();
    // migrated once, in place
    expect(scene.doc().objects.a.oldFlag).toBeUndefined();
    expect(scene.doc().objects.a.traits["test.flag"]).toEqual({ value: 1 });
    expect(ext.calls.updates).toBeGreaterThan(0);
    // its api's snapshot resolves the world
    expect(ext.calls.scene.world("a")[0]).toBe(1);
    expect(ext.calls.scene.toLocal("a", [1, 2, 3])).toEqual([1, 2, 3]);
    // lens: the outline shows the secret name, only for the object it covers
    const name = (id) => element.querySelector(`.object-row[data-id="${id}"] .name`).textContent;
    expect(name("a")).toBe("Ace of spades");
    expect(name("b")).toBe("Card");
    // HUD and panel
    expect(element.querySelector(".hud").textContent).toContain("Waiting for Bob");
    const panel = element.querySelector('[data-panel="test.table"]');
    expect(panel.textContent).toContain("seats here");
    expect(ext.calls.panelUpdates).toBeGreaterThan(0);
    // commands: a button in the inspector, and the key, for what it applies to
    element.querySelector('.object-row[data-id="a"] .row-main').click();
    const button = [...element.querySelectorAll(".inspector .commands button")].find((b) => b.textContent === "Poke");
    expect(button).toBeTruthy();
    expect(element.querySelector(".inspector .name-input").readOnly).toBe(true); // a lens's name is never written back
    button.click();
    element.querySelector(".scene-tool").dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    expect(ext.calls.ran).toEqual(["a", "a"]);
    element.querySelector('.object-row[data-id="b"] .row-main').click();
    expect(element.querySelector(".inspector .commands")).toBeNull();
  });

  it("lays out a doc it takes when dropped, instead of a scene source", async () => {
    const scene = newScene({ objects: {}, order: [] });
    cleanup = SceneTool(scene, element);
    await settle();
    const deck = repo.add({ "@patchwork": { type: "test-deck" }, title: "Deck" });
    element.querySelector(".scene-tool").dispatchEvent(Object.assign(new Event("paste", { bubbles: true }), { clipboardData: { getData: () => deck.url } }));
    await settle();
    expect(ext.calls.dropped).toEqual([deck.url]);
    expect(Object.keys(scene.doc().objects)).toEqual([]);
  });

  it("orders panels by view.panels, folding the ones it doesn't list", async () => {
    const scene = newScene({ objects: { a: card({ traits: { "test.flag": {} } }) }, order: ["a"], view: { units: "m", panels: ["test.table", "inspector"] } });
    cleanup = SceneTool(scene, element);
    await settle();
    const order = [...element.querySelectorAll(".sidebar > [data-panel]")].map((s) => s.dataset.panel);
    expect(order).toEqual(["test.table", "inspector", "objects", "dimensions"]);
    expect(element.querySelector('[data-panel="objects"]').hasAttribute("data-folded")).toBe(true);
    expect(element.querySelector('[data-panel="test.table"]').hasAttribute("data-folded")).toBe(false);
    // unfolding is yours: click the title
    element.querySelector('[data-panel="objects"] [data-collapse]').click();
    expect(element.querySelector('[data-panel="objects"]').hasAttribute("data-folded")).toBe(false);
  });

  it("is disposed with the tool", async () => {
    const scene = newScene({ objects: { a: card({ traits: { "test.flag": {} } }) }, order: ["a"] });
    cleanup = SceneTool(scene, element);
    await settle();
    cleanup();
    cleanup = null;
    expect(ext.calls.disposed).toBe(true);
  });
});

describe("old scene fields", () => {
  it("view.defaultGizmo becomes view.defaultMode", async () => {
    const { migrateCore, needsCoreMigration } = await import("./migrate.js");
    const d = { view: { defaultGizmo: "translate" } };
    expect(needsCoreMigration(d)).toBe(true);
    migrateCore(d);
    expect(d.view).toEqual({ defaultMode: "move" });
    expect(needsCoreMigration(d)).toBe(false);
  });
});
