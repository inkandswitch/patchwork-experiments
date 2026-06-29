import type { AutomergeUrl } from "@automerge/automerge-repo";
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
  const out: PanelView = {};
  if (view.url !== undefined && view.url !== null) out.url = view.url;
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

/** An empty *content* frame: a placeholder panel awaiting its first document. */
export const makeEmptyLeaf = (): LeafNode => makeLeaf({});

/**
 * The root-folder navigator, stored *symbolically* (no url): it resolves to the
 * viewer's own `rootFolderUrl` at render time so a shared layout never carries
 * the author's folder document.
 */
export const makeRootFolderLeaf = (): LeafNode => makeLeaf({ role: "root-folder" });

const makeSplit = (
  direction: SplitDirection,
  children: [LayoutNode, LayoutNode],
  sizes: [number, number] = [50, 50],
): SplitNode => ({
  kind: "split",
  id: nextId("split"),
  direction,
  children,
  sizes,
});

/**
 * The arrangement a fresh session starts from: the root folder as a narrow
 * navigator beside a (wide) empty content frame, so the folder never spans the
 * full width and there's always a slot ready for the first document.
 */
export const makeInitialLayout = (): SplitNode =>
  makeSplit("horizontal", [makeRootFolderLeaf(), makeEmptyLeaf()], [28, 72]);

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

/**
 * A "content" leaf is a normal document panel (an empty content frame counts) —
 * i.e. *not* the root-folder navigator and *not* a context (comments/history/…)
 * panel. Used so document opens never land in (or carve up) those special
 * panels. The optional `rootFolderUrl` also excludes legacy url-based folder
 * leaves that predate the symbolic `"root-folder"` role.
 */
export const isContentLeaf = (
  leaf: LeafNode | null,
  rootFolderUrl?: string,
): boolean =>
  !!leaf &&
  leaf.view.role !== "context" &&
  leaf.view.role !== "root-folder" &&
  !(rootFolderUrl !== undefined && leaf.view.url === rootFolderUrl);

/** Find the id of the root-folder navigator panel, if one is open. */
export const findRootFolderLeafId = (
  node: LayoutNode | null,
  rootFolderUrl?: string,
): string | null => {
  if (!node) return null;
  if (node.kind === "leaf") {
    const isFolder =
      node.view.role === "root-folder" ||
      (rootFolderUrl !== undefined && node.view.url === rootFolderUrl);
    return isFolder ? node.id : null;
  }
  return (
    findRootFolderLeafId(node.children[0], rootFolderUrl) ??
    findRootFolderLeafId(node.children[1], rootFolderUrl)
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
  const url = view.url;
  if (url === undefined || url === null) {
    if (target.url !== undefined) delete (target as { url?: string }).url;
  } else if (target.url !== url) {
    target.url = url;
  }
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
  // Filling an *empty* content frame isn't a navigation, so it leaves no
  // back-history entry to return to.
  if (leaf.view.url) leaf.history.push(cleanView(leaf.view));
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

/** Does the tree contain at least one content leaf (empty frames count)? */
const hasContentLeaf = (
  node: LayoutNode,
  rootFolderUrl?: string,
): boolean =>
  node.kind === "leaf"
    ? isContentLeaf(node, rootFolderUrl)
    : hasContentLeaf(node.children[0], rootFolderUrl) ||
      hasContentLeaf(node.children[1], rootFolderUrl);

/**
 * Keep the invariant that there's always a content frame for documents to open
 * into, so the folder/context panes never end up alone and full-width. If the
 * layout is missing or has no content leaf, (re)introduce an empty content
 * frame beside the folder.
 */
export const ensureContentFrameIn = (
  doc: TilingLayoutDoc,
  rootFolderUrl?: AutomergeUrl,
): void => {
  const root = doc.layout;
  if (!root) {
    doc.layout = makeInitialLayout();
    return;
  }
  if (hasContentLeaf(root, rootFolderUrl)) return;
  // Add the empty frame beside a *non-folder* pane so we never carve the new
  // frame out of the narrow folder strip (which would make both halves tiny).
  // Only split the folder when it's the sole pane (then it's full-width anyway).
  const folderId = findRootFolderLeafId(root, rootFolderUrl);
  const ids = collectLeafIds(root);
  const target = ids.find((id) => id !== folderId) ?? ids[0];
  if (!target) {
    doc.layout = makeInitialLayout();
    return;
  }
  splitLeafIn(doc, target, "horizontal", makeEmptyLeaf());
};

/**
 * Add the root-folder navigator as a full-height column on the **left**,
 * wrapping the current arrangement. Returns the new folder leaf's id (so the
 * caller can focus it). Used by the Home action when no folder pane is open.
 */
export const addRootFolderColumnIn = (doc: TilingLayoutDoc): string => {
  const folder = makeRootFolderLeaf();
  const root = doc.layout;
  if (!root) {
    doc.layout = makeSplit("horizontal", [folder, makeEmptyLeaf()], [28, 72]);
  } else {
    doc.layout = makeSplit("horizontal", [folder, cloneLayout(root)], [28, 72]);
  }
  return folder.id;
};

/**
 * Convert any legacy url-based root-folder leaves (which embed the author's
 * folder document) into the symbolic `"root-folder"` role, so this session — and
 * anything shared from it — resolves the folder to the *viewer's* own. Only the
 * current viewer's `rootFolderUrl` is recognizable here; a foreign folder url in
 * a received layout can't be detected. Returns whether anything changed.
 */
export const normalizeRootFolderIn = (
  doc: TilingLayoutDoc,
  rootFolderUrl: AutomergeUrl,
): boolean => {
  let changed = false;
  const visit = (node: LayoutNode): void => {
    if (node.kind === "leaf") {
      if (node.view.role !== "root-folder" && node.view.url === rootFolderUrl) {
        node.view.role = "root-folder";
        delete (node.view as { url?: string }).url;
        node.history.splice(0, node.history.length);
        changed = true;
      }
      return;
    }
    visit(node.children[0]);
    visit(node.children[1]);
  };
  if (doc.layout) visit(doc.layout);
  return changed;
};
