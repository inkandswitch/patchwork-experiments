// @vitest-environment happy-dom
// The drawer's grip in a mounted stage (native/drawer.js, EDITOR.md, "The interface"): its widths
// are this viewer's prefs, kept per scene, and its presses and keys are the
// drawer's own: in each base body, with something selected, a drag, a
// click, a double-click and the grip's keys reach no part of the scene, so
// nothing is selected, deselected, carried or locked.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { openTabs } from "../test/tabs.js";
import select from "../parts/select.js";
import inspector from "../parts/inspector.js";
import { MAX_PX, prefKey } from "./drawer.js";
import { editing } from "../parts/editing.js";

const SELECT = { meta: { id: "scene.select" }, module: select };
const INSPECTOR = { meta: { id: "scene.inspector" }, module: inspector };
const OPENED = openTabs(["scene.inspector:inspector"], { once: true });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Whatever reaches the scene's chain: every key and press a general part is offered. It docks a panel of its own (an editor) when asked. */
function recorder(seen) {
  const note = (type) => (ev) => (seen.push([type, ev.key ?? null]), false);
  return {
    meta: { id: "t.seen" },
    module: {
      create: (api) => ({
        input: {
          key: note("key"),
          keyup: note("keyup"),
          press: note("press"),
          click: note("click"),
          dblclick: note("dblclick"),
        },
        dockPanel: () => api.use("drawer").dock(document.createElement("div"), { title: "Panel" }),
      }),
    },
  };
}

async function mount(seen = []) {
  s = await mountStage({ editor: true, natives: true, 
    extensions: [SELECT, INSPECTOR, OPENED, recorder(seen)],
    doc: { objects: { a: object({ name: "A" }), b: object({ name: "B" }) }, order: ["a", "b"] },
  });
  await settle();
  return s;
}

const grip = () => s.root.querySelector(".stage-drawer-grip");
const drawerWidth = () => s.root.querySelector(".stage-drawer")?.style.getPropertyValue("--stage-drawer-width") ?? null;
const ptr = (type, x, extra = {}) => grip().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: 20, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 3, pointerType: "mouse", ...extra }));
const key = (k, extra = {}) => {
  for (const type of ["keydown", "keyup"]) grip().dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, key: k, code: k, ...extra }));
};

describe("the drawer's grip, mounted", () => {
  it("is on the inspector's drawer, and its width is this viewer's pref for the stage's chrome, kept per scene", async () => {
    await mount();
    expect(grip()).not.toBeNull();
    expect(s.root.querySelector(".stage-drawer").dataset.kind).toBe("chrome");
    expect(drawerWidth()).toBe("");
    // (nothing measures in this DOM: a drag starts from the least width, 220)
    ptr("pointerdown", 500);
    ptr("pointermove", 400);
    ptr("pointerup", 380);
    await settle();
    expect(s.local.get()["scene.prefs"]).toEqual({ [prefKey("chrome")]: 340 });
    expect(JSON.parse(localStorage.getItem(`scene-prefs:${s.handle.url}`))).toEqual({ [prefKey("chrome")]: 340 });
    expect(drawerWidth()).toBe("340px");
    // another tab of this scene sets it: this one follows
    localStorage.setItem(`scene-prefs:${s.handle.url}`, JSON.stringify({ [prefKey("chrome")]: 700 }));
    globalThis.dispatchEvent(new StorageEvent("storage", { key: `scene-prefs:${s.handle.url}` }));
    await settle();
    expect(drawerWidth()).toBe("700px");
    // a double-click: the default again, and the pref gone
    grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await settle();
    expect(drawerWidth()).toBe("");
    expect(s.local.get()["scene.prefs"]).toEqual({});
  });

  for (const body of ["look", "edit"]) {
    it(`the grip's own, in ${body}: with A selected, a drag, a click, a double-click and the grip's keys select nothing, deselect nothing, lock nothing, and reach no part`, async () => {
      const seen = [];
      await mount(seen);
      // ("edit": Look holding the editor)
      expect(s.edit(body === "edit")).toBe(body === "edit");
      s.local.swap((m) => ({ ...m, selected: "a" }));
      await settle();
      // a panel of its own, so there is a drawer in Look too (the inspector is Edit's)
      s.instance("t.seen").dockPanel();
      await settle();
      expect(s.root.querySelector(".stage-drawer").dataset.kind).toBe("editor");
      const before = { body: editing(s.local.get()) ? "edit" : s.local.get().body.id, selected: s.local.get().selected, pointer: s.local.get().pointer, doc: JSON.stringify(s.doc()) };
      expect(before).toMatchObject({ body, selected: "a" });
      seen.length = 0;
      // a drag, a click, a double-click
      ptr("pointerdown", 500);
      ptr("pointermove", 300);
      ptr("pointerup", 200);
      ptr("pointerdown", 200);
      ptr("pointerup", 200);
      grip().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      // the grip's keys
      for (const k of ["ArrowLeft", "ArrowRight", "Home", "End"]) key(k);
      key("ArrowLeft", { shiftKey: true });
      await settle();
      const after = { body: editing(s.local.get()) ? "edit" : s.local.get().body.id, selected: s.local.get().selected, pointer: s.local.get().pointer, doc: JSON.stringify(s.doc()) };
      expect(after).toEqual(before);
      expect(s.local.get().gesture).toBeNull();
      expect(s.local.get().pointer.locked).toBe(false);
      expect(seen).toEqual([]);
      // the keys did set the width: the last, Shift+ArrowLeft from End's MAX, stays at MAX
      expect(s.local.get()["scene.prefs"][prefKey("editor")]).toBe(MAX_PX);
    });
  }
});
