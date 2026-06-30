import { describe, it, expect } from "vitest";
import {
  firstMatchingInletForOutlet,
  outletFeedsInlet,
  descriptorsFeeding,
  firstMatchingInlet,
  usedContextOutlets,
  portWiring,
} from "./wire.js";

// ---------------------------------------------------------------------------
// firstMatchingInletForOutlet — the wire's core: match a SOURCE outlet to a
// destination inlet by the source's DECLARED outlet type, falling back to the
// source's live VALUE when that type is unknown (null). This is what makes a
// bang→bang connection work even though a bang's value looks like plain json.
// ---------------------------------------------------------------------------
describe("firstMatchingInletForOutlet", () => {
  const banged = [
    { name: "trigger", type: "bang" },
    { name: "content", type: "text" },
  ];

  it("matches by declared outlet type — bang→bang even though value is json-ish", () => {
    // value is an object (would be "json"), but the outlet declares type "bang"
    const inlet = firstMatchingInletForOutlet(banged, "bang", { fired: true });
    expect(inlet.name).toBe("trigger");
  });

  it("a typed outlet does NOT match an unrelated typed inlet", () => {
    // outlet is "bang"; the only inlets are text + a number — neither is bang/json
    const defs = [
      { name: "content", type: "text" },
      { name: "count", type: "number" },
    ];
    expect(firstMatchingInletForOutlet(defs, "bang", 1)).toBe(null);
  });

  it("a json/untyped inlet accepts a typed outlet (permissive)", () => {
    const defs = [
      { name: "anything", type: "json" },
      { name: "blank" }, // untyped
    ];
    // first json inlet wins
    expect(firstMatchingInletForOutlet(defs, "bang", 1).name).toBe("anything");
    // an untyped inlet alone also accepts
    expect(firstMatchingInletForOutlet([{ name: "blank" }], "bang", 1).name).toBe("blank");
  });

  it("a json/untyped OUTLET feeds any typed inlet", () => {
    const defs = [{ name: "content", type: "text" }];
    expect(firstMatchingInletForOutlet(defs, "json", "hi").name).toBe("content");
  });

  it("prefers a REQUIRED matching inlet over an earlier optional one", () => {
    const defs = [
      { name: "optionalText", type: "text" },
      { name: "requiredText", type: "text", required: true },
    ];
    expect(firstMatchingInletForOutlet(defs, "text", "hi").name).toBe("requiredText");
  });

  it("falls back to VALUE matching when the outlet type is null", () => {
    // null outletType → delegate to firstMatchingInlet by value
    const defs = [
      { name: "pixels", type: "bytes" },
      { name: "content", type: "text" },
    ];
    expect(firstMatchingInletForOutlet(defs, null, "hi").name).toBe("content");
    expect(firstMatchingInletForOutlet(defs, null, Uint8Array.from([1])).name).toBe("pixels");
  });

  it("falls back to VALUE matching when the outlet type is undefined", () => {
    const defs = [{ name: "content", type: "text" }];
    expect(firstMatchingInletForOutlet(defs, undefined, "hi").name).toBe("content");
    // a value that doesn't fit any typed inlet → null (via the value path)
    expect(firstMatchingInletForOutlet(defs, undefined, Uint8Array.from([1]))).toBe(null);
  });

  it("value-fallback still prefers a required inlet (delegates to firstMatchingInlet)", () => {
    const defs = [
      { name: "optionalJson", type: "json" },
      { name: "requiredJson", type: "json", required: true },
    ];
    // both accept "hi" by type tag; required wins
    expect(firstMatchingInletForOutlet(defs, null, "hi").name).toBe("requiredJson");
  });

  it("returns null for empty / missing inlet defs", () => {
    expect(firstMatchingInletForOutlet([], "bang", 1)).toBe(null);
    expect(firstMatchingInletForOutlet(undefined, "bang", 1)).toBe(null);
    // null outletType with no defs still null (value path over empty list)
    expect(firstMatchingInletForOutlet([], null, "hi")).toBe(null);
    expect(firstMatchingInletForOutlet(undefined, null, "hi")).toBe(null);
  });

  it("ignores the value entirely when the outlet type is known", () => {
    // even a wildly mismatched value can't break a type-tag match
    const defs = [{ name: "trigger", type: "bang" }];
    expect(firstMatchingInletForOutlet(defs, "bang", undefined).name).toBe("trigger");
    expect(firstMatchingInletForOutlet(defs, "bang", Uint8Array.from([9])).name).toBe("trigger");
  });
});

