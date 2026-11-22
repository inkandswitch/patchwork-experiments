// The preview rule (see `openInLeafIn`): a document opened into a panel is a
// preview; it replaces the showing tab if that's a preview too, and otherwise
// stacks over it; a panel never holds two previews. Every panel shape an open
// can meet is listed below with every mode, on a plain object and on a real
// Automerge document, and each result is checked against the rule's
// invariants as well as its exact tabs.

import { next as Automerge } from "@automerge/automerge";
import { generateAutomergeUrl } from "@automerge/automerge-repo";
import { describe, expect, it } from "vitest";
import {
  keepShowingIn,
  leafTabs,
  moveLeafIn,
  moveTabIn,
  openInLeafIn,
  stackIntoIn,
  type OpenMode,
} from "./layout";
import type { LayoutNode, LeafNode, PanelView, TilingLayoutDoc } from "./types";

const [A, B, C, N] = [0, 1, 2, 3].map(() => generateAutomergeUrl());
const name = new Map([
  [A, "A"],
  [B, "B"],
  [C, "C"],
  [N, "N"],
]);

const leaf = (id: string, tabs: PanelView[], shown = 0): LeafNode => {
  const rest = tabs.filter((_, i) => i !== shown);
  return {
    kind: "leaf",
    id,
    view: tabs[shown],
    ...(rest.length ? { stack: rest, stackAt: shown } : {}),
  };
};

const withFolder = (node: LeafNode): LayoutNode => ({
  kind: "split",
  id: "split",
  direction: "horizontal",
  sizes: [30, 70],
  children: [{ kind: "leaf", id: "folder", view: { role: "root-folder" } }, node],
});

const panel = (layout: LayoutNode, id = "leaf"): LeafNode => {
  const find = (node: LayoutNode): LeafNode | null =>
    node.kind === "leaf"
      ? node.id === id
        ? node
        : null
      : (find(node.children[0]) ?? find(node.children[1]));
  const found = find(layout);
  if (!found) throw new Error(`no panel ${id}`);
  return found;
};

/** A panel's tabs written compactly: names, `*` for a preview, `[…]` showing. */
const describeTabs = (node: LeafNode): string => {
  const { tabs, active } = leafTabs(node);
  return tabs
    .map((tab, i) => {
      const label = tab.url ? `${name.get(tab.url)}${tab.preview ? "*" : ""}` : "∅";
      return i === active ? `[${label}]` : label;
    })
    .join(" ");
};

const kept = (url: string): PanelView => ({ url: url as PanelView["url"] });
const preview = (url: string): PanelView => ({
  url: url as PanelView["url"],
  preview: true,
});

const shapes: { shape: string; panel: LeafNode }[] = [
  { shape: "an empty frame", panel: leaf("leaf", [{}]) },
  { shape: "one kept tab", panel: leaf("leaf", [kept(A)]) },
  { shape: "one preview", panel: leaf("leaf", [preview(A)]) },
  { shape: "a kept tab under a showing preview", panel: leaf("leaf", [kept(A), preview(B)], 1) },
  { shape: "a preview left behind a showing kept tab", panel: leaf("leaf", [preview(A), kept(B)], 1) },
  { shape: "kept tabs either side of a showing one", panel: leaf("leaf", [kept(A), kept(B), kept(C)], 1) },
];

/** What opening N gives, per shape, per mode. */
const expected: Record<string, Record<OpenMode, string>> = {
  "an empty frame": { auto: "[N*]", keep: "[N*]", replace: "[N*]" },
  "one kept tab": { auto: "A [N*]", keep: "A [N*]", replace: "[N*]" },
  "one preview": { auto: "[N*]", keep: "A [N*]", replace: "[N*]" },
  "a kept tab under a showing preview": {
    auto: "A [N*]",
    keep: "A B [N*]",
    replace: "A [N*]",
  },
  "a preview left behind a showing kept tab": {
    auto: "B [N*]",
    keep: "B [N*]",
    replace: "[N*]",
  },
  "kept tabs either side of a showing one": {
    auto: "A B [N*] C",
    keep: "A B [N*] C",
    replace: "A [N*] C",
  },
};

const modes: OpenMode[] = ["auto", "keep", "replace"];

