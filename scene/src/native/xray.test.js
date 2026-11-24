// scene.xray (xray.js): the X-ray as a held tool on a stage. X picks it up
// (in any body, editing or not) and docks its legend; it is an ordinary tool
// on the hand stack that passes every event, so the chain and the hands
// under it (Measure, Edit) go on; it doesn't ask for the pointer, so a lock
// body keeps its lock, and its look is then the eye's. Held, every object is
// displayed ghosted and outlined by who responds to it, glyphs label live
// state, the legend isolates an extension, the hovered object has a card, a
// click pins it (its details in the panel) and the last route runs along the
// bottom; Escape puts it down while it's the top hand, and with it down it
// does nothing and leaves nothing displayed.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as A from "@automerge/automerge";
import { mountStage, object, settle as settled } from "../test/stage-harness.js";
import { manualTime } from "../stage/time.js";
import keys from "../parts/keys.js";
import measure from "../parts/measure.js";
import xray from "./xray.js";
import { GHOST, GLYPHS, OPACITY, colours } from "./xray-model.js";

let s = null;
// the stage's time, stepped: a settle runs a frame of it, a refresh the X-ray's REFRESH_MS and more
let time = null;
const settle = async () => {
  await settled();
  await time?.step(1);
  await settled();
};
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
  time = manualTime();
  s = await mountStage({ time, extensions: [KEYS, XRAY, MEASURE, game(log)], doc: { objects, order: Object.keys(objects) } });
  await settle();
  // (the stage's boxes are null without WebGL: a fixed one each)
  s.facet("scene.xray").box = (id) => (objects[id] ? { min: [0, 0, 0], max: [1, 1, 1] } : null);
  s.facet("scene.xray").project = ([x, y]) => ({ x: 100 + 40 * x, y: 100 + 40 * y, visible: true });
  return log;
}

const inst = () => s.instance("scene.xray");
const panel = () => inst().panel;
const text = (sel) => [...panel().querySelectorAll(sel)].map((e) => e.textContent);
const hitOn = (id) => () => (id ? { id, point: [0, 0, 0], normal: [0, 1, 0], distance: 2 } : null);
const refreshed = async () => {
  await time.advance(260);
  await settled();
};