// ---------------------------------------------------------------------------
// outletFeedsInlet — edge cases the sibling didn't cover (null outlet, both
// untyped, exact type match symmetry).
// ---------------------------------------------------------------------------
describe("outletFeedsInlet edge cases", () => {
  it("a null/undefined outlet never feeds anything", () => {
    expect(outletFeedsInlet(null, { type: "json" })).toBe(false);
    expect(outletFeedsInlet(undefined, {})).toBe(false);
  });

  it("untyped outlet feeds untyped inlet", () => {
    expect(outletFeedsInlet({}, {})).toBe(true);
  });

  it("untyped outlet (type null) feeds a typed inlet", () => {
    expect(outletFeedsInlet({ type: null }, { type: "text" })).toBe(true);
  });

  it("a missing inlet is treated as untyped and accepts a typed outlet", () => {
    expect(outletFeedsInlet({ type: "text" }, undefined)).toBe(true);
    expect(outletFeedsInlet({ type: "text" }, null)).toBe(true);
  });

  it("matching semantic types feed each other; mismatched do not", () => {
    expect(outletFeedsInlet({ type: "bang" }, { type: "bang" })).toBe(true);
    expect(outletFeedsInlet({ type: "bang" }, { type: "text" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// descriptorsFeeding — edge cases (multiple outlets per descriptor, missing
// outlets array, empty descriptor list).
// ---------------------------------------------------------------------------
describe("descriptorsFeeding edge cases", () => {
  it("a descriptor with MULTIPLE outlets is included if ANY one feeds the inlet", () => {
    const ds = [
      { id: "multi", outlets: [{ type: "bytes" }, { type: "text" }] },
      { id: "neither", outlets: [{ type: "bytes" }, { type: "number" }] },
    ];
    expect(descriptorsFeeding(ds, { type: "text" }).map((d) => d.id)).toEqual(["multi"]);
  });

  it("descriptors with no outlets array are skipped, not crashed", () => {
    const ds = [{ id: "noOutlets" }, { id: "txt", outlets: [{ type: "text" }] }];
    expect(descriptorsFeeding(ds, { type: "text" }).map((d) => d.id)).toEqual(["txt"]);
  });

  it("an untyped inlet is fed by every descriptor that has any outlet", () => {
    const ds = [
      { id: "a", outlets: [{ type: "number" }] },
      { id: "b", outlets: [{ type: "text" }] },
      { id: "empty", outlets: [] },
    ];
    expect(descriptorsFeeding(ds, {}).map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("tolerates a null/empty descriptor list", () => {
    expect(descriptorsFeeding(null, { type: "text" })).toEqual([]);
    expect(descriptorsFeeding(undefined, { type: "text" })).toEqual([]);
    expect(descriptorsFeeding([], { type: "text" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// firstMatchingInlet — value edge cases the sibling didn't probe (bytes via a
// non-required inlet, missing inlets list, no match).
// ---------------------------------------------------------------------------
describe("firstMatchingInlet edge cases", () => {
  it("returns a non-required inlet when no required one matches", () => {
    const ed = { inlets: [{ name: "pixels", type: "bytes" }] };
    expect(firstMatchingInlet(ed, Uint8Array.from([1])).name).toBe("pixels");
  });

  it("tolerates an editor with no inlets array", () => {
    expect(firstMatchingInlet({}, "hi")).toBe(null);
  });

  it("returns null when nothing accepts the value", () => {
    const ed = { inlets: [{ name: "content", type: "text" }] };
    expect(firstMatchingInlet(ed, Uint8Array.from([1]))).toBe(null);
  });

  it("a json inlet accepts a Uint8Array value (lenient type tag)", () => {
    const ed = { inlets: [{ name: "doc", type: "json" }] };
    expect(firstMatchingInlet(ed, Uint8Array.from([1])).name).toBe("doc");
  });
});

// ---------------------------------------------------------------------------
// portWiring — edge cases beyond the happy path (null input, automerge as the
// default kind when kind is unrecognised).
// ---------------------------------------------------------------------------
describe("portWiring edge cases", () => {
  it("returns null for a null/undefined port", () => {
    expect(portWiring(null)).toBe(null);
    expect(portWiring(undefined)).toBe(null);
  });

  it("treats an unknown kind as the automerge (url/path) default", () => {
    // any non context/peer/node port wires as {url, path}
    expect(portWiring({ kind: "mystery", url: "automerge:z", path: ["a", "b"] })).toEqual({
      url: "automerge:z",
      path: ["a", "b"],
    });
  });

  it("a context wiring carries only the name", () => {
    expect(portWiring({ kind: "context", name: "camera" })).toEqual({ context: "camera" });
  });
});

// ---------------------------------------------------------------------------
// usedContextOutlets — edge cases beyond the sibling (multiple inlets on one
// editor, an editor inlets object mixing context + non-context wirings, a
// float with no source).
// ---------------------------------------------------------------------------
describe("usedContextOutlets edge cases", () => {
  it("collects multiple distinct contexts from one editor's inlets", () => {
    const items = [
      { kind: "editor", inlets: { a: { context: "camera" }, b: { context: "pointer" } } },
    ];
    expect([...usedContextOutlets(items, [])].sort()).toEqual(["camera", "pointer"]);
  });

  it("picks the context wirings out of a mixed inlets object", () => {
    const items = [
      {
        kind: "editor",
        inlets: {
          a: { context: "selection" },
          b: { url: "automerge:1", path: [] }, // ignored
          c: { peer: "contact:x", part: "v" }, // ignored
        },
      },
    ];
    expect([...usedContextOutlets(items, [])]).toEqual(["selection"]);
  });

  it("ignores floats with no source or a source without context", () => {
    const floats = [
      { id: "f1" }, // no source
      { id: "f2", source: {} }, // source, no context
      { id: "f3", source: { context: "pointer" } },
    ];
    expect([...usedContextOutlets([], floats)]).toEqual(["pointer"]);
  });

  it("tolerates null entries in the items list", () => {
    const items = [null, { kind: "editor", inlets: { a: { context: "camera" } } }];
    expect([...usedContextOutlets(items, [])]).toEqual(["camera"]);
  });
});
