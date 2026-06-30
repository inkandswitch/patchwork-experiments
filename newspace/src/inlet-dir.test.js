import { describe, it, expect } from "vitest";
import { inletProxy } from "./brush/items/editor-item.jsx";
import { Opstream } from "./opstreams.js";

// A writable source whose value we can drive + observe write-backs on.
function writableSource(initial) {
  const s = new Opstream(initial);
  return s;
}

describe("inletProxy — per-wire flow direction", () => {
  it("'both' (default): reads the source forward AND writes back", () => {
    const src = writableSource("a");
    const p = inletProxy();
    p.setBacking(src);
    const seen = [];
    p.connect((op) => seen.push(op));
    expect(p.value).toBe("a");

    // forward: source change reaches the inlet
    src.apply({ type: "snapshot", value: "b" });
    expect(p.value).toBe("b");
    expect(seen.at(-1)).toEqual({ type: "snapshot", value: "b" });

    // back: writing the inlet reaches the source (apply is exposed)
    expect(typeof p.apply).toBe("function");
    p.apply({ type: "snapshot", value: "c" });
    expect(src.value).toBe("c");
  });

  it("'fwd': read-only — source drives the inlet, write-back is suppressed", () => {
    const src = writableSource("a");
    const p = inletProxy();
    p.setBacking(src);
    p.setDir("fwd");

    // forward still flows
    src.apply({ type: "snapshot", value: "b" });
    expect(p.value).toBe("b");
    // but there is NO apply (can't write back)
    expect(p.apply).toBeUndefined();
  });

  it("'back': write-only — the inlet drives the source; source ops don't clobber the read side", () => {
    const src = writableSource("source-val");
    const p = inletProxy();
    p.setBacking(src);
    const seen = [];
    p.connect((op) => seen.push(op));
    seen.length = 0;
    p.setDir("back");

    // entering "back" seeds the buffer from the source so we don't blank it
    expect(p.value).toBe("source-val");

    // a later SOURCE change must NOT reach the inlet's read side
    src.apply({ type: "snapshot", value: "remote-change" });
    expect(p.value).toBe("source-val");

    // writing the inlet DOES reach the source (and updates our own read side)
    p.apply({ type: "snapshot", value: "i-win" });
    expect(src.value).toBe("i-win");
    expect(p.value).toBe("i-win");
  });

  it("read-only source (no apply) never exposes apply, regardless of dir", () => {
    // a plain object stream with connect/value but no apply
    let cb = null;
    const ro = { value: 1, connect(c) { cb = c; c({ type: "snapshot", value: 1 }); return () => {}; } };
    const p = inletProxy();
    p.setBacking(ro);
    expect(p.apply).toBeUndefined();
    p.setDir("back");
    expect(p.apply).toBeUndefined();
  });
});
