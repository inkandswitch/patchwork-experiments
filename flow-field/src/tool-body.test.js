import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRegistry, resetRegistries } from "@inkandswitch/patchwork-plugins";
import Tool, { HULL_DEBOUNCE_MS, SECTION_RETRY_MS } from "./tool.js";
import { FlowFieldDatatype } from "./datatype.js";
import { transomWaterline, prismGLB } from "./test/hull-fixtures.js";

const HULL = "automerge:hu11111111111111111111111";

function fakeHandle(url, initial) {
  let doc = initial;
  const listeners = new Set();
  return {
    url,
    doc: () => doc,
    change(fn) {
      const next = structuredClone(doc);
      fn(next);
      JSON.stringify(next, (k, v) => {
        if (v === undefined) throw new Error(`undefined written at ${k}`); // automerge refuses it
        return v;
      });
      doc = next;
      for (const l of [...listeners]) l({ doc });
    },
    on(ev, fn) {
      if (ev === "change") listeners.add(fn);
    },
    off(ev, fn) {
      if (ev === "change") listeners.delete(fn);
    },
    listeners,
  };
}

const flowDoc = () => {
  const d = {};
  FlowFieldDatatype.init(d);
  return d;
};

const sections = [];
function registerExact() {
  getRegistry("geometry:section").register({
    type: "geometry:section",
    id: "test-hull-section",
    name: "Test hull section",
    supportedDatatypes: ["test-hull"],
    planes: ["waterline", "z"],
    async load() {
      return {
        section(doc, request) {
          sections.push(request);
          const k = doc.scale ?? 1;
          return { frame: "floating", units: "m", plane: { kind: request.plane.kind, z: request.plane.z ?? 0 }, loops: [{ points: transomWaterline().map(([x, y]) => [x * k, y * k]), closed: true }] };
        },
      };
    },
  });
}
function registerMesh() {
  getRegistry("scene:source").register({
    type: "scene:source",
    id: "test-hull-surface",
    name: "Test hull",
    supportedDatatypes: ["test-hull"],
    params: [],
    async load() {
      return { build: async () => ({ kind: "glb", glb: prismGLB(transomWaterline()) }) };
    },
  });
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let element;
let cleanup;
let hull;
beforeEach(() => {
  resetRegistries();
  sections.length = 0;
  getRegistry("patchwork:datatype").register({
    type: "patchwork:datatype",
    id: "test-hull",
    async load() {
      return { getTitle: (d) => `Hull ${d.name}` };
    },
  });
  hull = fakeHandle(HULL, { "@patchwork": { type: "test-hull" }, name: "Mk 1", scale: 1 });
  globalThis.repo = { find: async (url) => (url === HULL ? hull : Promise.reject(new Error("unavailable"))) };
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  element.remove();
  delete globalThis.repo;
});

const q = (sel) => element.querySelector(sel);
const change = (input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("linking a hull in the editor", () => {
  it("links by pasted URL, shows a locked chip naming the doc and the section path, and writes only the link", async () => {
    registerExact();
    const h = fakeHandle("automerge:flow", flowDoc());
    cleanup = Tool(h, element);
    expect(q(".chip")).toBeTruthy();
    expect(q(".chip").closest("[hidden]")).toBeTruthy(); // not linked yet
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link hull…").click();
    const input = q('[aria-label="Linked document URL"]');
    input.value = `https://patchwork.inkandswitch.com/#doc=${HULL.slice(10)}`;
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link").click();
    expect(h.doc().body).toEqual({ url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 120 });
    expect(q(".notice").textContent).toMatch(/2 elements are still there/);
    // the default heading (0°, toward the bow) is turned round so the hull goes ahead
    expect(h.doc().freestream.headingDeg).toBe(180);
    expect(q(".notice").textContent).toMatch(/now heads 180°/);
    await settle();
    expect(q(".chip-title").textContent).toBe("Hull Mk 1");
    expect(q(".chip-path").textContent).toBe("exact section");
    expect(q(".body-chip").hidden).toBe(false);
    expect(q(".body-chip").textContent).toMatch(/Hull Mk 1 · exact section/);
    expect(q(".body-status").textContent).toMatch(/1 loop at z = 0\.00 m/);
    expect(sections.at(-1)).toEqual({ plane: { kind: "waterline" } });
    // nothing derived is stored
    expect(Object.keys(h.doc().elements)).toEqual(["bow", "stern"]);
  });

  it("keeps the 'elements are still there' notice in step with the doc as they're deleted", async () => {
    registerExact();
    const h = fakeHandle("automerge:flow", flowDoc());
    cleanup = Tool(h, element);
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link hull…").click();
    q('[aria-label="Linked document URL"]').value = HULL;
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link").click();
    expect(q(".notice").textContent).toMatch(/2 elements are still there/);
    const del = () => {
      // select from the list (selecting alone must not delete), then Delete
      element.querySelector("ul.elements li").click();
      expect(Object.keys(h.doc().elements).length).toBeGreaterThan(0);
      [...element.querySelectorAll("button")].find((b) => b.textContent === "Delete").click();
    };
    del();
    expect(Object.keys(h.doc().elements)).toHaveLength(1);
    expect(q(".notice").textContent).toMatch(/1 element is still there/);
    expect(q(".notice").textContent).toMatch(/now heads 180°/);
    del();
    expect(h.doc().elements).toEqual({});
    expect(q(".notice").textContent).not.toMatch(/still there/);
    expect(q(".notice").textContent).toMatch(/now heads 180°/);
    expect(q(".notice").hidden).toBe(false);
    cleanup();
    // with nothing else to say, the notice goes away once the elements do
    const d = flowDoc();
    d.freestream.headingDeg = 180;
    const g = fakeHandle("automerge:flow2", d);
    cleanup = Tool(g, element);
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link hull…").click();
    q('[aria-label="Linked document URL"]').value = HULL;
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link").click();
    expect(q(".notice").textContent).toMatch(/2 elements are still there/);
    g.change((x) => {
      x.elements = {};
    });
    expect(q(".notice").hidden).toBe(true);
  });

  it("turns the stream round on linking even with no elements, but leaves a chosen heading alone", async () => {
    registerExact();
    const d = flowDoc();
    d.elements = {};
    const h = fakeHandle("automerge:flow", d);
    cleanup = Tool(h, element);
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link hull…").click();
    q('[aria-label="Linked document URL"]').value = HULL;
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link").click();
    expect(h.doc().freestream.headingDeg).toBe(180);
    expect(q(".notice").textContent).toMatch(/now heads 180°/);
    cleanup();
    const e = flowDoc();
    e.elements = {};
    e.freestream.headingDeg = 20;
    const g = fakeHandle("automerge:flow2", e);
    cleanup = Tool(g, element);
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link hull…").click();
    q('[aria-label="Linked document URL"]').value = HULL;
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Link").click();
    expect(g.doc().freestream.headingDeg).toBe(20);
    expect(q(".notice").textContent).toMatch(/moves backward/);
  });

  it("retries a hull that isn't there yet, and picks up a provider that registers later", async () => {
    let available = false;
    globalThis.repo = { find: async (url) => (url === HULL && available ? hull : Promise.reject(new Error("unavailable"))) };
    const d = flowDoc();
    d.body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d" };
    cleanup = Tool(fakeHandle("automerge:flow", d), element);
    await settle();
    expect(q(".body-status").textContent).toMatch(/couldn't load the linked document/);
    available = true;
    await settle(SECTION_RETRY_MS + 100);
    // found now, but nothing installed to cut it
    expect(q(".body-status").textContent).toMatch(/no geometry:section or scene:source provider/);
    registerExact();
    await settle(HULL_DEBOUNCE_MS + 50);
    expect(q(".chip-path").textContent).toBe("exact section");
    cleanup();
    cleanup = null;
    expect(hull.listeners.size).toBe(0);
  });

  it("uses the mesh fallback when there is no section provider, and says so", async () => {
    registerMesh();
    const d = flowDoc();
    d.body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 60 };
    cleanup = Tool(fakeHandle("automerge:flow", d), element);
    await settle();
    expect(q(".chip-path").textContent).toBe("mesh fallback");
    expect(q(".body-status").textContent).toMatch(/Mesh slice of Test hull/);
  });

  it("reports a missing provider without breaking the view", async () => {
    const d = flowDoc();
    d.body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d" };
    cleanup = Tool(fakeHandle("automerge:flow", d), element);
    await settle();
    expect(q(".chip-path").textContent).toBe("no section");
    expect(q(".body-status").textContent).toMatch(/No body: no geometry:section or scene:source provider/);
  });

  it("follows hull edits live (debounced), and re-cuts when the plane changes", async () => {
    registerExact();
    const d = flowDoc();
    d.body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d" };
    const h = fakeHandle("automerge:flow", d);
    cleanup = Tool(h, element);
    await settle();
    const before = sections.length;
    hull.change((x) => (x.scale = 1.2));
    hull.change((x) => (x.scale = 1.3));
    await settle(HULL_DEBOUNCE_MS + 50);
    expect(sections.length).toBe(before + 1); // two edits, one re-cut
    change(q('[aria-label="Section plane"]'), "z");
    expect(h.doc().body.plane).toEqual({ kind: "z", z: 0 });
    change(q('[aria-label="Section height"]'), -0.4);
    expect(h.doc().body.plane).toEqual({ kind: "z", z: -0.4 });
    await settle();
    expect(sections.at(-1)).toEqual({ plane: { kind: "z", z: -0.4 } });
    change(q('[aria-label="Body model"]'), "slender-body-3d");
    change(q('[aria-label="Body panels"]'), 9999);
    expect(h.doc().body).toMatchObject({ model: "slender-body-3d", panels: 400 });
    // unmounting drops the hull subscription
    cleanup();
    cleanup = null;
    expect(hull.listeners.size).toBe(0);
  });

  it("unlinks a slender body into ordinary elements", async () => {
    registerExact();
    const d = flowDoc();
    d.body = { url: HULL, plane: { kind: "waterline" }, model: "slender-body-3d", panels: 60 };
    d.freestream.headingDeg = 180;
    const h = fakeHandle("automerge:flow", d);
    cleanup = Tool(h, element);
    await settle();
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Unlink").click();
    expect(h.doc().body).toBeNull();
    const added = Object.entries(h.doc().elements).filter(([id]) => id.startsWith("hull-"));
    expect(added.length).toBeGreaterThan(4);
    for (const [, e] of added) {
      expect(["source", "sink"]).toContain(e.kind);
      expect(e.position.every(Number.isFinite)).toBe(true);
    }
    expect(q(".notice").textContent).toMatch(/now \d+ sources and sinks/);
  });

  it("warns before dropping a waterplane body on unlink", async () => {
    registerExact();
    const d = flowDoc();
    d.body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d" };
    const h = fakeHandle("automerge:flow", d);
    cleanup = Tool(h, element);
    await settle();
    const buttons = () => [...element.querySelectorAll("button")];
    buttons().find((b) => b.textContent === "Unlink").click();
    expect(h.doc().body).not.toBeNull();
    expect(q(".confirm").hidden).toBe(false);
    expect(q(".confirm").textContent).toMatch(/drops the waterplane body/);
    buttons().find((b) => b.textContent === "Drop body and unlink").click();
    expect(h.doc().body).toBeNull();
    expect(Object.keys(h.doc().elements)).toEqual(["bow", "stern"]);
    expect(q(".notice").textContent).toMatch(/waterplane body is dropped/);
  });

  it("links a document dropped onto the view, and fits the domain round it", async () => {
    registerExact();
    const h = fakeHandle("automerge:flow", flowDoc());
    cleanup = Tool(h, element);
    const data = { "text/x-patchwork-dnd": JSON.stringify({ items: [{ url: HULL, name: "Mk 1" }] }) };
    const dt = { types: Object.keys(data), getData: (t) => data[t] ?? "" };
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    drop.dataTransfer = dt;
    q(".stage").dispatchEvent(drop);
    expect(h.doc().body?.url).toBe(HULL);
    await settle();
    [...element.querySelectorAll("button")].find((b) => b.textContent === "Fit domain").click();
    const { min, max } = h.doc().domain;
    expect(min[0]).toBeLessThan(0);
    expect(max[0]).toBeGreaterThan(10);
    expect(min[2]).toBe(-4); // heights kept
  });

  it("paints the linked body's outline and a masked heatmap without errors", async () => {
    registerExact();
    const calls = {};
    const ctx = new Proxy(
      {},
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "createImageData") return (w, hh) => ({ data: new Uint8ClampedArray(w * hh * 4) });
          if (k === "getImageData") return () => ({ data: Uint8ClampedArray.from([10, 20, 30, 255]) });
          if (k === "measureText") return () => ({ width: 10 });
          return () => {
            calls[k] = (calls[k] ?? 0) + 1;
          };
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      },
    );
    const proto = HTMLCanvasElement.prototype;
    const orig = proto.getContext;
    proto.getContext = () => ctx;
    const errors = [];
    const onError = (e) => errors.push(e.error ?? e.message);
    window.addEventListener("error", onError);
    try {
      const d = flowDoc();
      d.elements = {};
      d.freestream.headingDeg = 180;
      d.body = { url: HULL, plane: { kind: "waterline" }, model: "waterplane-2d", panels: 60 };
      cleanup = Tool(fakeHandle("automerge:flow", d), element);
      await settle(200);
    } finally {
      proto.getContext = orig;
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([]);
    expect(calls.setLineDash).toBeGreaterThanOrEqual(1); // only the body outline sets a dash
    expect(calls.putImageData).toBeGreaterThan(0);
    expect(calls.lineTo).toBeGreaterThan(100);
  });
});
