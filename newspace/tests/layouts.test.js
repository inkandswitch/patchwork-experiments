// Layouts — a folder rendered through a lens. These tests exercise the real
// `sketchy:layout` plugin registry (via @inkandswitch/patchwork-plugins) plus the
// pure complement helpers. The registry is process-global module state, so each
// test registers plugins under unique ids and asserts by membership rather than
// exact whole-list equality, keeping cases order/accumulation independent.
import { describe, it, expect } from "vitest";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import {
  listLayouts,
  layoutsFor,
  complementSummary,
  complementBanner,
} from "../src/layouts.js";

// register a batch of sketchy:layout descriptors; returns their ids
function register(descriptors) {
  registerPlugins(descriptors.map((d) => ({ type: "sketchy:layout", ...d })));
  return descriptors.map((d) => d.id);
}

const ns = (() => {
  let n = 0;
  return (s) => `lt-test-${s}-${n++}`;
})();

describe("listLayouts", () => {
  it("returns an array", () => {
    expect(Array.isArray(listLayouts())).toBe(true);
  });

  it("includes a registered layout descriptor (by id) with its fields intact", () => {
    const id = ns("solo");
    register([{ id, name: "Solo", supportedDatatypes: ["folder"] }]);
    const found = listLayouts().find((l) => l.id === id);
    expect(found).toBeTruthy();
    expect(found.name).toBe("Solo");
    expect(found.supportedDatatypes).toEqual(["folder"]);
  });

  it("surfaces every registered layout", () => {
    const a = ns("a");
    const b = ns("b");
    register([
      { id: a, name: "A" },
      { id: b, name: "B" },
    ]);
    const ids = listLayouts().map((l) => l.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
  });
});

describe("layoutsFor", () => {
  it("returns a layout that explicitly lists the requested datatype", () => {
    const id = ns("folder-only");
    const type = ns("dt");
    register([{ id, name: "F", supportedDatatypes: [type] }]);
    expect(layoutsFor(type).map((l) => l.id)).toContain(id);
  });

  it("excludes a layout whose supportedDatatypes do NOT include the type", () => {
    const id = ns("other-only");
    register([{ id, name: "O", supportedDatatypes: ["something-else"] }]);
    expect(layoutsFor(ns("mismatch")).map((l) => l.id)).not.toContain(id);
  });

  it("includes a wildcard ('*') layout for any type", () => {
    const id = ns("wild");
    register([{ id, name: "W", supportedDatatypes: ["*"] }]);
    expect(layoutsFor(ns("anything")).map((l) => l.id)).toContain(id);
    expect(layoutsFor("folder").map((l) => l.id)).toContain(id);
  });

  it("includes a layout with NO supportedDatatypes field (matches all)", () => {
    const id = ns("nodatatypes");
    register([{ id, name: "Any" }]);
    expect(layoutsFor(ns("whatever")).map((l) => l.id)).toContain(id);
    expect(layoutsFor("folder").map((l) => l.id)).toContain(id);
  });

  it("matches the right subset across mixed descriptors", () => {
    const folderId = ns("folder");
    const wildId = ns("wild");
    const anyId = ns("any");
    const specialId = ns("special");
    const target = ns("target-dt");
    register([
      { id: folderId, supportedDatatypes: ["folder"] },
      { id: wildId, supportedDatatypes: ["*"] },
      { id: anyId },
      { id: specialId, supportedDatatypes: [target] },
    ]);

    const forTarget = layoutsFor(target).map((l) => l.id);
    expect(forTarget).toContain(wildId); // wildcard
    expect(forTarget).toContain(anyId); // unconstrained
    expect(forTarget).toContain(specialId); // explicit match
    expect(forTarget).not.toContain(folderId); // folder-only, not target

    const forFolder = layoutsFor("folder").map((l) => l.id);
    expect(forFolder).toContain(folderId);
    expect(forFolder).toContain(wildId);
    expect(forFolder).toContain(anyId);
    expect(forFolder).not.toContain(specialId);
  });

  it("a layout supporting multiple datatypes matches each of them", () => {
    const id = ns("multi");
    const t1 = ns("t1");
    const t2 = ns("t2");
    register([{ id, supportedDatatypes: [t1, t2] }]);
    expect(layoutsFor(t1).map((l) => l.id)).toContain(id);
    expect(layoutsFor(t2).map((l) => l.id)).toContain(id);
    expect(layoutsFor(ns("t3")).map((l) => l.id)).not.toContain(id);
  });

  it("always returns an array", () => {
    expect(Array.isArray(layoutsFor("folder"))).toBe(true);
    expect(Array.isArray(layoutsFor(undefined))).toBe(true);
  });
});

describe("complementSummary", () => {
  it("reports an empty complement for null/undefined docs", () => {
    const s = complementSummary({}, null);
    expect(s.has).toBe(false);
    expect(s.itemCount).toBe(0);
    expect(s.positionedCount).toBe(0);
    expect(s.positioned).toBeInstanceOf(Set);
    expect(s.positioned.size).toBe(0);
  });

  it("treats a complement with an empty items array as empty", () => {
    const s = complementSummary({}, { items: [] });
    expect(s.has).toBe(false);
    expect(s.itemCount).toBe(0);
    expect(s.positionedCount).toBe(0);
  });

  it("counts items and collects positioned doc/frame urls", () => {
    const items = [
      { kind: "doc", url: "automerge:doc1" },
      { kind: "frame", url: "automerge:frame1" },
      { kind: "stroke", points: [] }, // not positioned
      { kind: "shape", type: "rect" }, // not positioned
    ];
    const s = complementSummary({}, { items });
    expect(s.has).toBe(true);
    expect(s.itemCount).toBe(4);
    expect(s.positionedCount).toBe(2);
    expect(s.positioned.has("automerge:doc1")).toBe(true);
    expect(s.positioned.has("automerge:frame1")).toBe(true);
  });

  it("ignores doc/frame items missing a url", () => {
    const items = [
      { kind: "doc" }, // no url
      { kind: "frame", url: "" }, // falsy url
      { kind: "doc", url: "automerge:real" },
    ];
    const s = complementSummary({}, { items });
    expect(s.itemCount).toBe(3);
    expect(s.positionedCount).toBe(1);
    expect(s.positioned.has("automerge:real")).toBe(true);
  });

  it("dedupes repeated urls in the positioned set", () => {
    const items = [
      { kind: "doc", url: "automerge:dup" },
      { kind: "frame", url: "automerge:dup" },
    ];
    const s = complementSummary({}, { items });
    expect(s.itemCount).toBe(2);
    expect(s.positionedCount).toBe(1);
  });

  it("skips null/undefined entries without throwing", () => {
    const items = [null, undefined, { kind: "doc", url: "automerge:ok" }];
    const s = complementSummary({}, { items });
    expect(s.itemCount).toBe(3);
    expect(s.positionedCount).toBe(1);
  });

  it("is independent of the folderDoc argument", () => {
    const items = [{ kind: "doc", url: "automerge:x" }];
    const a = complementSummary({ title: "one" }, { items });
    const b = complementSummary(null, { items });
    expect(a.positionedCount).toBe(b.positionedCount);
    expect(a.itemCount).toBe(b.itemCount);
  });
});

describe("complementBanner", () => {
  it("returns an empty string for a missing summary", () => {
    expect(complementBanner(null)).toBe("");
    expect(complementBanner(undefined)).toBe("");
  });

  it("returns an empty string when the summary has nothing", () => {
    expect(complementBanner({ has: false, itemCount: 0, positionedCount: 0 })).toBe("");
  });

  it("includes the positioned and item counts in the banner text", () => {
    const summary = { has: true, itemCount: 7, positionedCount: 3 };
    const banner = complementBanner(summary);
    expect(banner).not.toBe("");
    expect(banner).toContain("3 positioned doc(s)");
    expect(banner).toContain("7 items");
  });

  it("reflects a summary produced by complementSummary", () => {
    const s = complementSummary(
      {},
      { items: [{ kind: "doc", url: "automerge:a" }, { kind: "stroke" }] },
    );
    const banner = complementBanner(s);
    expect(banner).toContain("1 positioned doc(s)");
    expect(banner).toContain("2 items");
  });
});