describe("scene.xray", () => {
  const looksOf = (id) => s.debug.displayed().get(id) ?? null;

  it("X picks it up while not editing: its legend docks, the toolbar toggle checks; X puts it down and the panel goes", async () => {
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
    // the legend: the game, with the two cards it holds
    expect(text(".xray-row .xray-name")).toContain("Game");
    expect(panel().querySelector('.xray-row[data-ext="t.game"] .xray-count').textContent).toBe("2");
    s.key("x");
    await settle();
    expect(inst().state.held).toBe(false);
    expect(s.drawer().order.length).toBe(0);
  });

  it("every object is displayed ghosted and outlined in its holders' colour, what nothing holds faded; down, none of it stays", async () => {
    await mount();
    s.key("x");
    await settle();
    await refreshed();
    const game = colours(["t.game"])("t.game");
    expect(looksOf("a")).toMatchObject({ tint: GHOST, opacity: OPACITY.ghost, outline: [game] });
    expect(looksOf("b")).toMatchObject({ outline: [game] });
    expect(looksOf("t")).toEqual({ tint: GHOST, opacity: OPACITY.faded });
    // the legend row isolates: its objects lit, the rest faded; again, and it clears
    panel().querySelector('.xray-row[data-ext="t.game"]').click();
    expect(inst().state.isolated).toBe("t.game");
    expect(looksOf("a")).toEqual({ opacity: OPACITY.lit, outline: [game] });
    expect(looksOf("t")).toEqual({ tint: GHOST, opacity: OPACITY.faded });
    expect(panel().querySelector('.xray-row[data-ext="t.game"]').hasAttribute("data-on")).toBe(true);
    panel().querySelector('.xray-row[data-ext="t.game"]').click();
    expect(inst().state.isolated).toBe(null);
    expect(looksOf("a")).toMatchObject({ opacity: OPACITY.ghost });
    s.key("x");
    await settle();
    expect(s.debug.displayed().size).toBe(0);
  });

  it("hover gives the object a card (its traits, the responding chain with verbs as keycaps) and lights it; a click pins it, goes on down the chain, and opens its details; the route runs along the bottom", async () => {
    const log = await mount();
    s.edit(false);
    s.key("x");
    await settle();
    s.debug.viewport.pick = hitOn("b");
    s.pointer("pointermove", 30, 30, { buttons: 0 });
    await time.until(() => inst().state.hovered === "b", { frames: 60 });
    await refreshed();
    const card = inst().card;
    expect(card.hidden).toBe(false);
    expect(card.querySelector("h4").textContent).toBe("Two");
    expect([...card.querySelectorAll(".xray-trait")].map((e) => e.textContent)).toEqual(["t.card"]);
    expect([...card.querySelectorAll(".xray-chain > .xray-ext b")].map((e) => e.textContent)).toContain("Game");
    const flip = card.querySelector('.xray-ext[data-ext="t.game"] .xray-verb');
    expect([flip.firstChild.textContent, flip.querySelector("kbd").textContent, flip.dataset.state]).toEqual(["Flip", "F", "off"]);
    expect(looksOf("b").opacity).toBe(OPACITY.lit);
    // nothing of the scene's services that doesn't act on it: only holders and view plugins with a verb
    expect(card.querySelector(".xray-live")).toBe(null);
    s.debug.viewport.pick = hitOn("a");
    s.click(30, 30);
    // the X-ray took nothing: the game's holder took the click
    expect(log.clicks).toEqual(["a"]);
    await refreshed();
    expect(inst().state.pinned).toBe("a");
    expect(text(".xray-hint")[0]).toBe("Pinned: Ace");
    expect(panel().querySelector('.xray-fold[data-ext="t.game"]')).not.toBe(null);
    // the route: the click on Ace, the game's holders taking it
    const strip = inst().strip;
    expect(strip.hidden).toBe(false);
    expect(strip.querySelector(".xray-route-on").textContent).toBe("click on Ace");
    expect(strip.querySelector(".xray-box[data-took]").textContent).toMatch(/Holders.*Game/);
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

  it("glyphs on objects with live state, one label each: a claim is a lock; not drawn for objects with none", async () => {
    const log = await mount();
    s.edit(false);
    log.api.use("claims").claim("a", "turn");
    s.key("x");
    await settle();
    await refreshed();
    expect([...s.port.querySelectorAll(".label.xray-badge")].map((e) => e.textContent)).toEqual([GLYPHS.lock.text]);
    expect(inst().state.glyphs.get("a")).toEqual([{ kind: "lock", title: "turn claimed by you" }]);
    // the legend's key says only what is shown
    expect(text(".xray-key span")).toEqual([`${GLYPHS.lock.text} ${GLYPHS.lock.name}`]);
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
    const rows = [...panel().querySelectorAll(".xray-fold")].find((d) => /Last written by/.test(d.textContent));
    const wrote = Object.fromEntries([...rows.querySelectorAll(".xray-line")].map((l) => l.textContent.split(": ")));
    expect(wrote).toMatchObject({ "traits.t.card": "Game", name: "the kernel (packages)", transform: "unstamped" });
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
    await time.until(() => inst().state.hovered === "b", { frames: 60 });
    // the eye turns: the next look is what it looks at now
    s.debug.viewport.raycast = () => ({ id: "a", point: [0, 0, 0], normal: [0, 1, 0], distance: 4 });
    await time.until(() => inst().state.hovered === "a", { frames: 60 });
    expect(s.local.get().pointer.wanted).toBe(false);
  });

  it("Escape puts it down; down, it builds nothing, displays nothing and docks nothing", async () => {
    const log = await mount();
    s.edit(false);
    log.api.use("claims").claim("a", "turn");
    s.key("x");
    await settle();
    await refreshed();
    expect(s.debug.displayed().size).toBeGreaterThan(0);
    s.key("Escape", { code: "Escape" });
    await settle();
    expect(inst().state.held).toBe(false);
    expect(s.drawer().order.length).toBe(0);
    s.debug.viewport.pick = hitOn("a");
    s.pointer("pointermove", 30, 30, { buttons: 0 });
    s.change((d) => (d.objects.a.name = "Ace!"));
    await refreshed();
    expect(inst().state).toMatchObject({ held: false, hovered: null, gears: null });
    expect(s.debug.displayed().size).toBe(0);
    expect(s.port.querySelectorAll(".label.xray-badge").length).toBe(0);
    expect(inst().card.hidden && inst().strip.hidden).toBe(true);
  });
});
