import { isValidAutomergeUrl } from "@automerge/automerge-repo";
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

/**
 * Whether a view's `url` can't name a document: present, but not an Automerge
 * URL (a typo, a bare id, whatever some other writer left there). The repo
 * throws on such a string, synchronously, from inside the hooks that render a
 * tab — taking the whole frame down, and again on every reload, since the
 * layout is persisted. So no stored view ever holds one: every write goes
 * through {@link cleanView} or {@link writeView}, which drop it, and a layout
 * written before (or by someone else) is put right by {@link repairLayout}.
 */
const hasBadUrl = (view: PanelView): boolean =>
  view.url !== undefined && view.url !== null && !isValidAutomergeUrl(view.url);

/**
 * Build a clean (no `undefined`) view object safe to store in Automerge. A
 * view whose url names no document becomes an empty one; its tool went with
 * the document, so it goes too.
 */
const cleanView = (view: PanelView): PanelView => {
  const out: PanelView = {};
  if (view.role !== undefined && view.role !== null) out.role = view.role;
  if (hasBadUrl(view)) return out;
  if (view.url !== undefined && view.url !== null) out.url = view.url;
  if (view.toolId !== undefined && view.toolId !== null) out.toolId = view.toolId;
  return out;
};

export const makeLeaf = (view: PanelView): LeafNode => ({
  kind: "leaf",
  id: nextId("leaf"),
  view: cleanView(view),
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
  makeSplit("horizontal", [makeRootFolderLeaf(), makeEmptyLeaf()], navigatorSizes());

/**
 * The folder navigator starts about 260px wide: room for a ~30-character name
 * a few levels deep, the width most sidebars settle on (Finder, VS Code,
 * Notion). Split sizes are percentages of the frame, so convert at the moment
 * the column is made; clamped so it stays usable on very wide or narrow
 * windows (and above the panels' 10% minimum).
 */
export const NAVIGATOR_WIDTH_PX = 260;
export const navigatorSizes = (
  frameWidth: number = typeof window === "undefined" ? 0 : window.innerWidth,
): [number, number] => {
  const percent = frameWidth > 0 ? (NAVIGATOR_WIDTH_PX / frameWidth) * 100 : 20;
  const clamped = Math.round(Math.min(28, Math.max(10, percent)) * 10) / 10;
  return [clamped, Math.round((100 - clamped) * 10) / 10];
};

/**
 * Deep-clone a (possibly Automerge-proxied) subtree into plain objects, reading
 * fields explicitly so it works on live document proxies and strips undefined.
 * Used when a structural op needs to move a subtree to a new slot.
 */
export const cloneLayout = (node: LayoutNode): LayoutNode => {
  if (node.kind === "leaf") {
    const leaf: LeafNode = { kind: "leaf", id: node.id, view: {} };
    const { tabs, active } = leafTabs(node);
    writeTabs(leaf, tabs, active);
    if (node.drawer) {
      leaf.drawer = { open: node.drawer.open, width: node.drawer.width };
      if (node.drawer.tool) leaf.drawer.tool = node.drawer.tool;
    }
    return leaf;
  }
  return {
    kind: "split",
    id: node.id,
    direction: node.direction,
    sizes: [node.sizes[0], node.sizes[1]],
    children: [cloneLayout(node.children[0]), cloneLayout(node.children[1])],
  };
};

const someLeaf = (node: LayoutNode, test: (leaf: LeafNode) => boolean): boolean =>
  node.kind === "leaf"
    ? test(node)
    : someLeaf(node.children[0], test) || someLeaf(node.children[1], test);

const leafHasBadUrl = (leaf: LeafNode): boolean =>
  hasBadUrl(leaf.view) || (leaf.stack ?? []).some(hasBadUrl);

/**
 * `layout` with every url that names no document taken out (see
 * {@link hasBadUrl}): such a tab is dropped from its stack, and a panel whose
 * only document it was becomes an empty frame. The same object when there's
 * nothing to repair, so it's cheap to call on every render.
 */
export const repairLayout = <L extends LayoutNode | null>(layout: L): L =>
  layout && someLeaf(layout, leafHasBadUrl) ? (cloneLayout(layout) as L) : layout;

/** {@link repairLayout}, in place: only the leaves that need it are rewritten. */
export const repairLayoutIn = (doc: TilingLayoutDoc): void => {
  const visit = (node: LayoutNode): void => {
    if (node.kind === "split") {
      visit(node.children[0]);
      visit(node.children[1]);
    } else if (leafHasBadUrl(node)) {
      const { tabs, active } = leafTabs(node);
      writeTabs(node, tabs, active);
    }
  };
  if (doc.layout) visit(doc.layout);
};

/** Collect the ids of every leaf panel, in tree order. */
export const collectLeafIds = (node: LayoutNode): string[] =>
  node.kind === "leaf"
    ? [node.id]
    : [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])];

