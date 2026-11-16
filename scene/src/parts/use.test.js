import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { emptyScene } from "../test/empty-scene.js";
import { LINK } from "../stage/links.js";
import { plugins } from "../index.js";
import keys, { heldSessions } from "./keys.js";
import use, { heldEntries, promptEntries } from "./use.js";
import { lookChain } from "../keymap.js";

// the real metadata, so these run the way a game would bring them in
const meta = (id) => {
  const { load: _load, type: _type, ...m } = plugins.find((p) => p.id === id);
  return m;
};
const USE = { meta: meta("scene.use"), module: use };
const KEYS = { meta: meta("scene.keys"), module: keys };

// A ship: a helm attached to it, a spoke attached to the helm, a capstan and
// a barrel on deck. The game's verbs are on the helm, the capstan and the
// barrel; the spoke has none of its own. It offers a body to walk in: W is
// its, and it locks the pointer.
function game(log, sessions, walker = { key: () => true }, eye = () => [0, 1.6, 4]) {
  return {
    create() {
      return {
        bodies: [{ id: "walk", label: "Walk", keys: [{ code: "KeyW", label: "Forward" }], lock: true, reach: 2, enter: () => ({ input: walker, eye: () => ({ position: eye(), direction: [0, 0, -1] }), leave() {} }) }],
        commands: [
          { id: "helm", name: "Take the helm", key: "f", state: (t) => (t === "helm" ? {} : null), run: (t, v) => log.push(["helm", t, v]) },
          { id: "steer-menu", name: "Steer (menu only)", key: "x", show: ["menu"], state: (t) => (t === "helm" ? {} : null), run: () => log.push(["steer-menu"]) },
          { id: "no-key", name: "Admire", state: (t) => (t === "helm" ? {} : null), run: () => log.push(["no-key"]) },
          {
            id: "wind",
            name: "Wind the capstan",
            key: "e",
            hold: true,
            state: (t) => (t === "capstan" ? {} : null),
            run: (t) => {
              const s = { end: vi.fn(), cancel: vi.fn(), update: vi.fn() };
              sessions.push(s);
              log.push(["wind", t]);
              return s;
            },
          },
          // a second verb on the capstan, for while the first is held
          { id: "pawl", name: "Drop the pawl", key: "p", state: (t) => (t === "capstan" ? {} : null), run: (t) => log.push(["pawl", t]) },
          // only within the body's reach (the stage measures it)
          { id: "grab", name: "Pick up", key: "g", reach: true, state: (t) => (t === "barrel" ? {} : null), run: (t) => log.push(["grab", t]) },
          // a scene verb on F: the key map runs it when what's looked at has no F
          { id: "flag", name: "Raise the flag", key: "f", run: () => log.push(["flag"]) },
          // walking, W is the body's
          { id: "wave", name: "Wave", key: "w", state: (t) => (t === "barrel" ? {} : null), run: () => log.push(["wave"]) },
        ],
      };
    },
  };
}

const DOC = {
  traits: { "t.level": {} },
  objects: {
    ship: object({ name: "Ship" }),
    helm: object({ name: "Helm", parent: "ship" }),
    spoke: object({ name: "Spoke", parent: "helm" }),
    capstan: object({ name: "Capstan", parent: "ship" }),
    barrel: object({ name: "Barrel" }),
  },
  order: ["ship", "helm", "spoke", "capstan", "barrel"],
};

