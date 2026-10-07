import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Tool from "./tool.js";
import { FlowFieldDatatype } from "./datatype.js";

/** Just enough DocHandle: doc(), change(fn), on/off("change"). */
function fakeHandle(initial) {
  let doc = initial;
  const listeners = new Set();
  return {
    url: "automerge:fake",
    doc: () => doc,
    change(fn) {
      const next = structuredClone(doc);
      fn(next);
      doc = next;
      for (const l of listeners) l({ doc });
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

const seeded = () => {
  const d = {};
  FlowFieldDatatype.init(d);
  return d;
};

let element;
let cleanup;
beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  element.remove();
});

const change = (input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("flow-field tool", () => {
  it("mounts, lists the elements and cleans up after itself", () => {
    const h = fakeHandle(seeded());
    cleanup = Tool(h, element);
    expect(element.querySelector(".flow-field canvas.main")).toBeTruthy();
    const items = [...element.querySelectorAll(".elements li")].map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items.join(" ")).toMatch(/Source/);
    expect(items.join(" ")).toMatch(/Sink/);
    expect(h.listeners.size).toBe(1);
    cleanup();
    cleanup = null;
    expect(element.children).toHaveLength(0);
    expect(h.listeners.size).toBe(0);
  });

  it("edits the freestream from the panel", () => {
    const h = fakeHandle(seeded());
    cleanup = Tool(h, element);
    change(element.querySelector('[aria-label="Freestream speed"]'), 3.5);
    change(element.querySelector('[aria-label="Freestream heading"]'), -90);
    expect(h.doc().freestream).toEqual({ speed: 3.5, headingDeg: 270 });
  });

  it("selects from the list and edits kind, strength and position", () => {
    const h = fakeHandle(seeded());
    cleanup = Tool(h, element);
    const bow = [...element.querySelectorAll(".elements li")].find((li) => /Source/.test(li.textContent));
    bow.click();
    const strength = element.querySelector('[aria-label="Strength"]');
    expect(strength.value).toBe("12.4");
    change(strength, 20);
    expect(h.doc().elements.bow.strength).toBe(20);
    change(element.querySelector('[aria-label="Position y"]'), 1.5);
    expect(h.doc().elements.bow.position).toEqual([0.7, 1.5, 0]);
    const kind = element.querySelector('[aria-label="Kind"]');
    kind.value = "doublet";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.doc().elements.bow.kind).toBe("doublet");
    // the strength input survives the rebuild and still points at the same element
    change(element.querySelector('[aria-label="Strength"]'), 7);
    expect(h.doc().elements.bow.strength).toBe(7);
  });

  it("adds an element where you click after arming a kind, and deletes it with the key", () => {
    const h = fakeHandle(seeded());
    cleanup = Tool(h, element);
    element.querySelector('button[data-kind="vortex-line"]').click();
    expect(element.querySelector('button[data-kind="vortex-line"]').hasAttribute("data-armed")).toBe(true);
    const canvas = element.querySelector("canvas.main");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 300, clientY: 200, bubbles: true }));
    const ids = Object.keys(h.doc().elements);
    expect(ids).toHaveLength(3);
    const id = ids.find((k) => k.startsWith("vortex"));
    const e = h.doc().elements[id];
    expect(e.kind).toBe("vortex-line");
    expect(e.strength).toBeGreaterThan(0);
    expect(e.position.every(Number.isFinite)).toBe(true);
    expect(element.querySelector('button[data-kind="vortex-line"]').hasAttribute("data-armed")).toBe(false);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    expect(Object.keys(h.doc().elements)).toHaveLength(2);
  });

  it("loads a preset", () => {
    const h = fakeHandle(seeded());
    cleanup = Tool(h, element);
    const sel = element.querySelector('[aria-label="Load a preset"]');
    sel.value = "catamaran";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(Object.keys(h.doc().elements)).toHaveLength(4);
    expect(h.doc().domain).toEqual(seeded().domain);
  });

  it("follows remote changes, and drops a selection whose element vanished", () => {
    const h = fakeHandle(seeded());
    cleanup = Tool(h, element);
    [...element.querySelectorAll(".elements li")][0].click();
    expect(element.querySelector('[aria-label="Strength"]')).toBeTruthy();
    h.change((d) => {
      delete d.elements.bow;
      d.freestream.speed = 4;
    });
    expect(element.querySelectorAll(".elements li")).toHaveLength(1);
    expect(element.querySelector('[aria-label="Freestream speed"]').value).toBe("4");
    expect(element.querySelector('[aria-label="Strength"]')).toBeNull();
  });

  it("tolerates a doc with nothing in it", () => {
    const h = fakeHandle({});
    cleanup = Tool(h, element);
    change(element.querySelector('[aria-label="Freestream speed"]'), 1);
    expect(h.doc().freestream.speed).toBe(1);
    change(element.querySelector('[aria-label="Domain max x"]'), 30);
    expect(h.doc().domain.max[0]).toBe(30);
  });

  it("paints the whole view: heatmap, streamlines and the element markers", async () => {
    // happy-dom has no 2D context, so paint() normally returns early; stand in a
    // recording one so the drawing code actually runs (a throw half-way through
    // paint() used to leave the view with a heatmap and nothing else on it).
    const calls = {};
    const ctx = new Proxy(
      {},
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
          if (k === "getImageData") return () => ({ data: Uint8ClampedArray.from([10, 20, 30, 255]) });
          if (k === "measureText") return () => ({ width: 10 });
          return (...a) => {
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
      cleanup = Tool(fakeHandle(seeded()), element);
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      proto.getContext = orig;
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([]);
    expect(calls.putImageData).toBeGreaterThan(0); // heatmap
    expect(calls.lineTo).toBeGreaterThan(50); // streamlines
    expect(calls.arc).toBeGreaterThanOrEqual(2); // a marker per element, drawn after the streamlines
  });

  it("the height readout follows the slider while it is dragged", () => {
    cleanup = Tool(fakeHandle(seeded()), element);
    const range = element.querySelector('input[aria-label="Slice height"]');
    const label = range.nextElementSibling;
    range.value = "0.5";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(label.textContent).toMatch(/z = 0\.5/);
  });
});