// --- Stacks ---

const clampStackAt = (leaf: LeafNode): number =>
  Math.max(0, Math.min(leaf.stackAt ?? 0, leaf.stack?.length ?? 0));

/**
 * A leaf's documents in tab order, and the index of the one showing. A leaf
 * without a stack is one tab. (The views may be live document proxies; copy
 * before writing them back.)
 */
export const leafTabs = (
  leaf: LeafNode,
): { tabs: PanelView[]; active: number } => {
  const stack = leaf.stack ?? [];
  const at = clampStackAt(leaf);
  return {
    tabs: [...stack.slice(0, at), leaf.view, ...stack.slice(at)],
    active: at,
  };
};

/**
 * Store `tabs` on `leaf` with `tabs[active]` showing. This is the one place a
 * stack is written, so it keeps the invariants: every stacked tab is a
 * document (no empty entries), an empty view never shows while there's a
 * document to show instead, no document appears twice (the showing one wins),
 * and a single remaining tab is stored as a plain leaf, with no stack.
 */
const writeTabs = (leaf: LeafNode, given: PanelView[], requested: number): void => {
  const tabs = given.map(cleanView);
  const firstDoc = tabs.findIndex((tab) => !!tab.url);
  const active = tabs[requested]?.url || firstDoc < 0 ? requested : firstDoc;
  const shownUrl = tabs[active]?.url;
  const seen = new Set<string>(shownUrl ? [shownUrl] : []);
  const kept: PanelView[] = [];
  let shown = 0;
  tabs.forEach((tab, i) => {
    if (i === active) {
      shown = kept.length;
      kept.push(tab);
      return;
    }
    if (!tab.url || seen.has(tab.url)) return;
    seen.add(tab.url);
    kept.push(tab);
  });
  if (kept.length === 0) return;
  leaf.view = kept[shown];
  const rest = kept.filter((_, i) => i !== shown);
  if (rest.length > 0) {
    leaf.stack = rest;
    leaf.stackAt = shown;
  } else {
    if (leaf.stack !== undefined) delete leaf.stack;
    if (leaf.stackAt !== undefined) delete leaf.stackAt;
  }
};

/** Find the panel and tab showing or holding `url`, if any. */
export const findTabByUrl = (
  node: LayoutNode,
  url: string,
): { leafId: string; index: number; active: boolean } | null => {
  if (node.kind === "leaf") {
    const { tabs, active } = leafTabs(node);
    const index = tabs.findIndex((tab) => tab.url === url);
    return index < 0 ? null : { leafId: node.id, index, active: index === active };
  }
  return (
    findTabByUrl(node.children[0], url) ?? findTabByUrl(node.children[1], url)
  );
};

/**
 * A "content" leaf is a normal document panel (an empty content frame counts):
 * anything but the root-folder navigator. Used so document opens never land
 * in (or carve up) the navigator.
 */
export const isContentLeaf = (leaf: LeafNode | null): boolean =>
  !!leaf && leaf.view.role !== "root-folder";

/** Find the id of the root-folder navigator panel, if one is open. */
export const findRootFolderLeafId = (node: LayoutNode | null): string | null => {
  if (!node) return null;
  if (node.kind === "leaf") return node.view.role === "root-folder" ? node.id : null;
  return (
    findRootFolderLeafId(node.children[0]) ?? findRootFolderLeafId(node.children[1])
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
const writeView = (target: PanelView, given: PanelView): void => {
  const view = cleanView(given);
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

/**
 * Replace the document a leaf is showing. There's no back-history: to keep a
 * document around, stack it ({@link stackViewIn}) rather than replacing it.
 */
export const navigateLeafIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  view: PanelView,
): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return;
  if (leaf.view.url === view.url && (leaf.view.toolId ?? null) === (view.toolId ?? null))
    return;
  writeView(leaf.view, view);
  // If that document was also stacked behind, it's now the one showing.
  if (leaf.stack?.length) {
    const { tabs, active } = leafTabs(leaf);
    writeTabs(leaf, tabs, active);
  }
};

/** Show tab `index` of a leaf's stack. */
export const activateTabIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  index: number,
): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return;
  const { tabs, active } = leafTabs(leaf);
  if (index === active || !tabs[index]) return;
  writeTabs(leaf, tabs, index);
};

/**
 * Add a document to a leaf's stack, just after the tab showing, and show it.
 * A document already in the stack is shown instead; an empty frame is simply
 * filled.
 */
