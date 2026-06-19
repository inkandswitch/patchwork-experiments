import type {
  DropSide,
  LayoutNode,
  LeafNode,
  PanelView,
  SplitDirection,
  SplitNode,
  TilingLayoutDoc,
} from "./types";

let idCounter = 0;
// Include a per-session random component so ids generated after a reload never
// collide with ids restored from a persisted layout document.
const sessionTag = Math.random().toString(36).slice(2, 8);
const nextId = (prefix: string) =>
  `${prefix}-${sessionTag}-${(idCounter++).toString(36)}`;

/** Build a clean (no `undefined`) view object safe to store in Automerge. */
const cleanView = (view: PanelView): PanelView => {
  const out: PanelView = { url: view.url };
  if (view.toolId !== undefined && view.toolId !== null) out.toolId = view.toolId;
  if (view.role !== undefined && view.role !== null) out.role = view.role;
  return out;
};

export const makeLeaf = (view: PanelView): LeafNode => ({
  kind: "leaf",
  id: nextId("leaf"),
  view: cleanView(view),
  history: [],
});

const makeSplit = (
  direction: SplitDirection,
  children: [LayoutNode, LayoutNode],
): SplitNode => ({
  kind: "split",
  id: nextId("split"),
  direction,
  children,
  sizes: [50, 50],
});

/**
 * Deep-clone a (possibly Automerge-proxied) subtree into plain objects, reading
 * fields explicitly so it works on live document proxies and strips undefined.
 * Used when a structural op needs to move a subtree to a new slot.
 */
export const cloneLayout = (node: LayoutNode): LayoutNode => {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      id: node.id,
      view: cleanView(node.view),
      history: [...node.history].map(cleanView),
    };
  }
  return {
    kind: "split",
    id: node.id,
    direction: node.direction,
    sizes: [node.sizes[0], node.sizes[1]],
    children: [cloneLayout(node.children[0]), cloneLayout(node.children[1])],
  };
};

/** Collect the ids of every leaf panel, in tree order. */
export const collectLeafIds = (node: LayoutNode): string[] =>
  node.kind === "leaf"
    ? [node.id]
    : [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])];

/** Find the id of the first leaf whose view points at the given url. */
export const findLeafIdByUrl = (
  node: LayoutNode,
  url: string,
): string | null => {
  if (node.kind === "leaf") return node.view.url === url ? node.id : null;
  return (
    findLeafIdByUrl(node.children[0], url) ??
    findLeafIdByUrl(node.children[1], url)
  );
};

/** Read-only: find a leaf node by id. */
export const findLeaf = (
  node: LayoutNode | null,
  id: string,
): LeafNode | null => {
  if (!node) return null;
  if (node.kind === "leaf") return node.id === id ? node : null;
  return findLeaf(node.children[0], id) ?? findLeaf(node.children[1], id);
};

const findSplit = (
  node: LayoutNode | null,
  id: string,
): SplitNode | null => {
  if (!node || node.kind === "leaf") return null;
  if (node.id === id) return node;
  return findSplit(node.children[0], id) ?? findSplit(node.children[1], id);
};

type SplitLoc = {
  split: SplitNode;
  parent: SplitNode | null;
  indexInParent: 0 | 1;
};

/** Locate the split whose *direct* child is the given leaf, with its parent. */
const findSplitContainingLeaf = (
  node: LayoutNode,
  leafId: string,
  parent: SplitNode | null = null,
  indexInParent: 0 | 1 = 0,
): SplitLoc | null => {
  if (node.kind === "leaf") return null;
  const [a, b] = node.children;
  if (
    (a.kind === "leaf" && a.id === leafId) ||
    (b.kind === "leaf" && b.id === leafId)
  ) {
    return { split: node, parent, indexInParent };
  }
  return (
    findSplitContainingLeaf(a, leafId, node, 0) ??
    findSplitContainingLeaf(b, leafId, node, 1)
  );
};

const childIndexOfLeaf = (split: SplitNode, leafId: string): 0 | 1 =>
  split.children[0].kind === "leaf" && split.children[0].id === leafId ? 0 : 1;

/** Set `target.url`/`target.toolId` in place, avoiding `undefined` writes. */
const writeView = (target: PanelView, view: PanelView): void => {
  if (target.url !== view.url) target.url = view.url;
  const toolId = view.toolId;
  if (toolId === undefined || toolId === null) {
    if (target.toolId !== undefined)
      delete (target as { toolId?: string }).toolId;
  } else if (target.toolId !== toolId) {
    target.toolId = toolId;
  }
};

