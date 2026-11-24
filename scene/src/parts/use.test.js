// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { NATIVES, mountStage, object, settle, until } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { emptyScene } from "../test/empty-scene.js";
import { LINK } from "../native/link-graph.js";
import { plugins } from "../index.js";
import keys, { heldSessions } from "./keys.js";
import use, { heldEntries, promptEntries } from "./use.js";
import { lookChain } from "../key-order.js";

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
  // (a game, played: nobody arrives holding the editor)
  view: { start: {} },
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

  // The cap: n verbs apply to the target (0..5) × which are held (none; the first, the last of them, or one that no
  // longer applies; the first and the last) × the prompt as it is, or opened → what shows ("*" held) and how many
  // more. Every verb that applies is shown or counted in more, in running order, and a held one always shows: in its
  // place, or after the rest when it no longer applies. ("first", "last" need one verb, "both" two.)
  it("shows the first three and counts the rest; opened, every one; a held one in its place among them", () => {
    const verbs = Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, key: `${i}`, state: () => ({}), run() {} }));
    const gone = { id: "vX", key: "x", state: () => ({}), run() {} };
    const ctx = { scene, local: {} };
    const show = (out) => (out ? [out.entries.map((e) => `${e.command.id}${e.state.held ? "*" : ""}`).join(" "), out.more] : null);
    const heldOf = { none: () => [], first: (n) => [verbs[0]], last: (n) => [verbs[n - 1]], gone: () => [gone], both: (n) => [verbs[0], verbs[n - 1]] };
    const need = { none: 0, first: 1, last: 1, gone: 0, both: 2 };
    const want = {
      "0 none 3": null,
      "0 none ∞": null,
      "0 gone 3": ["vX*", 0],
      "0 gone ∞": ["vX*", 0],
      "1 none 3": ["v0", 0],
      "1 none ∞": ["v0", 0],
      "1 first 3": ["v0*", 0],
      "1 first ∞": ["v0*", 0],
      "1 last 3": ["v0*", 0],
      "1 last ∞": ["v0*", 0],
      "1 gone 3": ["v0 vX*", 0],
      "1 gone ∞": ["v0 vX*", 0],
      "2 none 3": ["v0 v1", 0],
      "2 none ∞": ["v0 v1", 0],
      "2 first 3": ["v0* v1", 0],
      "2 first ∞": ["v0* v1", 0],
      "2 last 3": ["v0 v1*", 0],
      "2 last ∞": ["v0 v1*", 0],
      "2 gone 3": ["v0 v1 vX*", 0],
      "2 gone ∞": ["v0 v1 vX*", 0],
      "2 both 3": ["v0* v1*", 0],
      "2 both ∞": ["v0* v1*", 0],
      "3 none 3": ["v0 v1 v2", 0],
      "3 none ∞": ["v0 v1 v2", 0],
      "3 first 3": ["v0* v1 v2", 0],
      "3 first ∞": ["v0* v1 v2", 0],
      "3 last 3": ["v0 v1 v2*", 0],
      "3 last ∞": ["v0 v1 v2*", 0],
      "3 gone 3": ["v0 v1 vX*", 1],
      "3 gone ∞": ["v0 v1 v2 vX*", 0],
      "3 both 3": ["v0* v1 v2*", 0],
      "3 both ∞": ["v0* v1 v2*", 0],
      "4 none 3": ["v0 v1 v2", 1],
      "4 none ∞": ["v0 v1 v2 v3", 0],
      "4 first 3": ["v0* v1 v2", 1],
      "4 first ∞": ["v0* v1 v2 v3", 0],
      "4 last 3": ["v0 v1 v3*", 1],
      "4 last ∞": ["v0 v1 v2 v3*", 0],
      "4 gone 3": ["v0 v1 vX*", 2],
      "4 gone ∞": ["v0 v1 v2 v3 vX*", 0],
      "4 both 3": ["v0* v1 v3*", 1],
      "4 both ∞": ["v0* v1 v2 v3*", 0],
      "5 none 3": ["v0 v1 v2", 2],
      "5 none ∞": ["v0 v1 v2 v3 v4", 0],
      "5 first 3": ["v0* v1 v2", 2],
      "5 first ∞": ["v0* v1 v2 v3 v4", 0],
      "5 last 3": ["v0 v1 v4*", 2],
      "5 last ∞": ["v0 v1 v2 v3 v4*", 0],
      "5 gone 3": ["v0 v1 vX*", 3],
      "5 gone ∞": ["v0 v1 v2 v3 v4 vX*", 0],
      "5 both 3": ["v0* v1 v4*", 2],
      "5 both ∞": ["v0* v1 v2 v3 v4*", 0],
    };
    const got = {};
    const counted = [];
    for (const n of [0, 1, 2, 3, 4, 5])
      for (const which of Object.keys(heldOf))
        for (const max of [3, Infinity]) {
          if (n < need[which]) continue;
          const collected = [{ id: "x", value: verbs.slice(0, n) }];
          const held = heldOf[which](n).map((command) => ({ ext: "x", command, state: { held: true } }));
          const out = which === "none" ? promptEntries(collected, { selected: "barrel" }, ctx, max) : heldEntries(collected, "barrel", held, ctx, max);
          got[`${n} ${which} ${max === 3 ? 3 : "∞"}`] = show(out);
          // the invariant, row by row: each that applies once, shown or in more; each held shown
          const ids = (out?.entries ?? []).map((e) => e.command.id);
          const live = verbs.slice(0, n).map((v) => v.id);
          counted.push(ids.filter((id) => live.includes(id)).length + (out?.more ?? 0) === n && new Set(ids).size === ids.length && held.every((h) => ids.includes(h.command.id)));
        }
    expect(got).toEqual(want);
    expect(counted.every(Boolean)).toBe(true);
  });

  it("while something's held: the target's verbs in their places, each held one as pressed (after the rest where it no longer applies), and as many others as fit", () => {
    const ctx = { scene, local: {}, from: [0, 0, 5], hit: { id: "barrel" } };
    const flat = collected[0].value;
    const wind = { ext: "t.game", command: flat.find((c) => c.id === "wind"), state: { label: "Winding" } };
    const pawl = { ext: "t.game", command: flat.find((c) => c.id === "pawl"), state: { label: "Pawl down" } };
    const show = (out) => out.entries.map((e) => `${e.command.id}${e.state.label ? `=${e.state.label}` : ""}`).join(" ");
    expect(heldEntries(collected, "capstan", [wind], ctx).target).toBe("capstan");
    // what's held → what shows (the capstan's verbs are wind, pawl, in that order)
    for (const [held, max, objects, want] of [
      [[wind], 3, scene.objects, "wind=Winding pawl"],
      // the second held: still second (not moved first, from under its finger)
      [[pawl], 3, scene.objects, "wind pawl=Pawl down"],
      [[pawl, wind], 3, scene.objects, "wind=Winding pawl=Pawl down"],
      // room for one: the held one, wherever it is
      [[pawl], 1, scene.objects, "pawl=Pawl down"],
      [[wind], 1, scene.objects, "wind=Winding"],
      // more held than room: every held one
      [[wind, pawl], 1, scene.objects, "wind=Winding pawl=Pawl down"],
      // its target gone: only what was held, in the order pressed
      [[wind], 3, {}, "wind=Winding"],
      [[pawl, wind], 3, {}, "pawl=Pawl down wind=Winding"],
    ])
      expect([held.map((h) => h.command.id), max, show(heldEntries(collected, "capstan", held, { ...ctx, scene: { ...scene, objects } }, max))]).toEqual([held.map((h) => h.command.id), max, want]);
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

  it("runs in every view: a view plugin, as the key map is", async () => {
    await mount();
    expect(s.local.get().running.map((r) => r.id).filter((id) => !NATIVES.includes(id))).toEqual(["t.game"]);
    expect(s.debug.view.plugins.running().map((r) => r.id).filter((id) => !NATIVES.includes(id))).toEqual(["scene.use", "scene.keys", "scene.edit"]);
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

  // Held still where it is while the pointer is on it, until the viewer moves the eye (step 8 of lane/n11 and its
  // fixes; HISTORY.md, COMPOSITION Decisions, the use prompt and the eye): an orbit or a Frame ends, a body entered or
  // left, a pointer lock taken or lost put it back under the pointer, so a press there reaches what is under it (a
  // halo handle), never a button left there. An eye carried every frame (a ride) doesn't: it would never let the
  // pointer catch the prompt. However the pointer came onto it, it holds where it is.
  describe("the pointer on the prompt, and the eye", () => {
    const EDIT = (on) => s.edit(on);
    const origin = () => s.port.getBoundingClientRect();
    const px = (x, y) => [`${x - origin().left}px`, `${y - origin().top}px`];
    const at = () => [prompt().style.getPropertyValue("--use-x"), prompt().style.getPropertyValue("--use-y")];
    const verb = () => prompt().querySelector(".use-verb");
    const mouse = (target, x, y) => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y }));
    const tap = (target, x, y) => {
      for (const type of ["pointerdown", "pointerup"]) target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", button: 0, buttons: type === "pointerdown" ? 1 : 0, clientX: x, clientY: y }));
      s.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    };
    // How the pointer comes onto the prompt (shown at 120, 90; its button at 125, 132)
    const ARRIVALS = [
      ["moved onto it from the world", async () => {
        mouse(s.canvas, 120, 90);
        await settle();
        mouse(verb(), 125, 132);
      }],
      ["back into the view straight onto it", async () => {
        mouse(s.canvas, 120, 90);
        await settle();
        s.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
        mouse(verb(), 125, 132);
      }],
      ["a finger's tap on it", async () => {
        tap(s.canvas, 120, 90);
        await settle();
        tap(verb(), 125, 132);
      }],
    ];
    // What happens then, and whether it is the viewer moving the eye (true: back under the pointer)
    const EVENTS = [
      ["nothing", false, async () => {}],
      ["an orbit or zoom ends", true, async () => s.debug.viewport.endCamera("orbit")],
      ["a Frame (.)", true, async () => s.debug.viewport.endCamera("frame")],
      ["a ride carries the eye, frame after frame", false, async () => {
        for (let i = 1; i <= 5; i++) {
          const cam = { position: [i * 0.01, 2, 5], target: [i * 0.01, 1, 0], fov: 50, up: [0, 1, 0] };
          s.debug.viewport.getCamera = () => cam;
          for (const fn of [...s.debug.viewport.afterHooks]) fn(null, { w: 200, h: 200 });
          await settle(1);
        }
      }],
      // (the editor is a hand, not a body: picking it up or putting it down moves no eye)
      ["the editor picked up", false, async () => expect(EDIT(true)).toBe(true)],
      ["the editor put down", false, async () => expect(EDIT(false)).toBe(false), () => EDIT(true)],
      ["the selection changes", false, async () => s.api("t.game").view.select("capstan")],
      ["a pointer lock taken and lost", true, async () => {
        document.pointerLockElement = s.canvas;
        document.dispatchEvent(new Event("pointerlockchange"));
        await settle();
        delete document.pointerLockElement;
        document.dispatchEvent(new Event("pointerlockchange"));
      }],
    ];
    for (const [arrival, arrive] of ARRIVALS)
      for (const [event, moves, run, before] of EVENTS)
        it(`${arrival}, then ${event}: ${moves ? "under the pointer" : "held where it was"}`, async () => {
          await mount();
          if (before) expect(before()).toBe(true);
          await settle();
          // the pointer is over the helm wherever it goes on the world (the view's pick)
          s.debug.viewport.pick = () => ({ id: "helm", point: [0, 1, 0], normal: [0, 1, 0], distance: 1 });
          await arrive();
          await settle();
          expect(prompt().hidden).toBe(false);
          expect(at()).toEqual(px(120, 90));
          await run();
          await settle();
          expect(prompt().hidden).toBe(false);
          expect(at()).toEqual(moves ? px(125, 132) : px(120, 90));
        });

    it("off the prompt onto the world, it follows the pointer again; onto it again, it holds where it is then", async () => {
      await mount();
      s.debug.viewport.pick = () => ({ id: "helm", point: [0, 1, 0], normal: [0, 1, 0], distance: 1 });
      mouse(s.canvas, 120, 90);
      await settle();
      mouse(verb(), 125, 132);
      mouse(s.canvas, 60, 70);
      expect(at()).toEqual(px(60, 70));
      mouse(verb(), 65, 112);
      expect(at()).toEqual(px(60, 70));
      // let go by a Frame, then caught again: held at its new place through a carried eye
      s.debug.viewport.endCamera("frame");
      await settle();
      expect(at()).toEqual(px(65, 112));
      mouse(verb(), 70, 150);
      expect(at()).toEqual(px(65, 112));
      s.debug.viewport.getCamera = () => ({ position: [1, 2, 5], target: [1, 1, 0], fov: 50, up: [0, 1, 0] });
      for (const fn of [...s.debug.viewport.afterHooks]) fn(null, { w: 200, h: 200 });
      await settle();
      expect(at()).toEqual(px(65, 112));
    });

    it("the pointer leaving while it's held lets go: back on the world, it follows", async () => {
      await mount();
      s.debug.viewport.pick = () => ({ id: "helm", point: [0, 1, 0], normal: [0, 1, 0], distance: 1 });
      mouse(s.canvas, 120, 90);
      await settle();
      mouse(verb(), 125, 132);
      s.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
      expect(at()).toEqual(px(120, 90));
      mouse(s.canvas, 40, 30);
      expect(at()).toEqual(px(40, 30));
    });
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

    it("by touch (a finger never locks, and hovers nowhere): it looks along the middle of the view all the same, the prompt in the middle", async () => {
      await mount();
      const vp = s.debug.viewport;
      vp.centerRay = () => ({ origin: eye, dir: [0, 0, -1] });
      vp.raycast = () => ({ id: "spoke", point: [0, 1, 0], normal: null, distance: 1.5 });
      const tap = (type) => s.canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 4, pointerType: "touch", button: 0, buttons: type === "pointerdown" ? 1 : 0 }));
      tap("pointerdown");
      tap("pointerup");
      expect(s.api("t.game").body.enter("walk")).toBe(true);
      await settle();
      expect(s.local.get().pointer).toMatchObject({ lock: true, touch: true, locked: false });
      expect(verbs()).toEqual(["FTake the helm"]);
      expect([prompt().style.getPropertyValue("--use-x"), prompt().style.getPropertyValue("--use-y")]).toEqual(["50%", "50%"]);
      // a finger dragging on the world (looking) doesn't move it under the finger
      s.canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, pointerType: "touch", clientX: 30, clientY: 40, buttons: 1 }));
      expect(prompt().style.getPropertyValue("--use-x")).toBe("50%");
      prompt().querySelector(".use-verb").click();
      expect(log).toEqual([["helm", "helm", undefined]]);
    });

    // (too far, disabled, no key: keymap.test.js's reach run)
    it("looks again on a lock change: a reach verb beyond reach comes in when the body steps up to it", async () => {
      const vp = await walking({ hitId: "barrel", distance: 3 });
      expect(prompt().querySelector('[data-command="grab"]').hasAttribute("data-disabled")).toBe(true);
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

// A verb's button with a key is that key (STAGE.md, "Keys"): a press on it is
// the key's keydown, its lift the keyup, so a held verb lasts as long as the
// finger (or the mouse button); a verb with no key that does it is a click.
// One fixture, every kind of verb a prompt shows, each on its own target (a
// prompt shows three): a plain verb with a key, a held one with a key, a
// plain one whose key the walking body reserves, a held one whose key the
// body reserves, a disabled one. Each row is pressed by a finger walking (the
// look the eye's: the prompt in the middle) and by a mouse in Look (the look
// where it hovers), where the row applies.
describe("scene.use: a button with a key is that key", () => {
  let s, log, sessions, walker;
  afterEach(() => {
    s?.unmount();
    s = null;
    vi.restoreAllMocks();
  });
  const session = (name) => () => {
    const it = { name, end: vi.fn(), cancel: vi.fn(), update: vi.fn() };
    sessions.push(it);
    log.push(name);
    return it;
  };
  const on = (id) => (t) => (t === id ? {} : null);
  const VERBS = {
    meta: { id: "t.verbs", traits: ["t.level"] },
    module: {
      create: () => ({
        bodies: [{ id: "walk", label: "Walk", lock: true, keys: [{ code: "KeyW", label: "Forward" }, { code: "KeyQ", label: "Duck" }], enter: () => ({ input: walker, eye: () => ({ position: [0, 1.6, 4], direction: [0, 0, -1] }), leave() {} }) }],
        commands: [
          { id: "ring", name: "Ring", key: "r", state: on("bell"), run: () => log.push("ring") },
          // the winch's first verb: Wind is second, and stays there while held
          { id: "pawl", name: "Pawl", key: "p", state: on("winch"), run: () => log.push("pawl") },
          { id: "wind", name: "Wind", key: "e", hold: true, state: on("winch"), run: session("wind") },
          { id: "wave", name: "Wave", key: "w", state: on("flag"), run: () => log.push("wave") },
          { id: "heave", name: "Heave", key: "q", hold: true, state: on("anchor"), run: session("heave") },
          { id: "grab", name: "Grab", key: "g", state: (t) => (t === "chest" ? { disabled: true, title: "locked" } : null), run: () => log.push("grab") },
          // five on the crate: three show, and the last, held, is past them
          { id: "lid", name: "Lid", key: "h", state: on("crate"), run: () => log.push("lid") },
          { id: "tip", name: "Tip", key: "j", state: on("crate"), run: () => log.push("tip") },
          { id: "kick", name: "Kick", key: "k", state: on("crate"), run: () => log.push("kick") },
          { id: "lash", name: "Lash", key: "l", state: on("crate"), run: () => log.push("lash") },
          { id: "haul", name: "Haul", key: "n", hold: true, state: on("crate"), run: session("haul") },
        ],
      }),
    },
  };
  const TARGETS = ["bell", "winch", "flag", "anchor", "chest", "crate"];
  const DOC5 = { traits: { "t.level": {} }, objects: Object.fromEntries(TARGETS.map((id) => [id, object({ name: id })])), order: TARGETS, view: { start: {} } };

  /** Mount, and attend `target`: a mouse hovering it in Look, or a finger walking with the eye on it. */
  async function at(target, input, command = null) {
    log = [];
    sessions = [];
    walker = { key: vi.fn(() => true), keyup: vi.fn(() => true) };
    s = await mountStage({ extensions: [VERBS, USE, KEYS], doc: DOC5 });
    await settle();
    if (input === "mouse") s.local.swap((m) => ({ ...m, hovered: target }));
    else {
      const vp = s.debug.viewport;
      vp.centerRay = () => ({ origin: [0, 1.6, 4], dir: [0, 0, -1] });
      vp.raycast = () => ({ id: target, point: [0, 1, 0], normal: null, distance: 1 });
      s.canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", button: 0, buttons: 1 }));
      s.canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", button: 0 }));
      expect(s.api("t.verbs").body.enter("walk")).toBe(true);
    }
    await settle();
    const button = s.root.querySelector(command ? `.use-verb[data-command="${command}"]` : ".use-verb");
    expect(button?.dataset.command).toBeTruthy();
    const ev = (type, init = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: input, button: 0, buttons: type === "pointerdown" ? 1 : 0, ...init });
    return {
      button,
      kbd: () => button.querySelector("kbd")?.textContent ?? null,
      down(init) {
        const e = ev("pointerdown", init);
        button.dispatchEvent(e);
        return e.defaultPrevented;
      },
      // a lift: its pointerup, then the click the browser makes of a press and release on the button (`on`: the
      // element under the lift, when the one pressed has gone)
      up(init, on = button) {
        button.dispatchEvent(ev("pointerup", init));
        on.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      },
      cancel: () => button.dispatchEvent(ev("pointercancel")),
    };
  }

  const prompt = () => s.root.querySelector(".use-prompt");
  const verbs = () => (prompt().hidden ? [] : [...prompt().querySelectorAll(".use-verb")].map((v) => v.textContent));
  const BOTH = ["touch", "mouse"];
  it.each(BOTH)("a plain verb with a key (%s): the press is its key, and runs it once; the lift and its click run nothing more", async (input) => {
    const b = await at("bell", input);
    expect(b.kbd()).toBe("R");
    expect(b.down()).toBe(true);
    expect(log).toEqual(["ring"]);
    b.up();
    expect(log).toEqual(["ring"]);
    // (a click with no press before it, a keyboard's on the button, still runs it)
    b.button.click();
    expect(log).toEqual(["ring", "ring"]);
  });

  for (const input of BOTH)
    for (const [how, lift, want] of [
      ["lifted", (b) => b.up(), { end: 1, cancel: 0 }],
      // the browser takes the finger: its key comes up, as a keyboard's has no cancel
      ["cancelled by the browser", (b) => b.cancel(), { end: 1, cancel: 0 }],
      // the window went first (the key map cancels a held verb whose key comes up then)
      ["lifted with the window gone", (b) => (vi.spyOn(document, "hasFocus").mockReturnValue(false), b.cancel()), { end: 0, cancel: 1 }],
    ])
      it(`a held verb with a key (${input}): held from the press until ${how}, on the one button`, async () => {
        const b = await at("winch", input, "wind");
        expect([b.kbd(), b.button.disabled]).toEqual(["E", false]);
        expect(verbs()).toEqual(["PPawl", "holdEWind"]);
        // (what the prompt takes out of the document while it's held: nothing it keeps)
        const watch = new MutationObserver(() => {});
        watch.observe(prompt(), { childList: true });
        expect(b.down()).toBe(true);
        await settle();
        expect(sessions.map((x) => x.name)).toEqual(["wind"]);
        // the same element in the same place, lit, never taken out (its capture kept), not disabled
        const now = s.root.querySelector('.use-verb[data-command="wind"]');
        expect([now === b.button, now.hasAttribute("data-held"), now.disabled, verbs()]).toEqual([true, true, false, ["PPawl", "holdEWind"]]);
        expect(watch.takeRecords().flatMap((m) => [...m.removedNodes])).toEqual([]);
        watch.disconnect();
        expect(sessions[0].end).not.toHaveBeenCalled();
        lift(b);
        await settle();
        expect({ end: sessions[0].end.mock.calls.length, cancel: sessions[0].cancel.mock.calls.length }).toEqual(want);
        expect(b.button.hasAttribute("data-held")).toBe(false);
      });

  it.each(BOTH)("a held verb's target goes while its button is held (%s): the key map cancels it; the lift ends nothing", async (input) => {
    const b = await at("winch", input, "wind");
    b.down();
    s.change((d) => {
      delete d.objects.winch;
      d.order = d.order.filter((id) => id !== "winch");
    });
    await settle();
    expect(sessions[0].cancel).toHaveBeenCalledTimes(1);
    b.up();
    await settle();
    expect(sessions[0].end).not.toHaveBeenCalled();
  });

  it("a verb whose key the body reserves (walking, W): shown with no key; the press isn't a key (the body hears nothing), the click runs it", async () => {
    const b = await at("flag", "touch");
    expect([b.kbd(), b.button.disabled]).toEqual([null, false]);
    expect(b.down()).toBe(false);
    expect(walker.key).not.toHaveBeenCalled();
    expect(log).toEqual([]);
    b.up();
    expect(log).toEqual(["wave"]);
  });

  it("a held verb whose key the body reserves: disabled (there's no key to hold it by); nothing runs", async () => {
    const b = await at("anchor", "touch");
    expect([b.kbd(), b.button.disabled]).toEqual([null, true]);
    expect(b.down()).toBe(false);
    b.up();
    await settle();
    expect([log, walker.key.mock.calls.length]).toEqual([[], 0]);
  });

  it.each(BOTH)("a disabled verb (%s): no key shown, nothing pressed, nothing run", async (input) => {
    const b = await at("chest", input);
    expect([b.kbd(), b.button.disabled, b.button.title]).toEqual([null, true, "locked"]);
    expect(b.down()).toBe(false);
    b.up();
    await settle();
    expect(log).toEqual([]);
  });

  it("in Look, a finger's tap on a thing shows its verbs where it tapped; they stay when the finger lifts, and a tap on one is its key", async () => {
    log = [];
    sessions = [];
    s = await mountStage({ extensions: [VERBS, USE, KEYS], doc: DOC5 });
    await settle();
    s.api("t.verbs").body.enter("look");
    await settle();
    s.debug.viewport.pick = () => ({ id: "winch", point: [0, 1, 0], normal: null, distance: 3 });
    const origin = s.port.getBoundingClientRect();
    const finger = (type, target, id, x = 0, y = 0) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", button: 0, buttons: type === "pointerdown" ? 1 : 0, clientX: x, clientY: y }));
    finger("pointerdown", s.canvas, 1, 140, 90);
    finger("pointerup", s.canvas, 1, 140, 90);
    s.canvas.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    s.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    await settle();
    expect(s.local.get().body.id).toBe("look");
    expect(verbs()).toEqual(["PPawl", "holdEWind"]);
    expect([prompt().style.getPropertyValue("--use-x"), prompt().style.getPropertyValue("--use-y")]).toEqual([`${140 - origin.left}px`, `${90 - origin.top}px`]);
    const button = prompt().querySelector('.use-verb[data-command="wind"]');
    finger("pointerdown", button, 2);
    await settle();
    expect(sessions.map((x) => x.name)).toEqual(["wind"]);
    finger("pointerup", button, 2);
    s.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    await settle();
    expect(sessions[0].end).toHaveBeenCalledTimes(1);
    expect(verbs()).toEqual(["PPawl", "holdEWind"]);
  });

  // A browser clicks what is under the lift once the button pressed has gone (Chrome: a finger's tap on a button
  // replaced in place on its pointerdown clicks the replacement). A verb that runs on the press and so puts another
  // target's verb in its slot: the lift's click on that one runs nothing.
  it.each(BOTH)("a press's run puts another button under it (%s): the lift's click there runs nothing", async (input) => {
    const b = await at("bell", input);
    b.down();
    expect(log).toEqual(["ring"]);
    // the look moves on to the flag as the press runs: Wave (W, the body's while walking: a click) takes the slot
    if (input === "mouse") s.local.swap((m) => ({ ...m, hovered: "flag" }));
    else {
      s.debug.viewport.raycast = () => ({ id: "flag", point: [0, 1, 0], normal: null, distance: 1 });
      // (the prompt looks again every frame while walking; the harness has no frames, a lock change does at once)
      document.dispatchEvent(new Event("pointerlockchange"));
    }
    await settle();
    const wave = s.root.querySelector('.use-verb[data-command="wave"]');
    expect([wave !== null, b.button.isConnected]).toEqual([true, false]);
    b.up(undefined, wave);
    expect(log).toEqual(["ring"]);
    // a press of its own, then, is Wave's
    wave.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 2, pointerType: input, button: 0, buttons: 1 }));
    wave.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 2, pointerType: input, button: 0 }));
    wave.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(log).toEqual(["ring", "wave"]);
  });

  it("a click whose press was elsewhere on the view runs nothing, though the button had a press before it", async () => {
    const b = await at("flag", "touch");
    // a press on Wave that slid off it (no click), then a press on the world whose click lands on Wave
    b.down();
    b.button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", button: 0 }));
    s.canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3, pointerType: "touch", button: 0, buttons: 1 }));
    b.button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(log).toEqual([]);
  });

  // Only a primary press is a key or a click: a mouse's middle (1) or right (2) button on a verb, keyed or a click,
  // plain or held, does nothing (as it clicks nothing on any button), even with a click after it.
  for (const button of [1, 2])
    for (const [target, command, input] of [
      ["bell", "ring", "mouse"],
      ["winch", "wind", "mouse"],
      ["flag", "wave", "touch"],
    ])
      it(`a press with button ${button} on ${command} (${input}): nothing pressed, nothing run`, async () => {
        const b = await at(target, input, command);
        expect(b.down({ button, buttons: 1 << (button === 1 ? 2 : 1) })).toBe(false);
        b.up({ button });
        await settle();
        expect([log, sessions.length, walker.key.mock.calls.length]).toEqual([[], 0, 0]);
      });

  // Past three verbs (the crate's five): the prompt's last button opens it to every one, so every verb on attention
  // is reachable from the prompt, a finger's too (no keys), each its own button.
  const more = () => prompt().querySelector(".use-more");
  const press = (el, input) => {
    const ev = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 2, pointerType: input, button: 0, buttons: type === "pointerdown" ? 1 : 0 });
    el.dispatchEvent(ev("pointerdown"));
    el.dispatchEvent(ev("pointerup"));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  };
  it.each(BOTH)("past three verbs (%s): the first three and a more; pressed, all five in running order, the fifth held by its button as long as the finger", async (input) => {
    const b = await at("crate", input);
    expect([verbs(), more()?.textContent]).toEqual([["HLid", "JTip", "KKick"], "⋯ 2 more"]);
    press(more(), input);
    await settle();
    expect([verbs(), more()]).toEqual([["HLid", "JTip", "KKick", "LLash", "holdNHaul"], null]);
    expect(log).toEqual([]);
    const haul = prompt().querySelector('[data-command="haul"]');
    haul.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3, pointerType: input, button: 0, buttons: 1 }));
    expect([log, sessions[0]?.end.mock.calls.length]).toEqual([["haul"], 0]);
    haul.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 3, pointerType: input, button: 0 }));
    await settle();
    expect(sessions.map((x) => x.end.mock.calls.length)).toEqual([1]);
    expect(b.button.isConnected).toBe(true);
  });

  // Opened on the crate, attention goes away (another target with verbs; one with none; nothing; a carry's gesture,
  // which takes the prompt down) and comes back: three and a more again.
  it.each([
    ["another target", () => s.local.swap((m) => ({ ...m, hovered: "bell" })), ["RRing"]],
    ["nothing", () => s.local.swap((m) => ({ ...m, hovered: null })), []],
    ["a carry", () => s.local.swap((m) => ({ ...m, gesture: { owner: "scene.carry", keys: [{ code: "KeyF", label: "Flip" }] } })), []],
  ])("attention on %s closes it: back on the crate, three and a more again", async (_, away, there) => {
    await at("crate", "mouse");
    press(more(), "mouse");
    await settle();
    expect(verbs()).toHaveLength(5);
    away();
    await settle();
    expect(verbs()).toEqual(there);
    s.local.swap((m) => ({ ...m, hovered: "crate", gesture: null }));
    await settle();
    expect([verbs(), more()?.textContent]).toEqual([["HLid", "JTip", "KKick"], "⋯ 2 more"]);
  });

  it("a click on more whose press was elsewhere on the view opens nothing", async () => {
    await at("crate", "touch");
    s.canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3, pointerType: "touch", button: 0, buttons: 1 }));
    more().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    await settle();
    expect([verbs(), more()?.textContent]).toEqual([["HLid", "JTip", "KKick"], "⋯ 2 more"]);
  });

  it("a verb past three held by its key: shown in the third's place, held, and the more counts the two left", async () => {
    await at("crate", "mouse");
    s.root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "n", code: "KeyN" }));
    await settle();
    expect([log, verbs(), more()?.textContent]).toEqual([["haul"], ["HLid", "JTip", "holdNHaul"], "⋯ 2 more"]);
    s.root.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "n", code: "KeyN" }));
    await settle();
    expect([sessions[0].end.mock.calls.length, verbs()]).toEqual([1, ["HLid", "JTip", "KKick"]]);
  });

  it("two fingers on a plain verb's button: one key, and neither lift's click runs it again", async () => {
    const b = await at("bell", "touch");
    b.down({ pointerId: 1 });
    b.down({ pointerId: 2 });
    b.up({ pointerId: 1 });
    b.up({ pointerId: 2 });
    expect(log).toEqual(["ring"]);
  });

  it("a press asks which key as it comes: one that no longer does the verb presses nothing", async () => {
    const b = await at("bell", "mouse");
    expect(b.kbd()).toBe("R");
    // the look moves on to the winch (no R there) and the press comes before the prompt hears of it
    s.local.swap((m) => ({ ...m, hovered: "winch" }));
    expect(b.button.isConnected && b.button.dataset.command).toBe("ring");
    expect(b.down()).toBe(false);
    expect(log).toEqual([]);
  });
});

// A held verb's target in a linked doc (STAGE.md, "The input chain"): the pin is the
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