export const stackViewIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  view: PanelView,
): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf || !view.url) return;
  if (!leaf.view.url) {
    writeTabs(leaf, [view], 0);
    return;
  }
  const { tabs, active } = leafTabs(leaf);
  const existing = tabs.findIndex((tab) => tab.url === view.url);
  if (existing >= 0) {
    writeTabs(leaf, tabs, existing);
    return;
  }
  const next = [...tabs];
  next.splice(active + 1, 0, view);
  writeTabs(leaf, next, active + 1);
};

/**
 * Remove tab `index` from a leaf's stack, returning it (copied). A leaf keeps
 * at least one tab, so a lone document isn't removable this way (close the
 * panel instead). Closing the showing tab shows its right-hand neighbour, or
 * the left one at the end.
 */
export const closeTabIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  index: number,
): PanelView | null => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return null;
  const { tabs, active } = leafTabs(leaf);
  if (tabs.length < 2 || !tabs[index]) return null;
  const removed = cleanView(tabs[index]);
  const next = tabs.filter((_, i) => i !== index);
  const shown =
    index < active
      ? active - 1
      : index === active
        ? Math.min(index, next.length - 1)
        : active;
  writeTabs(leaf, next, shown);
  return removed;
};

/**
 * Put documents into `target`'s stack at tab position `at`, and show the one
 * that arrived showing. The documents are either one tab of `source` (`tab`)
 * or, with `tab` null, all of `source`'s, which is then removed (merging the
 * two panels). Taking a source's only tab removes the source too.
 *
 * `at` counts positions in `target`'s tabs, 0 … n. Left out, a single tab goes
 * just after the one showing (as {@link stackViewIn} does) and a whole panel's
 * documents go at the end. Within one panel, it moves (reorders) that tab.
 * Documents `target` already holds aren't duplicated. Returns the id of the
 * panel now showing them, or null if nothing changed.
 */
export const stackIntoIn = (
  doc: TilingLayoutDoc,
  sourceLeafId: string,
  tab: number | null,
  targetLeafId: string,
  at?: number,
): string | null => {
  const source = findLeaf(doc.layout, sourceLeafId);
  const target = findLeaf(doc.layout, targetLeafId);
  if (!source || !target) return null;
  const from = leafTabs(source);
  if (tab !== null && !from.tabs[tab]) return null;

  if (sourceLeafId === targetLeafId) {
    if (tab === null || at === undefined) return null;
    const tabs = from.tabs.map(cleanView);
    const [moving] = tabs.splice(tab, 1);
    const pos = Math.max(0, Math.min(at > tab ? at - 1 : at, tabs.length));
    tabs.splice(pos, 0, moving);
    writeTabs(source, tabs, pos);
    return targetLeafId;
  }

  const moving = (tab === null ? from.tabs : [from.tabs[tab]])
    .map(cleanView)
    .filter((view) => view.url);
  // An empty source brings nothing, and leaves the target showing what it was.
  const shownUrl =
    (tab === null ? from.tabs[from.active]?.url : moving[0]?.url) ?? target.view.url;
  const into = leafTabs(target);
  const intoDocs = into.tabs.map(cleanView).filter((view) => view.url);
  const incoming = moving.filter((m) => !intoDocs.some((t) => t.url === m.url));
  if (intoDocs.length + incoming.length === 0) return null;
  const defaultAt = tab === null || !target.view.url ? intoDocs.length : into.active + 1;
  const pos = Math.max(0, Math.min(at ?? defaultAt, intoDocs.length));

  // Take the documents out of the source. Removing a whole leaf re-clones its
  // sibling's slot, so look the target up again afterwards.
  if (tab === null || from.tabs.length < 2) removeLeafIn(doc, sourceLeafId);
  else closeTabIn(doc, sourceLeafId, tab);
  const after = findLeaf(doc.layout, targetLeafId);
  if (!after) return null;
  const merged = [...intoDocs.slice(0, pos), ...incoming, ...intoDocs.slice(pos)];
  writeTabs(after, merged, Math.max(0, merged.findIndex((t) => t.url === shownUrl)));
  return targetLeafId;
};

/**
 * Stack every document of `source` into `target` (after its own), showing the
 * one `source` was showing, and remove `source`. An empty target just takes
 * them. No-op onto itself.
 */
export const mergeLeafIn = (
  doc: TilingLayoutDoc,
  sourceLeafId: string,
  targetLeafId: string,
): void => {
  if (sourceLeafId === targetLeafId) return;
  stackIntoIn(doc, sourceLeafId, null, targetLeafId);
};

/**
 * Move one tab out of a leaf: onto another panel's middle (stacking it there)
 * or against an edge (a new panel, which may be beside its old one). A leaf's
 * only tab moves the whole leaf. Returns the id of the panel now showing it.
 */
