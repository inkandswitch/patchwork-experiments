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
});

describe("scene.menu", () => {
  let s, log;
  const mountWith = async (exts) => {
    log = [];
    s = await mountStage({
      extensions: [{ meta: { id: "scene.menu" }, module: menu }, ...exts],
      kits: [
        {
          id: "model",
          extensions: ["scene.menu", ...exts.map((e) => e.meta.id)],
        },
      ],
      doc: { objects: { a: object({ name: "Hull" }) }, order: ["a"] },
    });
  };
  afterEach(() => s?.unmount());

  describe("with commands", () => {
    beforeEach(() => mountWith([{ meta: { id: "t.cmds" }, module: commandsExt([]) }]), 30_000);
    const open = (hit = { id: "a" }) => s.instance("scene.menu").input.menu({ type: "menu", x: 40, y: 30, hit });
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
      });
      expect(el()).toBeNull();
      open();
      el().querySelectorAll('[data-command="color"]')[1].click();
      expect(ran).toHaveBeenLastCalledWith({
        ext: "t.cmds",
        command: "color",
        target: null,
        value: "blue",
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
});
