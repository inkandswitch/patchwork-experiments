// scene.xray (xray.js): the X-ray as a held tool on a stage. X picks it up
// (in any body, editing or not) and docks its panel; it is an ordinary tool
// on the hand stack that passes every event, so the chain and the hands
// under it (Measure, Edit) go on; it doesn't ask for the pointer, so a lock
// body keeps its lock, and its look is then the eye's; hover focuses an
// object, a click pins it; picking an extension shows its lens and outlines
// its objects; the layers are a pref; Escape puts it down while it's the top
// hand, and with it down it does nothing.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as A from "@automerge/automerge";
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import keys from "../parts/keys.js";
import measure from "../parts/measure.js";
import xray, { PREF } from "./xray.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

const XRAY = { meta: { id: "scene.xray", type: "scene:view" }, module: xray };
const KEYS = { meta: { id: "scene.keys", type: "scene:view" }, module: keys };
const MEASURE = { meta: { id: "scene.measure" }, module: measure };

/** t.game holds cards (its trait): a verb for each, and it takes a click on one. */
function game(log) {
  return {
    meta: { id: "t.game", name: "Game", traits: ["t.card"], describes: { "t.card": { name: "Card" } } },
    module: {
      create: (api) => {
        log.api = api;
        return {
          // a walk-like body: it asks for the pointer lock
          bodies: [{ id: "walkish", label: "Walkish", lock: true, keys: [{ code: "KeyW", label: "Forward" }], enter: () => ({ input: {}, eye: () => ({ position: [0, 1.6, 4], direction: [0, 0, -1] }), leave() {} }) }],
          input: { click: (ev) => (ev.holder ? (log.clicks.push(ev.holder), true) : false) },
          commands: [{ id: "flip", name: "Flip", key: "f", run() {}, state: (t, ctx) => (t != null && ctx.scene.objects[t]?.traits?.["t.card"] ? (t === "b" ? { disabled: true, title: "not yours" } : {}) : null) }],
        };
      },
    },
  };
}

async function mount() {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = { clicks: [] };
  const objects = { a: object({ name: "Ace", traits: { "t.card": { suit: "red", n: 1 } } }), b: object({ name: "Two", traits: { "t.card": { suit: "blue", n: 2 } } }), t: object({ name: "Table" }) };
  s = await mountStage({ extensions: [KEYS, XRAY, MEASURE, game(log)], doc: { objects, order: Object.keys(objects) } });
  await settle();
  // (the stage's boxes are null without WebGL: a fixed one each)
  s.facet("scene.xray").box = (id) => (objects[id] ? { min: [0, 0, 0], max: [1, 1, 1] } : null);
  return log;
}

const inst = () => s.instance("scene.xray");
const panel = () => inst().panel;
const text = (sel) => [...panel().querySelectorAll(sel)].map((e) => e.textContent);
const hitOn = (id) => () => (id ? { id, point: [0, 0, 0], normal: [0, 1, 0], distance: 2 } : null);
const refreshed = () => new Promise((r) => setTimeout(r, 260));

