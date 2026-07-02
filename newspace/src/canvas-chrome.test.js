// Mounts the REAL Canvas (happy-dom + a real in-memory repo) and pins the
// chrome ↔ context contract: chrome parts read their STATE from the canvas
// context Sources (host.context) — not mirrored props — and the slot mechanism
// hands a custom part the same host the built-ins get.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "./brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps the pointer-up drop path needs
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
  await flush();
  return m;
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

describe("canvas chrome reads the context", () => {
  it("mounts the toolbar + presence layer + layout tray", async () => {
    const { element } = await mountCanvas();
    expect(element.querySelector(".ns-toolbar")).toBeTruthy();
    expect(element.querySelector(".ns-presence")).toBeTruthy();
    expect(element.querySelector(".ns-layout-cust")).toBeTruthy();
  });

  it("a toolbar click drives the context tool, which drives the chrome back", async () => {
    const { element } = await mountCanvas();
    const pen = element.querySelector('.ns-toolbar button[title^="Draw"]');
    expect(pen).toBeTruthy();
    expect(pen.classList.contains("active")).toBe(false);
    // no selection + select tool ⇒ no properties panel yet
    expect(element.querySelector(".ns-props")).toBeFalsy();
    pen.click();
    await flush(5);
    // the active state comes back through the CONTEXT tool Source
    expect(pen.classList.contains("active")).toBe(true);
    // and the properties panel appears for the stroke mode (context-driven chrome)
    expect(element.querySelector(".ns-props")).toBeTruthy();
  });

  it("opts.tools restricts the toolbar to the given subset", async () => {
    const { element } = await mountCanvas({ tools: ["pen", "eraser"] });
    expect(element.querySelector('.ns-toolbar button[title^="Draw"]')).toBeTruthy();
    expect(element.querySelector('.ns-toolbar button[title^="Eraser"]')).toBeTruthy();
    expect(element.querySelector('.ns-toolbar button[title^="Select"]')).toBeFalsy();
    expect(element.querySelector('.ns-toolbar button[title^="Pan"]')).toBeFalsy();
  });

  it("a SLOT replaces a chrome part and receives the host with `context`", async () => {
    let got = null;
    const { element } = await mountCanvas({
      slots: {
        toolbar: (host) => {
          got = host;
          const el = document.createElement("div");
          el.className = "my-toolbar";
          return el;
        },
      },
    });
    expect(element.querySelector(".my-toolbar")).toBeTruthy();
    expect(element.querySelector(".ns-toolbar")).toBeFalsy(); // replaced, not doubled
    // the slot's host reads the SAME context the built-ins read…
    expect(got).toBeTruthy();
    expect(got.context).toBeTruthy();
    expect(typeof got.context.tool?.connect).toBe("function");
    expect(got.context.tool.value).toBe("select");
    // …plus the command surface
    expect(typeof got.setTool).toBe("function");
    got.setTool("pen");
    await flush(5);
    expect(got.context.tool.value).toBe("pen");
  });

  it("chrome parts gate on opts (toolbar/properties/presence off)", async () => {
    const { element } = await mountCanvas({ toolbar: false, presence: false });
    expect(element.querySelector(".ns-toolbar")).toBeFalsy();
    expect(element.querySelector(".ns-presence")).toBeFalsy();
  });
});

describe("canvas-side layout switcher (the ⊞ tray)", () => {
  it("opening the tray shows the shared switcher; picking a layout re-opens the folder", async () => {
    // register a canvas + a list layout for folders (the registry is process-global,
    // but this file runs isolated — mirrors index.jsx's real registrations)
    registerPlugins([
      { type: "sketchy:layout", id: "canvas", name: "Canvas", toolId: "sketchy", supportedDatatypes: ["folder"] },
      { type: "sketchy:layout", id: "list", name: "List", toolId: "sketchy:list", supportedDatatypes: ["folder"] },
    ]);
    const { element, folder } = await mountCanvas();
    const events = [];
    element.addEventListener("patchwork:open-document", (e) => events.push(e.detail));
    element.querySelector(".ns-layout-btn:not(.ns-inspect-btn)").click();
    await flush(5);
    const sw = element.querySelector(".ns-layout-sw");
    expect(sw).toBeTruthy();
    const btns = [...sw.querySelectorAll("button")];
    expect(btns.map((b) => b.textContent)).toEqual(["Canvas", "List"]);
    btns[0].click(); // already the canvas — no re-open
    expect(events.length).toBe(0);
    btns[1].click(); // switch to the list layout
    expect(events).toEqual([{ url: folder.url, toolId: "sketchy:list" }]);
  });
});

