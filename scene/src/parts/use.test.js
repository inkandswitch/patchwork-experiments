import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { plugins } from "../index.js";
import keys from "./keys.js";
import use, { heldSessions, lookChain, useEntries } from "./use.js";

// the real metadata, so these run the way a game would bring them in
const meta = (id) => {
  const { load: _load, type: _type, ...m } = plugins.find((p) => p.id === id);
  return m;
};
const USE = { meta: meta("scene.use"), module: use };
const KEYS = { meta: meta("scene.keys"), module: keys };

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// A ship: a helm attached to it, a spoke attached to the helm, a capstan and
// a barrel on deck. The game's verbs are on the helm, the capstan and the
// barrel; the spoke has none of its own.
function game(log, sessions) {
  return {
    create(api) {
      return {
        arm: (handlers = {}) => api.arm(handlers, { lock: true, immersive: true }),
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
          {
            // only within arm's reach of the barrel (at the origin)
            id: "grab",
            name: "Pick up",
            key: "g",
            state: (t, { from }) => (t === "barrel" && from && dist(from, [0, 0, 0]) < 2 ? {} : null),
            run: (t) => log.push(["grab", t]),
          },
          // a scene verb on F: the key map would run it, if the prompt didn't hear F first
          { id: "flag", name: "Raise the flag", key: "f", run: () => log.push(["flag"]) },
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

  it("a look reaches the object, then what it's attached to", () => {
    expect(lookChain("spoke", scene.parents)).toEqual(["spoke", "helm", "ship"]);
    expect(lookChain("barrel", scene.parents)).toEqual(["barrel"]);
    expect(lookChain(null, scene.parents)).toEqual([]);
  });

  it("offers the nearest target with keyed verbs shown on use", () => {
    const collected = [{ id: "t.game", value: game([], []).create({ arm: () => {} }).commands }];
    const ctx = { scene, local: {}, from: [0, 0, 5], hit: { id: "spoke" } };
    const found = useEntries(collected, lookChain("spoke", scene.parents), ctx);
    expect(found.target).toBe("helm");
    expect(found.entries.map((e) => e.command.id)).toEqual(["helm"]);
    expect(useEntries(collected, ["ship"], ctx)).toBeNull();
    // reach: the barrel's verb needs the eye near it
    expect(useEntries(collected, ["barrel"], ctx)).toBeNull();
    expect(useEntries(collected, ["barrel"], { ...ctx, from: [0, 1, 1] }).entries.map((e) => e.command.id)).toEqual(["grab"]);
  });

  it("shows at most three", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, key: `${i}`, state: () => ({}), run() {} }));
    expect(useEntries([{ id: "x", value: many }], ["barrel"], { scene, local: {} }).entries).toHaveLength(3);
  });

  it("held sessions: tick, end, cancel, and a failure stays its own", () => {
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
  let s, log, sessions;
  afterEach(() => {
    s?.unmount();
    s = null;
    delete document.pointerLockElement;
    vi.restoreAllMocks();
  });

  const GAME = (requires = ["scene.use", "scene.keys"]) => ({
    meta: { id: "t.game", traits: ["t.level"], activities: ["play"], requires },
    module: game(log, sessions),
  });

  async function mount({ requires } = {}) {
    log = [];
    sessions = [];
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

  it("runs in play when a game requires it, before the key map", async () => {
    await mount();
    expect(s.local.get().running.map((r) => r.id)).toEqual(["t.game", "scene.use", "scene.keys"]);
  });

  it("hovering something with verbs shows them; its key runs the verb on it", async () => {
    await mount();
    expect(prompt().hidden).toBe(true);
    await hover("helm");
    expect(prompt().hidden).toBe(false);
    // not the menu-only verb, nor the one without a key
    expect(verbs()).toEqual(["FTake the helm"]);
    expect(prompt().querySelector("kbd").textContent).toBe("F");
    s.key("f");
    expect(log).toEqual([["helm", "helm", undefined]]);
    // nothing in view: F is the key map's again
    await hover(null);
    expect(prompt().hidden).toBe(true);
    s.key("f");
    expect(log.at(-1)).toEqual(["flag"]);
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

  describe("in first person (an arm holds the pointer lock)", () => {
    async function firstPerson({ hitId = "spoke", eye = [0, 1.6, 4] } = {}) {
      await mount();
      const u = s.api("scene.use");
      u.ray = () => ({ origin: eye, dir: [0, 0, -1] });
      u.raycast = () => (hitId ? { id: hitId, point: [0, 1, 0], normal: null, distance: 1.5 } : null);
      // the walker: it passes every key but W
      const walker = { key: vi.fn((ev) => ev.key === "w") };
      s.instance("t.game").arm(walker);
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => s.canvas });
      document.dispatchEvent(new Event("pointerlockchange"));
      await settle();
      return walker;
    }

    it("looks along the middle of the view, and hears keys the walker passes", async () => {
      const walker = await firstPerson();
      expect(s.local.get().armed).toBe("t.game");
      expect(verbs()).toEqual(["FTake the helm"]);
      s.key("w");
      expect(log).toEqual([]);
      s.key("f");
      expect(walker.key).toHaveBeenCalledTimes(2);
      expect(log).toEqual([["helm", "helm", undefined]]);
    });

    it("passes the eye and the hit, so a verb can ask for reach", async () => {
      await firstPerson({ hitId: "barrel", eye: [0, 1.6, 4] });
      expect(prompt().hidden).toBe(true);
      s.key("g");
      expect(log).toEqual([]);
      // stepping up to it (the next frame would see it; a lock change looks again at once)
      s.api("scene.use").ray = () => ({ origin: [0, 1.2, 0.8], dir: [0, -1, -1] });
      document.dispatchEvent(new Event("pointerlockchange"));
      expect(verbs()).toEqual(["GPick up"]);
      s.key("g");
      expect(log).toEqual([["grab", "barrel"]]);
    });

    it("hands state the hit it looked at", async () => {
      const seen = [];
      log = [];
      sessions = [];
      const probe = {
        meta: { id: "t.probe", traits: ["t.level"], activities: ["play"], requires: ["scene.use"] },
        module: { create: (api) => ({ arm: (h) => api.arm(h, { lock: true }), commands: [{ id: "look", name: "Look", key: "l", state: (t, ctx) => (seen.push(ctx), t === "barrel" ? {} : null), run() {} }] }) },
      };
      s = await mountStage({ extensions: [probe, USE], doc: DOC });
      await s.activity("play");
      const u = s.api("scene.use");
      u.ray = () => ({ origin: [1, 2, 3], dir: [0, 0, -1] });
      u.raycast = () => ({ id: "barrel", point: [0, 1, 0], normal: [0, 1, 0], distance: 2.5 });
      s.instance("t.probe").arm({});
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => s.canvas });
      document.dispatchEvent(new Event("pointerlockchange"));
      const ctx = seen.at(-1);
      expect(ctx.from).toEqual([1, 2, 3]);
      expect(ctx.hit).toEqual({ id: "barrel", point: [0, 1, 0], distance: 2.5 });
      expect(Object.keys(ctx.scene.objects)).toContain("barrel");
    });
  });

  describe("held verbs", () => {
    it("shows hold, lasts while the key is down, and ends on its release", async () => {
      await mount();
      await hover("capstan");
      expect(verbs()).toEqual(["holdEWind the capstan"]);
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

    it("cancels when the part stops (back to editing)", async () => {
      await mount();
      await hover("capstan");
      down("e");
      await s.activity("edit");
      expect(sessions[0].cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("nothing shows or runs while editing", async () => {
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
