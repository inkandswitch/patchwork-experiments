// A url that names no document must never reach a stored layout, because the
// repo throws on it from inside the hooks that render its tab — which took the
// whole frame down, and again on every reload. Each shape a bad url can take
// in a leaf (lone view, showing tab, hidden tab, every tab) is repaired the
// same way in a plain copy and in place on a real Automerge document, and the
// write paths drop one before it's stored.

import { next as Automerge } from "@automerge/automerge";
import { generateAutomergeUrl } from "@automerge/automerge-repo";
import { describe, expect, it } from "vitest";
import {
  leafTabs,
  navigateLeafIn,
  repairLayout,
  repairLayoutIn,
  stackViewIn,
} from "./layout";
import type { LayoutNode, LeafNode, PanelView, TilingLayoutDoc } from "./types";

const a = generateAutomergeUrl();
const b = generateAutomergeUrl();
const bad = "automerge:not-a-document" as PanelView["url"];

const leaf = (view: PanelView, stack?: PanelView[], stackAt?: number): LeafNode => ({
  kind: "leaf",
  id: "leaf",
  view,
  ...(stack ? { stack, stackAt } : {}),
});

const inSplit = (node: LeafNode): LayoutNode => ({
  kind: "split",
  id: "split",
  direction: "horizontal",
  sizes: [30, 70],
  children: [{ kind: "leaf", id: "folder", view: { role: "root-folder" } }, node],
});

const tabsOf = (layout: LayoutNode) => {
  const node = layout.kind === "split" ? layout.children[1] : layout;
  if (node.kind !== "leaf") throw new Error("expected a leaf");
  const { tabs, active } = leafTabs(node);
  return { urls: tabs.map((t) => t.url ?? null), shown: tabs[active].url ?? null, node };
};

const cases: {
  name: string;
  before: LeafNode;
  urls: (string | null)[];
  shown: string | null;
}[] = [
  {
    name: "a lone bad view becomes an empty frame, tool and all",
    before: leaf({ url: bad, toolId: "markdown" }),
    urls: [null],
    shown: null,
  },
  {
    name: "a bad tab behind the showing one is dropped",
    before: leaf({ url: a }, [{ url: bad }, { url: b }], 1),
    urls: [a, b],
    shown: a,
  },
  {
    name: "a bad showing tab gives way to the first document",
    before: leaf({ url: bad }, [{ url: a }, { url: b }], 1),
    urls: [a, b],
    shown: a,
  },
  {
    name: "a stack of nothing but bad tabs becomes an empty frame",
    before: leaf({ url: bad }, [{ url: bad }], 0),
    urls: [null],
    shown: null,
  },
];

describe("repairing a layout with a url that names no document", () => {
  for (const { name, before, urls, shown } of cases) {
    it(`${name} (copy)`, () => {
      const raw = inSplit(before);
      const repaired = repairLayout(raw);
      expect(tabsOf(repaired)).toMatchObject({ urls, shown });
      if (!shown) expect(tabsOf(repaired).node.view).toEqual({});
      // The folder pane beside it is untouched.
      expect(repaired.kind === "split" && repaired.children[0]).toMatchObject({
        view: { role: "root-folder" },
      });
    });

    it(`${name} (in place, on an Automerge doc)`, () => {
      let doc = Automerge.from<TilingLayoutDoc>({ layout: inSplit(before) });
      doc = Automerge.change(doc, repairLayoutIn);
      const layout = doc.layout!;
      expect(tabsOf(layout)).toMatchObject({ urls, shown });
      // Same answer as the copy, so what renders is what gets stored.
      expect(JSON.parse(JSON.stringify(layout))).toEqual(
        JSON.parse(JSON.stringify(repairLayout(inSplit(before)))),
      );
    });
  }

  it("leaves a sound layout as the very same object", () => {
    const raw = inSplit(leaf({ url: a, toolId: "markdown" }, [{ url: b }], 0));
    expect(repairLayout(raw)).toBe(raw);
    expect(repairLayout(null)).toBe(null);
  });
});

describe("writing a url that names no document", () => {
  it("won't stack it", () => {
    const doc: TilingLayoutDoc = { layout: inSplit(leaf({ url: a })) };
    stackViewIn(doc, "leaf", { url: bad });
    expect(tabsOf(doc.layout!).urls).toEqual([a]);
  });

  it("navigating to it empties the panel instead of storing it", () => {
    const doc: TilingLayoutDoc = { layout: inSplit(leaf({ url: a, toolId: "x" })) };
    navigateLeafIn(doc, "leaf", { url: bad, toolId: "x" });
    expect(tabsOf(doc.layout!).node.view).toEqual({});
  });
});