// --- In-place mutators (operate on the Automerge document draft) ---

/** Navigate a leaf to a new view, pushing the current view onto its history. */
export const navigateLeafIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  view: PanelView,
): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return;
  if (leaf.view.url === view.url && (leaf.view.toolId ?? null) === (view.toolId ?? null))
    return;
  leaf.history.push(cleanView(leaf.view));
  writeView(leaf.view, view);
};

/** Pop a leaf's history, returning it to the previous view. */
export const goBackIn = (doc: TilingLayoutDoc, leafId: string): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf || leaf.history.length === 0) return;
  const last = leaf.history[leaf.history.length - 1];
  const prev = cleanView(last);
  leaf.history.splice(leaf.history.length - 1, 1);
  writeView(leaf.view, prev);
};

/** Switch the tool used to render a leaf's current document (no history). */
export const setLeafToolIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  toolId: string | undefined,
): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return;
  writeView(leaf.view, { url: leaf.view.url, toolId });
};

/** Record new sizes for a split node after a drag. */
export const setSizesIn = (
  doc: TilingLayoutDoc,
  splitId: string,
  sizes: [number, number],
): void => {
  const split = findSplit(doc.layout, splitId);
  if (!split) return;
  if (split.sizes[0] !== sizes[0]) split.sizes[0] = sizes[0];
  if (split.sizes[1] !== sizes[1]) split.sizes[1] = sizes[1];
};

/**
 * Split a leaf in two, keeping the existing leaf on one side and the supplied
 * (already-created) leaf on the other. Only the target slot is rewritten.
 */
export const splitLeafIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  direction: SplitDirection,
  newLeaf: LeafNode,
  insertAfter = true,
): void => {
  const root = doc.layout;
  if (!root) return;

  if (root.kind === "leaf") {
    if (root.id !== leafId) return;
    const existing = cloneLayout(root);
    doc.layout = makeSplit(
      direction,
      insertAfter ? [existing, newLeaf] : [newLeaf, existing],
    );
    return;
  }

  const loc = findSplitContainingLeaf(root, leafId);
  if (!loc) return;
  const idx = childIndexOfLeaf(loc.split, leafId);
  const existing = cloneLayout(loc.split.children[idx]);
  loc.split.children[idx] = makeSplit(
    direction,
    insertAfter ? [existing, newLeaf] : [newLeaf, existing],
  );
};

/**
 * Move a leaf so it tiles against another leaf on the given side. The leaf is
 * first removed from its current slot (its sibling collapses up), then the
 * target leaf is split with the moved leaf placed on the chosen side. The moved
 * leaf keeps its id and history (so focus/selection and its mounted view
 * survive the move). No-op if source and target are the same leaf.
 */
export const moveLeafIn = (
  doc: TilingLayoutDoc,
  sourceLeafId: string,
  targetLeafId: string,
  side: DropSide,
): void => {
  if (sourceLeafId === targetLeafId) return;
  const root = doc.layout;
  if (!root) return;
  const source = findLeaf(root, sourceLeafId);
  if (!source) return;
  // Snapshot the dragged leaf before removal drops it from the tree.
  const moved = cloneLayout(source) as LeafNode;

  removeLeafIn(doc, sourceLeafId);
  // The only way the tree is now empty is if `source` was the sole leaf, which
  // can't happen here (target differs and still exists) — but guard anyway.
  if (!doc.layout) {
    doc.layout = moved;
    return;
  }

  const direction: SplitDirection =
    side === "left" || side === "right" ? "horizontal" : "vertical";
  const insertAfter = side === "right" || side === "bottom";
  splitLeafIn(doc, targetLeafId, direction, moved, insertAfter);
};

/**
 * Remove a leaf; its sibling collapses up into the split's slot. Removing the
 * last remaining leaf sets `doc.layout` to `null`. Only the affected slot is
 * rewritten.
 */
export const removeLeafIn = (doc: TilingLayoutDoc, leafId: string): void => {
  const root = doc.layout;
  if (!root) return;
  if (root.kind === "leaf") {
    if (root.id === leafId) doc.layout = null;
    return;
  }
  const loc = findSplitContainingLeaf(root, leafId);
  if (!loc) return;
  const leafIdx = childIndexOfLeaf(loc.split, leafId);
  const siblingClone = cloneLayout(loc.split.children[leafIdx === 0 ? 1 : 0]);
  if (!loc.parent) {
    doc.layout = siblingClone;
  } else {
    loc.parent.children[loc.indexInParent] = siblingClone;
  }
};
