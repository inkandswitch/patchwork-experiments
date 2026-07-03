// FLAPS as ITEMS — a `flap: true` FRAME (README.md's confirmed design): a named
// sticky container reusing the frame machinery (sub-space containment, title,
// clipping). While STUCK it collapses to an edge TAB; clicking the tab opens
// the drawer; Escape / a canvas click / re-clicking collapses. Open state is
// PER-VIEWER (the top-layer doc) — the shared layout doc never changes.
// (The old registry-flap chrome was a different, unshipped design.)
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "../src/brush/canvas.jsx";
import { makeFlapSpace, partsWindowSeedItem } from "../src/brush/constants.js";
import { plugin as partsPlugin } from "../src/parts-bin.js";

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const mounted = [];
async function mountCanvas(repo, items = []) {
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
  mounted.push({ element, dispose });
  await flush(80); // the top-layer doc + flap sub-spaces resolve async
  return { repo, layout, folder, element };
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

// a canvas-home stuck flap (visible/interactive on the default layer)
async function stuckFlap(repo, name = "shelf") {
  const folder = await makeFlapSpace(repo, name);
  return { id: "fl1", kind: "frame", flap: true, url: folder.url, sticky: { edge: "left", t: 0.5 }, x: 40, y: 40, w: 240, h: 200, rotation: 0 };
}

describe("a stuck flap collapses to an edge tab; the tab opens the drawer (per-viewer)", () => {
  it("renders the TAB (named, vertical on a left dock) instead of the frame; click opens; re-click closes", async () => {
    const repo = new Repo({});
    const item = await stuckFlap(repo);
    const { element, layout } = await mountCanvas(repo, [item]);
    const sharedBefore = JSON.stringify(layout.doc().items.find((x) => x.id === "fl1"));
    // collapsed: the tab, not the drawer
    const tabBox = element.querySelector('.ns-flap-tab-box[data-item-id="fl1"]');
    expect(tabBox).toBeTruthy();
    expect(element.querySelector('.ns-doc[data-item-id="fl1"]')).toBeFalsy();
    const tab = tabBox.querySelector(".ns-flap-tab");
    expect(tab.classList.contains("ns-flap-tab-left")).toBe(true); // vertical on left/right edges (CSS writing-mode)
    expect(tab.textContent).toBe("shelf"); // the flap's NAME = its folder title (frames' title, reused)
    // click → the drawer (the ordinary sticky frame render) + the tab stays as the collapse handle
    tab.click();
    await flush(30);
    const drawer = element.querySelector('.ns-doc.ns-flap[data-item-id="fl1"]');
    expect(drawer).toBeTruthy();
    expect(drawer.classList.contains("ns-flap-open")).toBe(true);
    expect(element.querySelector('.ns-flap-tab-box[data-item-id="fl1"]').classList.contains("open")).toBe(true);
    // re-click collapses
    element.querySelector('.ns-flap-tab-box[data-item-id="fl1"] .ns-flap-tab').click();
    await flush(20);
    expect(element.querySelector('.ns-doc[data-item-id="fl1"]')).toBeFalsy();
    // PER-VIEWER: none of that touched the shared layout doc's item
    expect(JSON.stringify(layout.doc().items.find((x) => x.id === "fl1"))).toBe(sharedBefore);
  });

  it("Escape collapses an open drawer", async () => {
    const repo = new Repo({});
    const item = await stuckFlap(repo);
    const { element } = await mountCanvas(repo, [item]);
    element.querySelector('.ns-flap-tab-box[data-item-id="fl1"] .ns-flap-tab').click();
    await flush(30);
    expect(element.querySelector('.ns-doc[data-item-id="fl1"]')).toBeTruthy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush(20);
    expect(element.querySelector('.ns-doc[data-item-id="fl1"]')).toBeFalsy();
  });

  it("an UNSTUCK flap is a normal floating frame (no tab)", async () => {
    const repo = new Repo({});
    const folder = await makeFlapSpace(repo, "loose");
    const { element } = await mountCanvas(repo, [
      { id: "fl2", kind: "frame", flap: true, url: folder.url, x: 40, y: 40, w: 240, h: 200, rotation: 0 },
    ]);
    expect(element.querySelector('.ns-doc.ns-flap[data-item-id="fl2"]')).toBeTruthy();
    expect(element.querySelector('.ns-flap-tab-box[data-item-id="fl2"]')).toBeFalsy(); // (ns-parts, the seeded flap, has its own tab)
  });
});

describe("the seeded PARTS flap", () => {
  it("a fresh sketch grows `ns-parts` — a flap frame parking the parts-bin window in its sub-space", async () => {
    registerPlugins([partsPlugin]);
    const repo = new Repo({});
    const { layout } = await mountCanvas(repo, []);
    await flush(120); // seedPartsFlap creates the flap's docs async
    const flap = layout.doc().items.find((x) => x.id === "ns-parts");
    expect(flap).toBeTruthy();
    expect(flap.kind).toBe("frame");
    expect(flap.flap).toBe(true);
    expect([...flap.layers]).toEqual(["overlay"]); // overlay-only, like the old bin
    expect(JSON.parse(JSON.stringify(flap.sticky))).toEqual({ edge: "left", t: 1 });
    const flapFolder = await repo.find(flap.url);
    expect(flapFolder.doc().title).toBe("parts");
    const sub = await repo.find(flapFolder.doc().sketch);
    expect(sub.doc().items.map((x) => x.id)).toEqual([partsWindowSeedItem().id]);
  });
});
