// FLAPS — Squeak-style edge tabs/drawers. Pure state resolution + the registry
// listing, then a real Canvas mount: the tab renders, click opens the drawer
// (the flap's mount runs, gets the chrome host), click closes (cleanup runs),
// and dragging the tab to another edge RE-DOCKS it — persisted per-viewer in
// the top-layer doc (the re-render reads back through it).
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "./brush/canvas.jsx";
import { listFlaps, resolveFlapState, nearestEdge, FLAP_EDGES } from "./flaps.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const mounted = [];
async function mountCanvas(opts = {}, items = []) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts }), element);
  const m = { repo, layout, folder, element, dispose };
  mounted.push(m);
  await flush(40); // the top-layer doc (flap state) resolves async
  return m;
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

describe("flap state (pure)", () => {
  it("resolveFlapState: viewer state wins, else descriptor edge, else bottom; open defaults closed", () => {
    expect(resolveFlapState(null, { edge: "left" })).toEqual({ edge: "left", open: false });
    expect(resolveFlapState({ edge: "right", open: true }, { edge: "left" })).toEqual({ edge: "right", open: true });
    expect(resolveFlapState(null, null)).toEqual({ edge: "bottom", open: false });
    expect(resolveFlapState({ edge: "top" }, { edge: "up" })).toEqual({ edge: "bottom", open: false }); // junk edges fall through
  });

  it("nearestEdge picks the closest of left/right/bottom (never top)", () => {
    expect(nearestEdge(2, 300, 1000, 800)).toBe("left");
    expect(nearestEdge(995, 300, 1000, 800)).toBe("right");
    expect(nearestEdge(500, 790, 1000, 800)).toBe("bottom");
    expect(nearestEdge(500, 5, 1000, 800)).not.toBe("top");
    expect(FLAP_EDGES).toEqual(["bottom", "left", "right"]);
  });
});

describe("the sketchy:flap registry + the FlapDock", () => {
  let mounts = 0, cleanups = 0;
  registerPlugins([{
    type: "sketchy:flap", id: "test-flap", name: "Bits", edge: "bottom",
    async load() {
      return ({ element, host }) => {
        mounts++;
        element.textContent = "hello bits " + (host && host.context ? "ctx" : "");
        return () => { cleanups++; };
      };
    },
  }]);

  it("listFlaps sees the registration", () => {
    const flaps = listFlaps();
    expect(flaps.some((f) => f.id === "test-flap" && f.name === "Bits")).toBe(true);
  });

  it("renders a tab; click opens the drawer (mount runs with the chrome host); click closes (cleanup)", async () => {
    const { element } = await mountCanvas();
    const strip = element.querySelector(".ns-flaps-bottom");
    expect(strip).toBeTruthy();
    const tab = strip.querySelector(".ns-flap-tab");
    expect(tab).toBeTruthy();
    expect(tab.textContent).toBe("Bits");
    expect(element.querySelector(".ns-flap-drawer")).toBeFalsy();
    const before = mounts;
    // click = pointerdown + pointerup with no movement
    tab.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 700 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 50, clientY: 700 }));
    await flush(30);
    const drawer = element.querySelector(".ns-flap-drawer");
    expect(drawer).toBeTruthy();
    expect(drawer.textContent).toContain("hello bits ctx"); // the mount got the host (context included)
    expect(mounts).toBe(before + 1);
    // click again → closed + cleaned up
    const cBefore = cleanups;
    tab.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 700 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 50, clientY: 700 }));
    await flush(20);
    expect(element.querySelector(".ns-flap-drawer")).toBeFalsy();
    expect(cleanups).toBe(cBefore + 1);
  });

  it("dragging the tab to another edge re-docks it (persisted per-viewer in the top layer)", async () => {
    const { element } = await mountCanvas();
    const tab = element.querySelector(".ns-flaps-bottom .ns-flap-tab");
    expect(tab).toBeTruthy();
    // drag: pointerdown, a real move (>8px), pointerup near the LEFT edge
    tab.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 50, clientY: 700 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 400 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 3, clientY: 300 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 3, clientY: 300 }));
    await flush(30);
    // the tab now hangs off the LEFT edge — rendered back OUT of the persisted doc state
    expect(element.querySelector(".ns-flaps-bottom .ns-flap-tab")).toBeFalsy();
    const moved = element.querySelector(".ns-flaps-left .ns-flap-tab");
    expect(moved).toBeTruthy();
    expect(moved.textContent).toBe("Bits");
  });

  it("gates like other chrome parts (opts.flaps === false hides the dock)", async () => {
    const { element } = await mountCanvas({ flaps: false });
    expect(element.querySelector(".ns-flaps")).toBeFalsy();
  });

  it("a SLOT replaces the flap dock", async () => {
    const { element } = await mountCanvas({
      slots: { flaps: () => { const el = document.createElement("div"); el.className = "my-flaps"; return el; } },
    });
    expect(element.querySelector(".my-flaps")).toBeTruthy();
    expect(element.querySelector(".ns-flaps")).toBeFalsy();
  });
});
