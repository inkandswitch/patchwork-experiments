import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import menu, { menuEntries } from "./menu.js";

function commandsExt(log) {
  return {
    create(api) {
      return {
        commands: [
          {
            id: "poke",
            name: "Poke",
            key: "k",
            state: (t) => (t != null ? {} : null),
            run: (t, v) => log.push(["poke", t, v]),
          },
          {
            id: "lock",
            name: "Locked",
            state: (t, { scene }) => (t != null ? { checked: !!scene.objects[t]?.locked } : null),
            run: (t, v) => log.push(["lock", t, v]),
          },
          {
            id: "inspect-only",
            name: "Inspect",
            show: ["inspector"],
            state: (t) => (t != null ? {} : null),
            run: () => log.push(["inspect-only"]),
          },
          {
            id: "frame",
            name: "Frame all",
            key: "f",
            run: () => log.push(["frame"]),
          }, // toolbar (no show): not in the menu
          {
            id: "paste",
            name: "Paste",
            show: ["menu"],
            run: () => log.push(["paste"]),
          },
          {
            id: "color",
            name: "Colour",
            show: ["menu"],
            state: (t) =>
              t == null
                ? {
                    value: "red",
                    choices: [
                      { value: "red", label: "Red" },
                      { value: "blue", label: "Blue" },
                    ],
                  }
                : null,
            run: (t, v) => log.push(["color", v]),
          },
        ],
      };
    },
  };
}

describe("menuEntries (pure)", () => {
  it("lists the object's commands, then the scene's that ask for a menu", () => {
    const log = [];
    const collected = [{ id: "t", value: commandsExt(log).create().commands }];
    const ctx = { scene: { objects: { a: {} } }, local: {} };
    const { forObject, forScene } = menuEntries(collected, "a", ctx);
    expect(forObject.map((e) => e.command.id)).toEqual(["poke", "lock"]);
    expect(forScene.map((e) => e.command.id)).toEqual(["paste", "color"]);
    expect(menuEntries(collected, null, ctx).forObject).toEqual([]);
  });

  it("Select (scene.select's) comes first for an object, wherever its extension runs", () => {
    const sel = { id: "select", name: "Select", show: ["menu"], state: (t) => (t ? {} : null), run() {} };
    const other = { id: "select", name: "Not the selection's", show: ["menu"], state: (t) => (t ? {} : null), run() {} };
    const collected = [{ id: "t", value: commandsExt([]).create().commands }, { id: "t.other", value: [other] }, { id: "scene.select", value: [sel] }];
    const ctx = { scene: { objects: { a: {} } }, local: {} };
    const { forObject } = menuEntries(collected, "a", ctx);
    expect(forObject.map((e) => `${e.ext}/${e.command.id}`)).toEqual(["scene.select/select", "t/poke", "t/lock", "t.other/select"]);
  });
});