/** The rule's invariants, whatever the case. */
const checkInvariants = (before: LeafNode, after: LeafNode, mode: OpenMode) => {
  const { tabs, active } = leafTabs(after);
  // The opened document shows, as a preview…
  expect(tabs[active]).toMatchObject({ url: N, preview: true });
  // …and is the only preview in its panel, and appears once.
  expect(tabs.filter((t) => t.preview)).toHaveLength(1);
  expect(new Set(tabs.map((t) => t.url)).size).toBe(tabs.length);
  // No kept document is ever lost, except the showing one by an explicit
  // "replace" (whose keeping was the open's own gesture).
  const was = leafTabs(before);
  was.tabs.forEach((tab, i) => {
    if (!tab.url || tab.preview) return;
    if (mode === "replace" && i === was.active) return;
    expect(tabs.some((t) => t.url === tab.url && !t.preview)).toBe(true);
  });
};

describe("opening a document into a panel", () => {
  for (const { shape, panel: before } of shapes) {
    for (const mode of modes) {
      const want = expected[shape][mode];

      it(`${shape}, ${mode}: ${want}`, () => {
        const doc: TilingLayoutDoc = { layout: withFolder(structuredClone(before)) };
        openInLeafIn(doc, "leaf", { url: N }, mode);
        const after = panel(doc.layout!);
        expect(describeTabs(after)).toBe(want);
        checkInvariants(before, after, mode);
      });

      it(`${shape}, ${mode}: the same on an Automerge document`, () => {
        let doc = Automerge.from<TilingLayoutDoc>({
          layout: withFolder(structuredClone(before)),
        });
        doc = Automerge.change(doc, (d) => openInLeafIn(d, "leaf", { url: N }, mode));
        expect(describeTabs(panel(doc.layout!))).toBe(want);
      });
    }
  }

  it("a document the panel already holds is shown, as it is", () => {
    const doc: TilingLayoutDoc = {
      layout: withFolder(leaf("leaf", [kept(A), preview(B)], 0)),
    };
    openInLeafIn(doc, "leaf", { url: B });
    expect(describeTabs(panel(doc.layout!))).toBe("A [B*]");
  });

  it("the folder navigator beside it is untouched", () => {
    const doc: TilingLayoutDoc = { layout: withFolder(leaf("leaf", [preview(A)])) };
    openInLeafIn(doc, "leaf", { url: N });
    expect(panel(doc.layout!, "folder").view).toEqual({ role: "root-folder" });
  });
});

describe("the sidebar story", () => {
  it("clicking through documents leaves one tab; engaging keeps it", () => {
    const doc: TilingLayoutDoc = { layout: withFolder(leaf("leaf", [{}])) };
    const open = (url: string) => openInLeafIn(doc, "leaf", { url: url as PanelView["url"] });
    open(A);
    open(B);
    open(C);
    expect(describeTabs(panel(doc.layout!))).toBe("[C*]");
    keepShowingIn(doc, "leaf");
    open(N);
    expect(describeTabs(panel(doc.layout!))).toBe("C [N*]");
  });
});

describe("moving a document keeps it", () => {
  const twoPanels = (): TilingLayoutDoc => ({
    layout: {
      kind: "split",
      id: "split",
      direction: "horizontal",
      sizes: [50, 50],
      children: [
        leaf("left", [kept(A), preview(B)], 1),
        leaf("right", [kept(C)]),
      ],
    },
  });

  it("a preview tab dragged onto another panel", () => {
    const doc = twoPanels();
    stackIntoIn(doc, "left", 1, "right");
    expect(describeTabs(panel(doc.layout!, "right"))).toBe("C [B]");
  });

  it("a preview tab dragged along its own strip", () => {
    const doc = twoPanels();
    stackIntoIn(doc, "left", 1, "left", 0);
    expect(describeTabs(panel(doc.layout!, "left"))).toBe("[B] A");
  });

  it("a preview tab split off to an edge", () => {
    const doc = twoPanels();
    const id = moveTabIn(doc, "left", 1, "right", "bottom");
    expect(describeTabs(panel(doc.layout!, id!))).toBe("[B]");
  });

  it("a whole panel showing a preview, moved to an edge", () => {
    const doc = twoPanels();
    moveLeafIn(doc, "left", "right", "bottom");
    expect(describeTabs(panel(doc.layout!, "left"))).toBe("A [B]");
  });
});
