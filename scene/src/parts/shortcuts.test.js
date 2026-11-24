// @vitest-environment happy-dom
// Shortcuts (./shortcuts.js; PLANS.md §5): a command's ⌘ key, matched on a Mac
// and off one, labelled for each, and run by scene.keys on attention's target;
// one another part does (the clipboard's) is only shown.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { parseShortcut, shortcutInvocation, shortcutLabel, shortcutMatches, shortcutsOf } from "./shortcuts.js";
import keys from "./keys.js";
import inspector from "./inspector.js";
import transfer from "./transfer.js";
import { menuEntries } from "./menu.js";

const ev = (key, mods = {}) => ({ key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, meta: false, ctrl: false, shift: false, alt: false, ...mods });

describe("shortcuts: pure", () => {
  it("parse: Mod is required; Shift and Alt optional; anything else isn't one", () => {
    expect(parseShortcut("Mod+G")).toEqual({ mod: true, shift: false, alt: false, key: "g" });
    expect(parseShortcut("Shift+Mod+G")).toEqual({ mod: true, shift: true, alt: false, key: "g" });
    expect(parseShortcut("Alt+Shift+Mod+E")).toEqual({ mod: true, shift: true, alt: true, key: "e" });
    for (const bad of ["G", "Shift+G", "Ctrl+G", "Mod+", "", null, 3]) expect(parseShortcut(bad)).toBe(null);
    expect(shortcutsOf({ shortcut: "Mod+G" })).toEqual(["Mod+G"]);
    expect(shortcutsOf({ shortcut: ["Mod+G", 2] })).toEqual(["Mod+G"]);
    expect(shortcutsOf({})).toEqual([]);
  });

  // [the event's modifiers, on a Mac?, does Mod+G press it, does Shift+Mod+G]: every combination of meta, ctrl, shift
  const MODS = [];
  for (const meta of [false, true]) for (const ctrl of [false, true]) for (const shift of [false, true]) for (const mac of [false, true]) MODS.push([{ meta, ctrl, shift }, mac]);
  it.each(MODS)("match: %o on a Mac %s: ⌘ there, Ctrl elsewhere, never both; Shift exactly as declared", (mods, mac) => {
    const mod = mac ? mods.meta && !mods.ctrl : mods.ctrl && !mods.meta;
    expect(shortcutMatches("Mod+G", ev("g", mods), mac)).toBe(mod && !mods.shift);
    // (Shift makes the key "G"; the code says which key it is)
    expect(shortcutMatches("Shift+Mod+G", ev(mods.shift ? "G" : "g", mods), mac)).toBe(mod && mods.shift);
    expect(shortcutMatches("Mod+G", ev("h", mods), mac)).toBe(false);
  });

  it("label: ⇧⌘G on a Mac, Ctrl+Shift+G elsewhere", () => {
    expect([shortcutLabel("Mod+G", true), shortcutLabel("Shift+Mod+G", true), shortcutLabel("Alt+Mod+E", true)]).toEqual(["⌘G", "⇧⌘G", "⌥⌘E"]);
    expect([shortcutLabel("Mod+G", false), shortcutLabel("Shift+Mod+G", false)]).toEqual(["Ctrl+G", "Ctrl+Shift+G"]);
    expect(shortcutLabel("G", true)).toBe("");
  });

  it("invocation: the first that applies on attention's path, innermost first, then the scene; never one another part does", () => {
    const cmd = (id, shortcut, applies, extra = {}) => ({ ext: "t", command: { id, shortcut, state: (t) => (applies(t) ? {} : null), ...extra } });
    const flat = [cmd("scene-g", "Mod+G", (t) => t == null), cmd("obj-g", "Mod+G", (t) => t === "a"), cmd("copy", "Mod+C", () => true, { shortcutBy: "clipboard" }), cmd("off", "Mod+O", () => true)];
    const stateOf = (c, t) => c.state(t);
    const press = (k, targets) => shortcutInvocation(flat, ev(k, { meta: true }), true, stateOf, targets);
    expect(press("g", ["a", null])).toEqual({ ext: "t", command: "obj-g", target: "a" });
    expect(press("g", ["b", null])).toEqual({ ext: "t", command: "scene-g", target: null });
    expect(press("c", ["a", null])).toBe(null);
    flat[3].command.state = () => ({ disabled: true });
    expect(press("o", ["a", null])).toBe(null);
  });
});

describe("shortcuts on the stage", () => {
  let s = null;
  afterEach(() => {
    s?.unmount();
    s = null;
  });

  it("⌘G groups the selection and ⇧⌘G ungroups it; ⌘C is the browser's (the clipboard's), not run here; the menu shows each", async () => {
    // (the harness's navigator is no Mac: Ctrl is Mod)
    s = await mountStage({ editor: true,  extensions: [{ meta: { id: "scene.keys" }, module: keys }, { meta: { id: "scene.inspector" }, module: inspector }, { meta: { id: "scene.transfer" }, module: transfer }], doc: { objects: { a: object({ name: "A" }) }, order: ["a"] } });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    const press = (key, mods) => s.key(key, { code: `Key${key.toUpperCase()}`, ctrlKey: true, ...mods });
    const pressed = press("g");
    await settle();
    const gid = s.doc().objects.a.group;
    expect([gid != null, s.local.get().selected === gid, pressed.defaultPrevented]).toEqual([true, true, true]);
    press("G", { shiftKey: true });
    await settle();
    expect([s.doc().objects[gid], s.doc().objects.a.group ?? null]).toEqual([undefined, null]);
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    const copied = press("c");
    expect(copied.defaultPrevented).toBe(false);
    // the menu's rows say each one's shortcut
    const f = s.facet("scene.inspector");
    const { forObject } = menuEntries(s.api("scene.inspector").collect("commands"), "a", f.context(null));
    const shown = Object.fromEntries(forObject.filter((e) => e.command.shortcut).map((e) => [e.command.id, shortcutLabel(shortcutsOf(e.command)[0], false)]));
    expect(shown).toMatchObject({ group: "Ctrl+G", extract: "Ctrl+E", copy: "Ctrl+C" });
  });
});