describe("scene.menu", () => {
  let s, log;
  const mountWith = async (exts) => {
    log = [];
    s = await mountStage({
      extensions: [{ meta: { id: "scene.menu" }, module: menu }, ...exts],
      doc: { objects: { a: object({ name: "Hull" }) }, order: ["a"] },
    });
  };
  afterEach(() => s?.unmount());

  describe("with commands", () => {
    beforeEach(() => mountWith([{ meta: { id: "t.cmds" }, module: commandsExt([]) }]), 30_000);
    // (the pointer is on what it opens on: that's the look, attention's, whose keys the menu shows)
    const open = (hit = { id: "a" }) => (s.local.swap((m) => ({ ...m, hovered: hit?.id ?? null })), s.instance("scene.menu").input.menu({ type: "menu", x: 40, y: 30, hit }));
    const el = () => s.root.querySelector(".context-menu");
    const labels = () => [...el().querySelectorAll(".menu-item .menu-label")].map((x) => x.textContent);

    it("opens at the pointer with the object's commands, a separator, then the scene's", () => {
      expect(open()).toBe(true);
      expect(el().querySelector(".menu-title").textContent).toBe("Hull");
      expect(labels()).toEqual(["Poke", "Locked", "Paste", "Red", "Blue"]);
      expect(el().querySelectorAll(".menu-separator").length).toBe(1);
      expect(el().style.left).toBe("40px");
      expect(el().querySelector('[data-command="lock"]').getAttribute("aria-checked")).toBe("false");
      expect(el().querySelectorAll('[data-command="color"]')[0].getAttribute("aria-checked")).toBe("true");
      expect(el().querySelector('[data-command="poke"] .menu-key').textContent).toBe("K");
      expect(document.activeElement).toBe(el().querySelector(".menu-item"));
    });

    it("on empty space shows only the scene's menu commands", () => {
      expect(open(null)).toBe(true);
      expect(labels()).toEqual(["Paste", "Red", "Blue"]);
      expect(el().querySelector(".menu-separator")).toBeNull();
    });

    it("runs what's picked, with the target and value, and closes", () => {
      const ran = vi.spyOn(s.api("scene.menu"), "run");
      open();
      el().querySelector('[data-command="lock"]').click();
      expect(ran).toHaveBeenLastCalledWith({
        ext: "t.cmds",
        command: "lock",
        target: "a",
        value: true,
        hit: { id: "a", point: null, distance: null },
      });
      expect(el()).toBeNull();
      open();
      el().querySelectorAll('[data-command="color"]')[1].click();
      expect(ran).toHaveBeenLastCalledWith({
        ext: "t.cmds",
        command: "color",
        target: null,
        value: "blue",
        hit: { id: "a", point: null, distance: null },
      });
    });

    it("moves with the arrows, picks with Enter's click, closes on Escape or a click outside", () => {
      open();
      const items = [...el().querySelectorAll(".menu-item")];
      const key = (k) =>
        document.activeElement.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: k,
            bubbles: true,
            cancelable: true,
          }),
        );
      key("ArrowDown");
      expect(document.activeElement).toBe(items[1]);
      key("ArrowUp");
      key("ArrowUp");
      expect(document.activeElement).toBe(items.at(-1));
      key("Escape");
      expect(el()).toBeNull();
      open();
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(el()).toBeNull();
    });

    it("opens from a right-click on the canvas (no WebGL: nothing is hit)", async () => {
      s.pointer("pointerdown", 20, 20, { button: 2, buttons: 2 });
      s.pointer("pointerup", 20, 20, { button: 2 });
      expect(el()).toBeTruthy();
      expect(labels()).toEqual(["Paste", "Red", "Blue"]);
    });

    // A right-click with no hover before it (a probe's, a touch's long press,
    // or within one frame of moving there): the press is where the look is,
    // so the menu is the object's under it, not the scene's.
    it("a right-click on an object with no hover before it opens that object's menu", async () => {
      s.debug.viewport.pick = () => ({ id: "a", point: [0, 1, 0], normal: [0, 1, 0], distance: 3 });
      expect(s.local.get().hovered ?? null).toBe(null);
      s.pointer("pointerdown", 20, 20, { button: 2, buttons: 2 });
      s.pointer("pointerup", 20, 20, { button: 2 });
      expect(el()?.querySelector(".menu-title")?.textContent).toBe("Hull");
      expect(labels()).toEqual(["Poke", "Locked", "Paste", "Red", "Blue"]);
    });

    it("closes when what it was opened on is removed", async () => {
      open();
      s.change((d) => {
        delete d.objects.a;
        d.order = [];
      });
      await s.settle();
      expect(el()).toBeNull();
    });
  });

  it("opens nothing (and doesn't claim the event) when nothing applies", async () => {
    await mountWith([]);
    expect(s.instance("scene.menu").input.menu({ type: "menu", x: 1, y: 1, hit: { id: "a" } })).toBe(false);
    expect(s.root.querySelector(".context-menu")).toBeNull();
  }, 30_000);

  // A menu is of what was pressed (the pointer's hit, which the press sets), not the look: they differ for a
  // lock body under touch, whose look is the eye's (HISTORY.md, TOOLS Decisions 14) while a finger presses where it
  // lands. Every pointer state a menu can open in: the finger at (20, 20) is over the Hull; the middle of the
  // view (the eye ray, and a locked press) is on the Mast.
  describe("a menu is of what was pressed, in every pointer state", () => {
    const walker = {
      create: () => ({
        bodies: [{ id: "walk", label: "Walk", lock: true, keys: [{ code: "KeyW", label: "Forward" }], enter: () => ({ input: { press: (ev) => (ev.button === 0 ? {} : null) }, leave() {} }) }],
        commands: [{ id: "poke", name: "Poke", state: (t) => (t != null ? {} : null), run() {} }],
      }),
    };
    afterEach(() => {
      delete document.pointerLockElement;
    });
    // [case, body, how the menu opens, the look's title, the menu's title]
    const CASES = [
      ["Look, a mouse's right-click", "look", "mouse", "Hull", "Hull"],
      ["a lock body, a finger's long press", "walk", "touch", "Mast", "Hull"],
      ["a lock body, a refused mouse's right-click", "walk", "refused", "Hull", "Hull"],
      ["a lock body, a locked mouse's right-click", "walk", "locked", "Mast", "Mast"],
    ];
    for (const [name, body, how, lookAt, menuOf] of CASES)
      it(name, async () => {
        log = [];
        s = await mountStage({
          extensions: [{ meta: { id: "scene.menu" }, module: menu }, { meta: { id: "t.walk" }, module: walker }],
          // (not holding the editor, which wants the pointer free)
          doc: { objects: { a: object({ name: "Hull" }), b: object({ name: "Mast" }) }, order: ["a", "b"], view: { start: {} } },
        });
        // (a primary press is the body's, as walk's drag to look is)
        const vp = s.debug.viewport;
        vp.pick = (x) => (x === 20 ? { id: "a", point: [0, 1, 0], normal: [0, 1, 0], distance: 1 } : { id: "b", point: [0, 2, 0], normal: [0, 1, 0], distance: 2 });
        vp.centerRay = () => ({ origin: [0, 1.6, 4], dir: [0, 0, -1] });
        vp.raycast = () => ({ id: "b", point: [0, 2, 0], normal: null, distance: 2 });
        const type = how === "touch" ? "touch" : "mouse";
        // the input is said by a press first (a finger never locks)
        s.pointer("pointerdown", 300, 300, { pointerType: type, pointerId: 9 });
        s.pointer("pointerup", 300, 300, { pointerType: type, pointerId: 9 });
        if (body !== "look") expect(s.api("t.walk").body.enter("walk")).toBe(true);
        if (how === "refused") document.dispatchEvent(new Event("pointerlockerror"));
        if (how === "locked") {
          Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => s.canvas });
          document.dispatchEvent(new Event("pointerlockchange"));
        }
        await s.settle();
        expect(s.local.get().pointer).toMatchObject({ touch: how === "touch", locked: how === "locked" });
        if (how === "touch") {
          s.pointer("pointerdown", 20, 20, { pointerType: "touch" });
          await new Promise((done) => setTimeout(done, 650));
        } else {
          s.pointer("pointerdown", 20, 20, { button: 2, buttons: 2 });
          s.pointer("pointerup", 20, 20, { button: 2 });
        }
        const menuTitle = s.root.querySelector(".context-menu .menu-title")?.textContent ?? null;
        if (how === "touch") s.pointer("pointerup", 20, 20, { pointerType: "touch" });
        // the menu closed by a press outside the view (while open it wants the pointer), the look is where it was: the eye's only
        // for the finger and the lock, so the finger's menu is the one that isn't the look's
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await s.settle();
        expect(s.root.querySelector(".context-menu")).toBeNull();
        const look = s.facet("scene.menu").look();
        expect([s.facet("scene.menu").nameOf(look?.id), menuTitle]).toEqual([lookAt, menuOf]);
      }, 30_000);
  });
});
