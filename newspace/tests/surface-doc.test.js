import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { surfaceDoc } from "../src/surface-doc.js";
import { docHandleFromOpstream } from "../src/sketchy-streams.js";
import { Opstream } from "../src/opstreams.js";

describe("surfaceDoc — the layout reactivity seam", () => {
  it("drives a fine-grained Solid store from an OPSTREAM-backed handle", () => {
    createRoot((dispose) => {
      const stream = new Opstream({ items: [{ id: "a" }], layout: { tools: ["pen"] } });
      const handle = docHandleFromOpstream(stream, "automerge:X");
      const store = surfaceDoc(handle);
      // reads the current doc
      expect(store.items).toEqual([{ id: "a" }]);
      expect(store.layout.tools).toEqual(["pen"]);
      // a remote op on the opstream updates the store reactively (the canvas would re-render)
      stream.apply({ type: "snapshot", value: { items: [{ id: "a" }, { id: "b" }], layout: { tools: ["pen", "eraser"] } } });
      expect(store.items.length).toBe(2);
      expect(store.layout.tools).toEqual(["pen", "eraser"]);
      dispose();
    });
  });

  it("a WRITE through the adapter handle reaches the underlying opstream", () => {
    createRoot((dispose) => {
      const stream = new Opstream({ items: [] });
      const handle = docHandleFromOpstream(stream, "automerge:Y");
      const store = surfaceDoc(handle);
      // the canvas writes the way it always does — handle.change(fn)
      handle.change((d) => { d.items.push({ id: "z" }); });
      expect(stream.value.items).toEqual([{ id: "z" }]); // landed on the opstream
      expect(store.items).toEqual([{ id: "z" }]);          // and the store reflects it
      dispose();
    });
  });
});