describe("scene.use, the pure side", () => {
  const scene = { objects: DOC.objects, parents: new Map([["helm", "ship"], ["spoke", "helm"], ["capstan", "ship"]]) };
  const collected = [{ id: "t.game", value: game([], []).create().commands }];

  it("a look reaches the object, then what it's attached to", () => {
    expect(lookChain("spoke", scene.parents)).toEqual(["spoke", "helm", "ship"]);
    expect(lookChain("barrel", scene.parents)).toEqual(["barrel"]);
    expect(lookChain(null, scene.parents)).toEqual([]);
  });

  it("offers the nearest target with keyed verbs shown on use; a selection is attention's, the look plays no part", () => {
    const ctx = { scene, local: {}, from: [0, 0, 5], reach: Infinity, hit: { id: "spoke" }, distance: () => 1 };
    const found = promptEntries(collected, { selected: null, hit: { id: "spoke" } }, ctx);
    expect(found.target).toBe("helm");
    expect(found.entries.map((e) => e.command.id)).toEqual(["helm"]);
    expect(promptEntries(collected, { selected: null, hit: { id: "ship" } }, ctx)).toBeNull();
    expect(promptEntries(collected, { selected: "capstan", hit: null }, ctx).target).toBe("capstan");
    // reach: beyond it, the verb shows disabled, "too far"
    const far = promptEntries(collected, { selected: null, hit: { id: "barrel" } }, { ...ctx, reach: 2, distance: () => 3 });
    expect(far.entries.map((e) => [e.command.id, !!e.state.disabled, e.state.title ?? null])).toEqual([
      ["grab", true, "too far"],
      ["wave", false, null],
    ]);
  });

  it("shows at most three", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, key: `${i}`, state: () => ({}), run() {} }));
    expect(promptEntries([{ id: "x", value: many }], { selected: "barrel" }, { scene, local: {} }).entries).toHaveLength(3);
  });

  it("while something's held: the held verbs first, as pressed (even where they no longer apply), then the target's others now", () => {
    const ctx = { scene, local: {}, from: [0, 0, 5], hit: { id: "barrel" } };
    const flat = collected[0].value;
    const wind = { ext: "t.game", command: flat.find((c) => c.id === "wind"), state: { label: "Winding" } };
    const out = heldEntries(collected, "capstan", [wind], ctx);
    expect(out.target).toBe("capstan");
    expect(out.entries.map((e) => [e.command.id, e.state.label ?? null])).toEqual([["wind", "Winding"], ["pawl", null]]);
    // its target gone: only what was held
    const gone = heldEntries(collected, "capstan", [wind], { ...ctx, scene: { ...scene, objects: {} } });
    expect(gone.entries.map((e) => e.command.id)).toEqual(["wind"]);
  });

  it("held sessions (scene.keys'): tick, end, cancel, and a failure stays its own", () => {
    const h = heldSessions();
    const a = { end: vi.fn(), cancel: vi.fn(), update: vi.fn(() => { throw new Error("x"); }) };
    const b = { end: vi.fn(), cancel: vi.fn(), update: vi.fn() };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.open("KeyE", a, { path: ["L", "capstan"], ext: "g", command: "wind", entry: { ext: "g" } });
    h.open("KeyR", b, { path: ["gone"] });
    expect(h.holding("g", "wind")).toBe(true);
    // the pin is the first held verb's target's path; entries are matched by the whole path
    expect(h.path).toEqual(["L", "capstan"]);
    expect([h.entries(["L", "capstan"]).length, h.entries(["capstan"]).length]).toEqual([1, 0]);
    h.tick(0.016);
    expect(b.update).toHaveBeenCalledWith(0.016);
    h.cancelWhere((p) => p.at(-1) === "gone");
    expect(b.cancel).toHaveBeenCalledTimes(1);
    expect(h.end("KeyE")).toBe(true);
    expect(a.end).toHaveBeenCalledTimes(1);
    expect(h.size).toBe(0);
    warn.mockRestore();
  });
});

