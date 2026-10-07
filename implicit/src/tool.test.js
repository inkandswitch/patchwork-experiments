import { afterEach, describe, expect, it, vi } from "vitest";
import * as A from "@automerge/automerge";
import Tool from "./tool.js";
import { ImplicitSurfaceDatatype } from "./datatype.js";
import { EXAMPLES } from "./examples.js";

/** A DocHandle stand-in over a real Automerge doc (automerge-codemirror needs one). */
function fakeHandle(init) {
  let doc = A.change(A.init(), (d) => {
    ImplicitSurfaceDatatype.init(d);
    init?.(d);
  });
  const listeners = new Set();
  return {
    url: "automerge:test",
    isReady: () => true,
    doc: () => doc,
    change(fn) {
      const before = A.getHeads(doc);
      doc = A.change(doc, fn);
      const patches = A.diff(doc, before, A.getHeads(doc));
      for (const l of [...listeners]) l({ doc, patches, patchInfo: { before, after: doc } });
    },
    on(ev, l) {
      if (ev === "change") listeners.add(l);
    },
    off(ev, l) {
      if (ev === "change") listeners.delete(l);
    },
    listenerCount: () => listeners.size,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 200));

let cleanup = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

describe("implicit-surface tool", () => {
  it("mounts an editor with the source, compiles it, and says when WebGL2 is missing", async () => {
    const handle = fakeHandle();
    const el = document.createElement("div");
    document.body.append(el);
    cleanup = Tool(handle, el);
    const root = el.querySelector(".implicit-surface");
    expect(root).toBeTruthy();
    expect(document.getElementById("implicit-surface-styles")).toBeTruthy();
    expect(root.querySelector(".cm-content").textContent).toContain("gyroid(100mm, 8mm)");
    await settle();
    // happy-dom has no WebGL2, so the tool explains and still compiles
    expect(root.querySelector(".message").hidden).toBe(false);
    expect(root.querySelector(".status").textContent).toMatch(/\d+ operations/);
    expect(root.querySelectorAll("[data-mode]")).toHaveLength(5);
    expect(root.querySelectorAll(".examples option")).toHaveLength(EXAMPLES.length + 1);
  });

  it("shows a positioned error for a broken source and underlines it", async () => {
    const handle = fakeHandle();
    const el = document.createElement("div");
    cleanup = Tool(handle, el);
    handle.change((d) => A.updateText(d, ["source"], "let r = 1\nsphre(r)"));
    await settle();
    const status = el.querySelector(".status");
    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toMatch(/^Line 2, col 1: Unknown function "sphre"\. Did you mean sphere/);
    expect(el.querySelector(".isf-diag-error")?.textContent).toBe("sphre");
  });

  it("highlights with the language's own tokenizer", () => {
    const handle = fakeHandle((d) => {
      d.source = "let r = 5mm // note\nsphere(r * x)";
    });
    const el = document.createElement("div");
    cleanup = Tool(handle, el);
    const text = (cls) => [...el.querySelectorAll(`.${cls}`)].map((n) => n.textContent);
    expect(text("isf-tok-kw")).toEqual(["let"]);
    expect(text("isf-tok-def")).toEqual(["r"]);
    expect(text("isf-tok-unit")).toEqual(["mm"]);
    expect(text("isf-tok-fn")).toEqual(["sphere"]);
    expect(text("isf-tok-point")).toEqual(["x"]);
    expect(text("isf-tok-comment")).toEqual(["// note"]);
  });

  it("loads an example into the doc (source, bounds and a default title)", async () => {
    const handle = fakeHandle();
    const el = document.createElement("div");
    cleanup = Tool(handle, el);
    const select = el.querySelector(".examples");
    select.value = "chain";
    select.dispatchEvent(new Event("change"));
    const doc = handle.doc();
    const chain = EXAMPLES.find((e) => e.id === "chain");
    expect(doc.source).toBe(chain.source);
    expect(doc.bounds.max).toEqual(chain.bounds.max);
    expect(doc.title).toBe("Chain links");
  });

  it("asks before replacing an edited source", () => {
    const handle = fakeHandle((d) => {
      d.source = "sphere(0.1) // mine";
      d.title = "Mine";
    });
    const el = document.createElement("div");
    cleanup = Tool(handle, el);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const select = el.querySelector(".examples");
    select.value = "vase";
    select.dispatchEvent(new Event("change"));
    expect(confirm).toHaveBeenCalled();
    expect(handle.doc().source).toBe("sphere(0.1) // mine");
    confirm.mockRestore();
  });

  it("edits bounds and notes through the doc", async () => {
    const handle = fakeHandle();
    const el = document.createElement("div");
    cleanup = Tool(handle, el);
    const maxY = el.querySelector('[data-bound="max"][data-axis="1"]');
    maxY.value = "0.4";
    maxY.dispatchEvent(new Event("change"));
    expect(handle.doc().bounds.max[1]).toBe(0.4);
    const notes = el.querySelector(".notes");
    notes.value = "print in PETG";
    notes.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 300));
    expect(handle.doc().notes).toBe("print in PETG");
    // an invalid box is explained, not applied to the preview
    const minY = el.querySelector('[data-bound="min"][data-axis="1"]');
    minY.value = "0.5";
    minY.dispatchEvent(new Event("change"));
    expect(el.querySelector(".bounds-note").dataset.state).toBe("error");
  });

  it("writes pending notes at once on blur and on unmount", () => {
    const handle = fakeHandle();
    const el = document.createElement("div");
    const dispose = Tool(handle, el);
    const notes = el.querySelector(".notes");
    notes.value = "print in";
    notes.dispatchEvent(new Event("input"));
    notes.dispatchEvent(new Event("blur"));
    expect(handle.doc().notes).toBe("print in");
    notes.value = "print in PETG";
    notes.dispatchEvent(new Event("input"));
    expect(handle.doc().notes).toBe("print in");
    dispose(); // well inside the 250 ms debounce
    expect(handle.doc().notes).toBe("print in PETG");
  });

  it("repairs a doc with no source text instead of crashing", () => {
    const handle = fakeHandle((d) => {
      delete d.source;
    });
    const el = document.createElement("div");
    cleanup = Tool(handle, el);
    expect(handle.doc().source).toBe("");
    expect(el.querySelector(".cm-content")).toBeTruthy();
  });

  it("cleans up everything it added", () => {
    const handle = fakeHandle();
    const el = document.createElement("div");
    document.body.append(el);
    const dispose = Tool(handle, el);
    expect(handle.listenerCount()).toBeGreaterThan(0);
    dispose();
    expect(el.children).toHaveLength(0);
    expect(handle.listenerCount()).toBe(0);
    expect(document.getElementById("implicit-surface-styles")).toBeNull();
  });
});