describe("properties popup — inline raw-value inlets + param-inlet-wins-when-wired", () => {
  async function mountGraph() {
    // the REAL raw-value + delay nodes (as index.jsx registers them)
    const { mountRawValue } = await import("./source-nodes.js");
    const { plugin: delayPlugin } = await import("./delay-node.js");
    registerPlugins([
      { type: "sketchy:window", id: "value", name: "Raw value", inlets: [], outlets: [{ name: "value", type: "json" }], load: async () => mountRawValue },
      delayPlugin,
    ]);
    // a raw value (number 5) feeding BOTH the delay's `in` inlet AND its `ms` PARAM
    const m = await mountCanvas({}, [
      { id: "rv1", kind: "editor", editorId: "value", x: 0, y: 0, w: 200, h: 80, inlets: {}, config: { raw: "5", kind: "number" } },
      { id: "dl1", kind: "editor", editorId: "delay", x: 300, y: 0, w: 200, h: 80, inlets: { in: { node: "rv1", outlet: "value" }, ms: { node: "rv1", outlet: "value" } } },
    ]);
    await flush(40); // let both nodes mount + register their outlets
    return m;
  }

  it("shows the wired param disabled (⚡, live value) and the raw inlet editable inline", async () => {
    const { element, layout } = await mountGraph();
    // select the delay node the way a user does — a pointer press on its chrome
    const dl = element.querySelector('.ns-editor[data-item-id="dl1"]');
    expect(dl).toBeTruthy();
    dl.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await flush(10);
    const props = element.querySelector(".ns-props");
    expect(props).toBeTruthy();
    // the ms PARAM is wired ⇒ its slider is disabled + flagged; it shows the WIRED value
    expect(props.querySelector(".ns-wired-flag")).toBeTruthy();
    const slider = props.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    expect(slider.disabled).toBe(true);
    expect(Number(slider.value)).toBe(5); // the raw node's live value, not the config default
    // the `in` inlet is wired to a raw value ⇒ an inline editor appears
    const flag = props.querySelector(".ns-raw-flag");
    expect(flag).toBeTruthy();
    const raw = props.querySelector('input[type="number"]');
    expect(raw).toBeTruthy();
    expect(Number(raw.value)).toBe(5);
    // editing inline writes THROUGH the raw node's stream — its own input follows
    raw.value = "9";
    raw.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(10);
    const rvInput = element.querySelector('.ns-editor[data-item-id="rv1"] .ns-rawvalue input');
    expect(rvInput).toBeTruthy();
    expect(rvInput.value).toBe("9");
    // and the WIRED PARAM mirrors into config (the runtime half: the wire wins)
    await flush(10);
    expect(layout.doc().items.find((x) => x.id === "dl1").config.ms).toBe(9);
  });

  it("ports render rough.js nubs (the hit divs stay; the drawing is svg)", async () => {
    const { element } = await mountGraph();
    // ports show while the wire tool is armed (keyboard shortcut)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    await flush(10);
    const port = element.querySelector('.ns-editor[data-item-id="dl1"] .ns-node-port.ns-node-inlet');
    expect(port).toBeTruthy();
    // the hit host keeps its data attrs (wire grabs unchanged) …
    expect(port.getAttribute("data-sketchy-inlet")).toBe("in");
    // … and the visible nub is a rough svg drawing, not a CSS shape
    const nub = port.querySelector("svg.ns-nub");
    expect(nub).toBeTruthy();
    expect(nub.querySelectorAll("path").length).toBeGreaterThan(0);
    // deterministic: two renders of the same port draw the same scribble
    const d1 = [...nub.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");
    const outlet = element.querySelector('.ns-editor[data-item-id="rv1"] .ns-node-port.ns-node-outlet svg.ns-nub');
    expect(outlet).toBeTruthy();
    const d2 = [...outlet.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");
    expect(d1).not.toBe(d2); // different ports, different (but each stable) scribbles
  });
});

describe("port schema popover — shows the ACTUAL shape (describeSchema)", () => {
  it("a structured inlet's popover renders its field structure, not a vague label", async () => {
    const { objectSchema, stringSchema, numberSchema } = await import("./ops.js");
    registerPlugins([{
      type: "sketchy:window", id: "shapely", name: "Shapely",
      inlets: [{ name: "in", type: "json", schema: objectSchema({ name: stringSchema(), count: numberSchema() }, ["count"]), required: true }],
      outlets: [],
      load: async () => ({ element }) => { element.textContent = "shapely"; return () => {}; },
    }]);
    const { element } = await mountCanvas({}, [
      { id: "sh1", kind: "editor", editorId: "shapely", x: 0, y: 0, w: 200, h: 100, inlets: {} },
    ]);
    await flush(30);
    // arm the wire tool so the ports show, then CLICK the inlet port
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    await flush(10);
    const port = element.querySelector('.ns-editor[data-item-id="sh1"] .ns-node-port.ns-node-inlet');
    expect(port).toBeTruthy();
    port.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await flush(10);
    const info = element.querySelector(".ns-portinfo");
    expect(info).toBeTruthy();
    expect(info.textContent).toContain("Shapely ◂ in");
    // the real shape, not "(specific shape)"
    expect(info.textContent).toContain("accepts: { name: string, count?: number }");
    expect(info.textContent).not.toContain("(specific shape)");
    expect(info.textContent).toContain("required");
  });
});

describe("inspect mode — context ports as top-edge inlets", () => {
  it("the eye toggles the strip; ports are real (click with the wire tool → schema popover)", async () => {
    const { element } = await mountCanvas();
    expect(element.querySelector(".ns-ctx-inlets")).toBeFalsy();
    const eye = element.querySelector(".ns-inspect-btn");
    expect(eye).toBeTruthy();
    eye.click();
    await flush(5);
    const strip = element.querySelector(".ns-ctx-inlets");
    expect(strip).toBeTruthy();
    const ports = [...strip.querySelectorAll("[data-sketchy-port]")];
    expect(ports.map((p) => p.getAttribute("data-sketchy-port"))).toEqual([
      "camera", "pointer", "tool", "brush", "selection",
    ]);
    // each renders a rough nub; the writable camera reads as bidi (a diamond nub —
    // its fill is the rotated rect, not the circle)
    expect(ports.every((p) => p.querySelector("svg.ns-nub path"))).toBe(true);
    expect(ports[0].querySelector("svg.ns-nub rect.ns-nub-fill")).toBeTruthy(); // camera: bidi
    expect(ports[1].querySelector("svg.ns-nub circle.ns-nub-fill")).toBeTruthy(); // pointer: one-way
    // arm the wire tool and CLICK a port — the document-capture grab reads the
    // data-sketchy-port ({kind:"context"}) and a click opens the schema popover
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    await flush(5);
    ports[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await flush(5);
    const info = element.querySelector(".ns-portinfo");
    expect(info).toBeTruthy();
    expect(info.textContent).toContain("context ▸ camera");
    expect(info.textContent).toContain("writable"); // the camera stream is bidi
    // toggling off removes the strip
    element.querySelector(".ns-portinfo") && element.querySelector(".ns-chooser-backdrop").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    eye.click();
    await flush(5);
    expect(element.querySelector(".ns-ctx-inlets")).toBeFalsy();
  });
});