describe("scene.xray", () => {
  it("X picks it up while not editing: its panel docks, the toolbar toggle checks; X puts it down and the panel goes", async () => {
    await mount();
    s.edit(false);
    await settle();
    expect(inst().state.held).toBe(false);
    s.key("x");
    await settle();
    expect(inst().state.held).toBe(true);
    expect(s.local.get().held).toMatchObject([{ ext: "scene.xray", command: "xray", pointer: false }]);
    // it asks nothing of the pointer
    expect(s.local.get().pointer.wanted).toBe(false);
    expect(s.drawer().order.length).toBe(1);
    expect(panel().isConnected).toBe(true);
    expect(inst().commands[0].state(null)).toMatchObject({ checked: true });
    // the scene's running list, with what isn't running
    expect(text('[data-id="running"] [data-ext] .xray-text')).toContain("Game");
    s.key("x");
    await settle();
    expect(inst().state.held).toBe(false);
    expect(s.drawer().order.length).toBe(0);
  });

  it("hover focuses an object (its holders and verbs); a click pins it and goes on down the chain; its route shows who took it", async () => {
    const log = await mount();
    s.edit(false);
    s.key("x");
    await settle();
    s.debug.viewport.pick = hitOn("b");
    s.pointer("pointermove", 30, 30, { buttons: 0 });
    await until(() => inst().state.hovered === "b", 1000);
    await refreshed();
    expect(text('[data-group="object"] h3')[0]).toBe("Two");
    const holders = panel().querySelector('[data-id="holders"] [data-ext="t.game"]');
    expect(holders.querySelector(".xray-chip").textContent).toBe("Flip (F)");
    expect(holders.querySelector(".xray-chip").dataset.state).toBe("off");
    // outlined in the world: the object
    expect([...(s.debug.viewport.layers.get("scene.xray") ?? [])].flatMap((g) => g.children).length).toBeGreaterThan(0);
    s.debug.viewport.pick = hitOn("a");
    s.click(30, 30);
    // the X-ray took nothing: the game's holder took the click
    expect(log.clicks).toEqual(["a"]);
    await refreshed();
    expect(inst().state.pinned).toBe("a");
    expect(text(".xray-focus")[0]).toBe("Pinned: Ace");
    const route = panel().querySelector('[data-id="route"] .xray-row:not(.older)');
    expect(route.querySelector(".xray-text").textContent).toBe("click on Ace");
    expect(route.querySelector('[data-state="took"]').textContent).toMatch(/holder Game/);
    // the hover moves on, the pin stays
    s.debug.viewport.pick = hitOn("t");
    s.pointer("pointermove", 40, 40, { buttons: 0 });
    await refreshed();
    expect(inst().state.pinned).toBe("a");
    // a click on nothing unpins
    s.debug.viewport.pick = hitOn(null);
    s.click(50, 50);
    await refreshed();
    expect(inst().state.pinned).toBe(null);
  });

  it("picking an extension shows its lens (trait values, the verbs grid) and outlines its objects; a layer toggled is the pref", async () => {
    await mount();
    s.key("x");
    await settle();
    panel().querySelector('[data-id="running"] [data-ext="t.game"]').click();
    expect(inst().state.picked).toBe("t.game");
    expect(text('[data-group="extension"] h3')[0]).toBe("Game");
    const table = panel().querySelector('[data-id="trait:t.card"] table');
    expect([...table.querySelectorAll("th")].map((e) => e.textContent)).toEqual(["t.card", "suit", "n"]);
    const grid = [...panel().querySelectorAll('[data-id="grid"] tr')].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(grid).toEqual([
      ["", "Flip"],
      ["the scene", "·"],
      ["Ace", "✓"],
      ["Two", "✗"],
    ]);
    // the next refresh outlines what it holds (it has only now been worked out for them)
    await refreshed();
    const boxes = [...(s.debug.viewport.layers.get("scene.xray") ?? [])].flatMap((g) => g.children);
    expect(boxes.length).toBe(2);
    const box = panel().querySelector('input[data-layer="clock"]');
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(s.api("scene.xray").use("prefs").get(PREF, null)).toContain("clock");
    expect(panel().querySelector('[data-id="clock"]')).not.toBe(null);
  });

  it("the object's last writers: each field (each trait) by the extension whose change it shows, a kernel's or unstamped said so", async () => {
    await mount();
    s.key("x");
    await settle();
    // (the harness's repo isn't Automerge's: the focus doc as an Automerge one, written as the kernel stamps)
    let d = A.from({ objects: JSON.parse(JSON.stringify(s.doc().objects)) });
    d = A.change(d, { message: JSON.stringify({ ext: "t.game" }) }, (x) => void (x.objects.a.traits["t.card"].n = 3));
    d = A.change(d, { message: JSON.stringify({ kernel: "packages" }) }, (x) => void (x.objects.a.name = "Ace"));
    s.facet("scene.xray").doc = () => d;
    s.debug.viewport.pick = hitOn("a");
    s.click(30, 30);
    await refreshed();
    const rows = Object.fromEntries([...panel().querySelectorAll('[data-id="wrote"] .xray-row')].map((r) => [r.querySelector(".xray-text").textContent, r.querySelector(".xray-sub").textContent]));
    expect(rows).toMatchObject({ "traits.t.card": "Game", name: "the kernel (packages)", transform: "unstamped" });
  });

  it("held with Measure, either way up: the X-ray passes, so Measure measures under it and pins too; Escape puts down the top one only; M puts Measure down from under it", async () => {
    await mount();
    await settle();
    const measuring = () => s.instance("scene.measure").state;
    const held = () => s.local.get().held.map((t) => t.command);
    s.key("m");
    s.key("x");
    await settle();
    expect(held()).toEqual(["measure", "xray"]);
    expect([measuring().held, inst().state.held]).toEqual([true, true]);
    // a click: the X-ray pins and passes it on; Measure (under it) takes it, its first point
    s.debug.viewport.pick = hitOn("a");
    s.click(30, 30);
    await refreshed();
    expect(inst().state.pinned).toBe("a");
    expect(measuring().a).not.toBe(null);
    // Escape: the top one (the X-ray) goes; Measure stays, its point too
    s.key("Escape", { code: "Escape" });
    await settle();
    expect([held(), inst().state.held, measuring().held]).toEqual([["measure"], false, true]);
    // X again, over it; then M puts Measure down from under the X-ray, which stays
    s.key("x");
    await settle();
    expect(held()).toEqual(["measure", "xray"]);
    s.key("m");
    await settle();
    expect([held(), inst().state.held, measuring().held]).toEqual([["xray"], true, false]);
    // the other way up: Measure on top takes the click; the X-ray under it (picked up again: nothing pinned) never hears it
    s.key("m");
    await settle();
    expect(held()).toEqual(["xray", "measure"]);
    s.debug.viewport.pick = hitOn("b");
    s.click(30, 30);
    await refreshed();
    expect(inst().state.pinned).toBe(null);
    expect(measuring().a?.objectId).toBe("b");
  });

  it("it doesn't ask for the pointer: a walk under it keeps its lock (nothing wanted), and what it looks at is the eye's, as the use prompt's", async () => {
    await mount();
    s.edit(false);
    await settle();
    expect(s.api("t.game").body.enter("walkish", null)).toBe(true);
    await settle();
    s.key("x");
    await settle();
    expect(s.local.get().pointer).toMatchObject({ lock: true, wanted: false });
    // a finger: the look is the eye's (as under the lock); the pointer's hover is elsewhere
    s.debug.viewport.centerRay = () => ({ origin: [0, 1.6, 4], dir: [0, 0, -1] });
    s.debug.viewport.raycast = () => ({ id: "b", point: [0, 0, 0], normal: [0, 1, 0], distance: 4 });
    s.debug.viewport.pick = hitOn("t");
    s.canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", button: 0, buttons: 1 }));
    s.canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", button: 0, buttons: 0 }));
    await settle();
    expect(s.local.get().pointer).toMatchObject({ lock: true, wanted: false, touch: true });
    await until(() => inst().state.hovered === "b", 1000);
    // the eye turns: the next look is what it looks at now
    s.debug.viewport.raycast = () => ({ id: "a", point: [0, 0, 0], normal: [0, 1, 0], distance: 4 });
    await until(() => inst().state.hovered === "a", 1000);
    expect(s.local.get().pointer.wanted).toBe(false);
  });

  it("Escape puts it down; down, it builds nothing, draws nothing and docks nothing", async () => {
    const log = await mount();
    s.edit(false);
    log.api.use("claims").claim("a", "turn");
    s.key("x");
    await settle();
    expect([...s.port.querySelectorAll(".label.xray-badge")].map((e) => e.textContent)).toEqual(["turn: you"]);
    s.key("Escape", { code: "Escape" });
    await settle();
    expect(inst().state.held).toBe(false);
    expect(s.drawer().order.length).toBe(0);
    s.debug.viewport.pick = hitOn("a");
    s.pointer("pointermove", 30, 30, { buttons: 0 });
    s.change((d) => (d.objects.a.name = "Ace!"));
    await refreshed();
    expect(inst().state).toMatchObject({ held: false, hovered: null, gears: null });
    expect([...(s.debug.viewport.layers.get("scene.xray") ?? [])].flatMap((g) => g.children)).toEqual([]);
    expect(s.port.querySelectorAll(".label.xray-badge").length).toBe(0);
  });
});