export const moveTabIn = (
  doc: TilingLayoutDoc,
  sourceLeafId: string,
  index: number,
  targetLeafId: string,
  side: DropSide,
): string | null => {
  const source = findLeaf(doc.layout, sourceLeafId);
  if (!source || !findLeaf(doc.layout, targetLeafId)) return null;
  if (leafTabs(source).tabs.length < 2) {
    if (sourceLeafId === targetLeafId) return null;
    moveLeafIn(doc, sourceLeafId, targetLeafId, side);
    // Stacked into the target, the source is gone; at an edge it moved.
    return side === "center" ? targetLeafId : sourceLeafId;
  }
  if (side === "center") {
    if (sourceLeafId === targetLeafId) return null;
    return stackIntoIn(doc, sourceLeafId, index, targetLeafId);
  }
  const view = closeTabIn(doc, sourceLeafId, index);
  if (!view) return null;
  const leaf = makeLeaf(view);
  splitLeafIn(doc, targetLeafId, directionOf(side), leaf, insertsAfter(side));
  return leaf.id;
};

const directionOf = (side: DropSide): SplitDirection =>
  side === "left" || side === "right" ? "horizontal" : "vertical";
const insertsAfter = (side: DropSide): boolean =>
  side === "right" || side === "bottom";

// --- Drawers ---

export const DRAWER_WIDTH_PX = 320;
const DRAWER_MIN_PX = 200;
const DRAWER_MAX_PX = 900;

/** Open or close a leaf's drawer (opening one it's never had). */
export const toggleDrawerIn = (doc: TilingLayoutDoc, leafId: string): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return;
  if (!leaf.drawer) {
    leaf.drawer = { open: true, width: DRAWER_WIDTH_PX };
    return;
  }
  leaf.drawer.open = !leaf.drawer.open;
};

/** Show a context tool in a leaf's drawer, opening the drawer if need be. */
export const showDrawerToolIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  toolId: string,
): void => {
  const leaf = findLeaf(doc.layout, leafId);
  if (!leaf) return;
  if (!leaf.drawer) {
    leaf.drawer = { open: true, tool: toolId, width: DRAWER_WIDTH_PX };
    return;
  }
  if (!leaf.drawer.open) leaf.drawer.open = true;
  if (leaf.drawer.tool !== toolId) leaf.drawer.tool = toolId;
};

/** Set the drawer's width, within sensible bounds. */
export const setDrawerWidthIn = (
  doc: TilingLayoutDoc,
  leafId: string,
  width: number,
): void => {
  const drawer = findLeaf(doc.layout, leafId)?.drawer;
  if (!drawer) return;
  const clamped = clampDrawerWidth(width);
  if (drawer.width !== clamped) drawer.width = clamped;
};

export const clampDrawerWidth = (width: number): number =>
  Math.round(Math.min(DRAWER_MAX_PX, Math.max(DRAWER_MIN_PX, width)));

/** Switch the tool used to render a leaf's showing document. */
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
 * leaf keeps its id and stack (so focus/selection and its mounted view
 * survive the move). No-op if source and target are the same leaf.
 */
export const moveLeafIn = (
  doc: TilingLayoutDoc,
  sourceLeafId: string,
  targetLeafId: string,
  side: DropSide,
): void => {
  if (sourceLeafId === targetLeafId) return;
  if (side === "center") {
    mergeLeafIn(doc, sourceLeafId, targetLeafId);
    return;
  }
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

  splitLeafIn(doc, targetLeafId, directionOf(side), moved, insertsAfter(side));
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
const hasContentLeaf = (node: LayoutNode): boolean =>
  node.kind === "leaf"
    ? isContentLeaf(node)
    : hasContentLeaf(node.children[0]) || hasContentLeaf(node.children[1]);

/**
 * Keep the invariant that there's always a content frame for documents to open
 * into, so the folder pane never ends up alone and full-width. If the
 * layout is missing or has no content leaf, (re)introduce an empty content
 * frame beside the folder.
 */
export const ensureContentFrameIn = (doc: TilingLayoutDoc): void => {
  const root = doc.layout;
  if (!root) {
    doc.layout = makeInitialLayout();
    return;
  }
  if (hasContentLeaf(root)) return;
  // Add the empty frame beside a *non-folder* pane so we never carve the new
  // frame out of the narrow folder strip (which would make both halves tiny).
  // Only split the folder when it's the sole pane (then it's full-width anyway).
  const folderId = findRootFolderLeafId(root);
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
    doc.layout = makeSplit("horizontal", [folder, makeEmptyLeaf()], navigatorSizes());
  } else {
    doc.layout = makeSplit("horizontal", [folder, cloneLayout(root)], navigatorSizes());
  }
  return folder.id;
};