describe("scene.use", () => {
  let s, log, sessions, walker, eye;
  afterEach(() => {
    s?.unmount();
    s = null;
    delete document.pointerLockElement;
    vi.restoreAllMocks();
  });

  const GAME = () => ({
    meta: { id: "t.game", traits: ["t.level"] },
    module: game(log, sessions, walker, () => eye),
  });

  async function mount() {
    log = [];
    sessions = [];
    walker = { key: vi.fn((ev) => ev.key === "w") };
    eye = [0, 1.6, 4];
    s = await mountStage({ extensions: [GAME(), USE, KEYS], doc: DOC });
    await settle();
  }
  const hover = async (id) => {
    s.local.swap((m) => ({ ...m, hovered: id }));
    await settle();
  };
  const prompt = () => s.root.querySelector(".use-prompt");
  const verbs = () => [...prompt().querySelectorAll(".use-verb")].map((v) => v.textContent);
  const down = (key, extra = {}) => s.root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}`, ...extra }));
  const up = (key) => s.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}` }));

  it("runs in every scene: general, as the key map is", async () => {
    await mount();
    expect(s.local.get().running.map((r) => r.id)).toEqual(["t.game", "scene.use", "scene.keys"]);
  });

  it("hovering something with verbs shows them; its key (the key map's) runs the verb on it", async () => {
    await mount();
    expect(prompt().hidden).toBe(true);
    await hover("helm");
    expect(prompt().hidden).toBe(false);
    // not the menu-only verb, nor the one without a key
    expect(verbs()).toEqual(["FTake the helm"]);
    expect(prompt().querySelector("kbd").textContent).toBe("F");
    s.key("f");
    expect(log).toEqual([["helm", "helm", undefined]]);
    // nothing in view: F is the scene's
    await hover(null);
    expect(prompt().hidden).toBe(true);
    s.key("f");
    expect(log.at(-1)).toEqual(["flag"]);
  });

  it("shows nothing while a gesture is open (a carry: its keys come first), and comes back after", async () => {
    await mount();
    await hover("helm");
    expect(prompt().hidden).toBe(false);
    s.local.swap((m) => ({ ...m, gesture: { owner: "scene.carry", keys: [{ code: "KeyF", label: "Flip" }] } }));
    await settle();
    expect(prompt().hidden).toBe(true);
    s.local.swap((m) => ({ ...m, gesture: null }));
    await settle();
    expect(prompt().hidden).toBe(false);
  });

  it("a verb is a button: a click runs it on its target", async () => {
    await mount();
    await hover("helm");
    prompt().querySelector('[data-command="helm"]').click();
    expect(log).toEqual([["helm", "helm", undefined]]);
  });

  it("a verb's button can be reached with a mouse: the prompt follows the pointer over the world, and stays put while the pointer is over the prompt, or anything else put over the world", async () => {
    await mount();
    await hover("helm");
    // another part's overlay (the touch pad, the body chip)
    const other = s.api("t.game").overlay();
    const pad = other.appendChild(document.createElement("button"));
    const at = () => [prompt().style.getPropertyValue("--use-x"), prompt().style.getPropertyValue("--use-y")];
    const move = (target, x, y) => target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
    const origin = s.port.getBoundingClientRect();
    const px = (x, y) => [`${x - origin.left}px`, `${y - origin.top}px`];
    const button = prompt().querySelector('[data-command="helm"]');
    // every way the pointer goes: over the world (the port, the canvas), onto the prompt, onto its button, back to the world
    for (const [where, target, x, y, want] of [
      ["the world", () => s.port, 100, 80, px(100, 80)],
      ["the canvas", () => s.canvas, 120, 90, px(120, 90)],
      ["the prompt", () => prompt(), 120, 130, px(120, 90)],
      ["its button", () => button, 125, 132, px(120, 90)],
      ["its key", () => button.querySelector("kbd"), 110, 131, px(120, 90)],
      ["another part's overlay", () => other, 20, 300, px(120, 90)],
      ["a button on it", () => pad, 22, 302, px(120, 90)],
      ["the world again", () => s.canvas, 200, 50, px(200, 50)],
    ]) {
      move(target(), x, y);
      expect([where, at()]).toEqual([where, want]);
    }
    // and the click on it runs the verb
    button.click();
    expect(log).toEqual([["helm", "helm", undefined]]);
  });

  it("looking at a part offers what it's attached to", async () => {
    await mount();
    await hover("spoke");
    expect(verbs()).toEqual(["FTake the helm"]);
    s.key("f");
    expect(log).toEqual([["helm", "helm", undefined]]);
  });

  it("ignores auto-repeat, and keys with ctrl or meta", async () => {
    await mount();
    await hover("helm");
    down("f");
    down("f", { repeat: true });
    up("f");
    s.key("f", { ctrlKey: true });
    expect(log).toEqual([["helm", "helm", undefined]]);
  });

  describe("walking (a body that locks the pointer)", () => {
    async function walking({ hitId = "spoke", distance = 1.5 } = {}) {
      await mount();
      const vp = s.debug.viewport;
      vp.centerRay = () => ({ origin: eye, dir: [0, 0, -1] });
      vp.raycast = () => (hitId ? { id: hitId, point: [0, 1, 0], normal: null, distance } : null);
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => s.canvas });
      expect(s.api("t.game").body.enter("walk")).toBe(true);
      document.dispatchEvent(new Event("pointerlockchange"));
      await settle();
      return vp;
    }

    it("looks along the middle of the view; the body's declared keys are its, the rest the key map's", async () => {
      await walking();
      expect(s.local.get().body.id).toBe("walk");
      expect(s.local.get().pointer.locked).toBe(true);
      expect(verbs()).toEqual(["FTake the helm"]);
      s.key("w");
      expect(log).toEqual([]);
      s.key("f");
      expect(walker.key).toHaveBeenCalledTimes(1);
      expect(log).toEqual([["helm", "helm", undefined]]);
    });

    it("a verb whose key the body reserves shows without it, and no key runs it", async () => {
      await walking({ hitId: "barrel", distance: 1 });
      expect(verbs()).toEqual(["GPick up", "Wave"]);
      s.key("w");
      expect(log).toEqual([]);
    });

    it("a reach verb beyond the body's reach shows disabled, too far, and its key does nothing; within reach it runs", async () => {
      const vp = await walking({ hitId: "barrel", distance: 3 });
      expect(prompt().querySelector('[data-command="grab"]').hasAttribute("data-disabled")).toBe(true);
      expect(prompt().querySelector('[data-command="grab"]').title).toBe("too far");
      expect(prompt().querySelector('[data-command="grab"] kbd')).toBeNull();
      s.key("g");
      expect(log).toEqual([]);
      // stepping up to it (the prompt looks again every frame while walking; a lock change does at once)
      vp.raycast = () => ({ id: "barrel", point: [0, 1, 0], normal: null, distance: 1.5 });
      document.dispatchEvent(new Event("pointerlockchange"));
      await settle();
      expect(verbs()[0]).toBe("GPick up");
      s.key("g");
      expect(log).toEqual([["grab", "barrel"]]);
    });

    it("hands state the context: the body's eye and reach, and the hit it looked at", async () => {
      const seen = [];
      log = [];
      sessions = [];
      const probe = {
        meta: { id: "t.probe", traits: ["t.level"] },
        module: { create: () => ({ bodies: [{ id: "walk", label: "Walk", lock: true, reach: 2, enter: () => ({ input: {}, eye: () => ({ position: [1, 2, 3] }), leave() {} }) }], commands: [{ id: "look", name: "Look", key: "l", state: (t, ctx) => (seen.push(ctx), t === "barrel" ? {} : null), run() {} }] }) },
      };
      s = await mountStage({ extensions: [probe, USE], doc: DOC });
      await settle();
      s.debug.viewport.centerRay = () => ({ origin: [1, 2, 3], dir: [0, 0, -1] });
      s.debug.viewport.raycast = () => ({ id: "barrel", point: [0, 1, 0], normal: [0, 1, 0], distance: 2.5 });
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => s.canvas });
      s.api("t.probe").body.enter("walk");
      document.dispatchEvent(new Event("pointerlockchange"));
      await settle();
      const ctx = seen.at(-1);
      expect(ctx.from).toEqual([1, 2, 3]);
      expect(ctx.reach).toBe(2);
      expect(ctx.hit).toEqual({ id: "barrel", point: [0, 1, 0], distance: 2.5 });
      expect(ctx.distance("barrel")).toBe(2.5);
      expect(Object.keys(ctx.scene.objects)).toContain("barrel");
    });
  });

  describe("held verbs", () => {
    it("shows hold, lasts while the key is down, and ends on its release", async () => {
      await mount();
      await hover("capstan");
      expect(verbs()).toEqual(["holdEWind the capstan", "PDrop the pawl"]);
      down("e");
      expect(sessions).toHaveLength(1);
      expect(prompt().querySelector(".use-verb").hasAttribute("data-held")).toBe(true);
      down("e", { repeat: true });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].end).not.toHaveBeenCalled();
      up("e");
      expect(sessions[0].end).toHaveBeenCalledTimes(1);
      expect(sessions[0].cancel).not.toHaveBeenCalled();
      expect(prompt().querySelector(".use-verb").hasAttribute("data-held")).toBe(false);
    });

    it("keeps its target until release: looking away, the prompt stays on it, its repeat and the target's other keys are its; then it follows the look", async () => {
      await mount();
      await hover("capstan");
      down("e");
      expect(sessions).toHaveLength(1);
      // the look moves on to the helm while E is down
      await hover("helm");
      expect(verbs()).toEqual(["holdEWind the capstan", "PDrop the pawl"]);
      expect(prompt().querySelector(".use-verb").hasAttribute("data-held")).toBe(true);
      down("e", { repeat: true });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].end).not.toHaveBeenCalled();
      // the held target's other verb, by its key: on the capstan, not on what's looked at
      s.key("p");
      expect(log.at(-1)).toEqual(["pawl", "capstan"]);
      // F isn't the capstan's: the scene's, not the helm looked at
      s.key("f");
      expect(log.some((l) => l[0] === "helm")).toBe(false);
      up("e");
      expect(sessions[0].end).toHaveBeenCalledTimes(1);
      expect(verbs()).toEqual(["FTake the helm"]);
      s.key("f");
      expect(log.at(-1)).toEqual(["helm", "helm", undefined]);
    });

    it("looking at nothing mid-hold, the held verb stays shown (held) on its target until release", async () => {
      await mount();
      await hover("capstan");
      down("e");
      await hover(null);
      expect(prompt().hidden).toBe(false);
      expect(verbs()[0]).toBe("holdEWind the capstan");
      expect(prompt().querySelector(".use-verb").hasAttribute("data-held")).toBe(true);
      up("e");
      expect(prompt().hidden).toBe(true);
    });

    it("cancels when the window loses focus", async () => {
      await mount();
      await hover("capstan");
      down("e");
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      window.dispatchEvent(new Event("blur"));
      expect(sessions[0].cancel).toHaveBeenCalledTimes(1);
      expect(sessions[0].end).not.toHaveBeenCalled();
    });

    it("cancels when its target goes", async () => {
      await mount();
      await hover("capstan");
      down("e");
      s.change((d) => {
        delete d.objects.capstan;
        d.order = d.order.filter((id) => id !== "capstan");
      });
      await settle();
      expect(sessions[0].cancel).toHaveBeenCalledTimes(1);
    });

    it("cancels when the extension whose verb it is stops (uninstalled)", async () => {
      await mount();
      await hover("capstan");
      down("e");
      await s.uninstall("t.game");
      expect(sessions[0].cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("with the game gone, nothing shows and its verbs aren't there to run", async () => {
    await mount();
    await s.uninstall("t.game");
    expect(s.instance("scene.use")).toBeTruthy();
    await hover("helm");
    expect(prompt()?.hidden ?? true).toBe(true);
    s.key("f");
    expect(log).toEqual([]);
  });
});

// A held verb's target in a linked doc (COMPOSITION.md §5): the pin is the
// target's path, so it holds wherever the look goes (onto the host's deck,
// onto nothing), the target's other keys are its, a change to the host's
// doc is no reason to let go, and it lets go when the target goes from its
// own doc, when its link goes, or when its extension stops there.
describe("held verbs across links", () => {
  let s, log, sessions, repo, gameDoc;
  afterEach(() => {
    s?.unmount();
    s = null;
    vi.restoreAllMocks();
  });
  async function mount() {
    log = [];
    sessions = [];
    repo = new FakeRepo();
    gameDoc = repo.add(emptyScene({ ...DOC, title: "G" }));
    s = await mountStage({
      repo,
      extensions: [{ meta: { id: "t.game", traits: ["t.level"] }, module: game(log, sessions) }, USE, KEYS],
      doc: { objects: { deck: object({ name: "Deck" }), L: object({ name: "Ship", sourceUrl: gameDoc.url, providerId: LINK, renderUrl: null, parent: "deck" }) }, order: ["deck", "L"] },
    });
    await until(() => s.debug.view.stages().length === 2 && s.debug.view.stages()[1].debug.host.instanceOf("t.game"));
    await settle();
  }
  const hover = async (path) => {
    s.debug.view.atom.swap((v) => ({ ...v, hovered: path == null ? null : Object.freeze(path) }));
    await settle();
  };
  const prompt = () => s.root.querySelector(".use-prompt");
  const verbs = () => [...prompt().querySelectorAll(".use-verb")].map((v) => v.textContent);
  const down = (key) => s.root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}` }));
  const up = (key) => s.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}` }));
  const pinned = () => s.api("scene.use").collect("keymap").map((r) => r.value).find((v) => v?.pinned)?.pinned();

  it("holds the target's path wherever the look goes; its other keys are its; the host's doc changing doesn't let go", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await mount();
    await hover(["L", "capstan"]);
    expect(verbs()).toEqual(["holdEWind the capstan", "PDrop the pawl"]);
    down("e");
    expect(log).toEqual([["wind", "capstan"]]);
    expect(pinned()).toEqual(["L", "capstan"]);
    for (const where of [["deck"], null, ["L", "barrel"]]) {
      await hover(where);
      expect(verbs()).toEqual(["holdEWind the capstan", "PDrop the pawl"]);
      s.key("p");
      expect(log.at(-1)).toEqual(["pawl", "capstan"]);
    }
    s.change((d) => (d.objects.deck.name = "Foredeck"));
    await settle();
    await hover(["deck"]);
    expect(sessions[0].cancel).not.toHaveBeenCalled();
    up("e");
    expect(sessions[0].end).toHaveBeenCalledTimes(1);
    expect(pinned()).toBe(undefined);
  });

  for (const how of ["its target goes from its doc", "its link goes", "its extension stops"]) {
    it(`lets go when ${how}`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await mount();
      await hover(["L", "capstan"]);
      down("e");
      await hover(["deck"]);
      if (how === "its target goes from its doc")
        gameDoc.change((d) => {
          delete d.objects.capstan;
          d.order = d.order.filter((id) => id !== "capstan");
        });
      else if (how === "its link goes")
        s.change((d) => {
          delete d.objects.L;
          d.order = d.order.filter((id) => id !== "L");
        });
      else await s.uninstall("t.game");
      await settle();
      // (what's held is looked at whenever the focus's parts are told anything, and every frame, which
      // these tests have none of: a look moving is something)
      await hover(null);
      await until(() => sessions[0].cancel.mock.calls.length === 1, 2000);
      expect(sessions[0].end).not.toHaveBeenCalled();
      expect(pinned()).toBe(undefined);
    });
  }
});
