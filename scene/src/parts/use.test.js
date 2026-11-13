import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
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
    h.open("KeyE", a, { target: "capstan", ext: "g", command: "wind" });
    h.open("KeyR", b, { target: "gone" });
    expect(h.holding("g", "wind")).toBe(true);
    h.tick(0.016);
    expect(b.update).toHaveBeenCalledWith(0.016);
    h.cancelWhere((t) => t === "gone");
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

  const GAME = (requires = ["scene.use", "scene.keys"]) => ({
    meta: { id: "t.game", traits: ["t.level"], activities: ["play"], requires },
    module: game(log, sessions, walker, () => eye),
  });

  async function mount({ requires } = {}) {
    log = [];
    sessions = [];
    walker = { key: vi.fn((ev) => ev.key === "w") };
    eye = [0, 1.6, 4];
    s = await mountStage({ extensions: [GAME(requires), USE, KEYS], doc: DOC });
    await s.activity("play");
  }
  const hover = async (id) => {
    s.local.swap((m) => ({ ...m, hovered: id }));
    await settle();
  };
  const prompt = () => s.root.querySelector(".use-prompt");
  const verbs = () => [...prompt().querySelectorAll(".use-verb")].map((v) => v.textContent);
  const down = (key, extra = {}) => s.root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}`, ...extra }));
  const up = (key) => s.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}` }));

  it("runs in play when a game requires it", async () => {
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

  it("a verb is a button: a click runs it on its target", async () => {
    await mount();
    await hover("helm");
    prompt().querySelector('[data-command="helm"]').click();
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
        meta: { id: "t.probe", traits: ["t.level"], activities: ["play"], requires: ["scene.use"] },
        module: { create: () => ({ bodies: [{ id: "walk", label: "Walk", lock: true, reach: 2, enter: () => ({ input: {}, eye: () => ({ position: [1, 2, 3] }), leave() {} }) }], commands: [{ id: "look", name: "Look", key: "l", state: (t, ctx) => (seen.push(ctx), t === "barrel" ? {} : null), run() {} }] }) },
      };
      s = await mountStage({ extensions: [probe, USE], doc: DOC });
      await s.activity("play");
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

    it("cancels when the extension whose verb it is stops (back to editing)", async () => {
      await mount();
      await hover("capstan");
      down("e");
      await s.activity("edit");
      expect(sessions[0].cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("nothing shows while editing, and the game's verbs aren't there to run", async () => {
    await mount();
    await s.activity("edit");
    expect(s.instance("scene.use")).toBeNull();
    await hover("helm");
    expect(prompt()).toBeNull();
    s.key("f");
    expect(log).toEqual([]);
  });

  it("without a game that requires it, it doesn't run", async () => {
    await mount({ requires: ["scene.keys"] });
    expect(s.local.get().running.map((r) => r.id)).not.toContain("scene.use");
  });
});
