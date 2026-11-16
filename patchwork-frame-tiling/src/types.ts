import { AutomergeUrl } from "@automerge/automerge-repo";

/**
 * The frame is mounted against an `account` document, shared with (and
 * switchable to/from) other frame implementations like threepane. Only
 * `rootFolderUrl` is required by the tiling frame itself; the rest exist for
 * compatibility with the wider patchwork frame ecosystem.
 */
export type TinyPatchworkConfigDoc = {
  rootFolderUrl?: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  contactUrl?: AutomergeUrl;
  /**
   * The most-recent tiling session's {@link TilingLayoutDoc} — the "current"
   * layout a new tab resumes from. It's a rolling pointer: opening a new tab
   * mints a fresh session (cloned from here) and repoints this at it, POSIX
   * `unlink`-style. The previously-pointed doc isn't deleted; it just becomes
   * unreferenced cold storage (still openable by a tab that has it in its URL).
   */
  currentLayoutUrl?: AutomergeUrl;

  /** Remembered per-doc / per-datatype tool choices (see {@link ToolPreferences}). */
  toolPreferences?: ToolPreferences;

  /**
   * Private per-tool storage docs, keyed by an arbitrary tool-chosen id.
   * Lazily created and populated by the `patchwork:tool-storage` provider
   * (see `patchwork-base/providers`) the first time a tool requests it — lets
   * a tool persist account-scoped data (chat history, an API key, …) without
   * a `docUrl` of its own, and without reaching for `window.accountDocHandle`.
   */
  toolStorage?: { [toolId: string]: AutomergeUrl };
};

/**
 * The user's remembered tool choices, synced on their account so they follow
 * across devices. Resolution prefers the most specific scope (see
 * `resolvePreferredTool`): the document, then its datatype.
 */
export type ToolPreferences = {
  /** Last tool chosen for a given document, keyed by AutomergeUrl. */
  byDoc?: { [url: string]: string };
  /** Last tool chosen for a given datatype, keyed by `@patchwork.type`. */
  byType?: { [type: string]: string };
};

export type PanelView = {
  /**
   * The document shown in this panel. **Absent** for an *empty content frame* —
   * a placeholder content panel kept beside the folder pane so it never spans
   * the full width. The next document opened fills the empty frame instead of
   * splitting the folder.
   */
  url?: AutomergeUrl;
  toolId?: string;
  /**
   * `"root-folder"` marks the account's root folder navigator. Its url is
   * deliberately **not** stored; it's resolved to the *viewer's*
   * `rootFolderUrl` at render time, so a shared layout doesn't carry (and leak)
   * the author's folder — the recipient sees their own folders instead.
   */
  role?: "root-folder";
};

export type SplitDirection = "horizontal" | "vertical";

/**
 * Where a drag lands on a target panel: against an edge (splitting it), or in
 * the middle (`"center"`: stacking into it).
 */
export type DropSide = "left" | "right" | "top" | "bottom" | "center";

/**
 * A leaf panel shows one document, `view`. A content panel can also hold a
 * **stack** of further documents, shown as tabs, one at a time. The one
 * showing always stays in `view`, so everything that asks "what does this
 * panel show?" reads the same field either way; `stack` holds the others, and
 * `stackAt` places the showing one among them: the tab order is
 * `stack[0 … stackAt)`, then `view`, then `stack[stackAt …]`. Absent `stack`
 * means a single document. Read it with `leafTabs`.
 */
export type LeafNode = {
  kind: "leaf";
  id: string;
  view: PanelView;
  stack?: PanelView[];
  stackAt?: number;
  /** Context tools docked beside this panel's document; see {@link Drawer}. */
  drawer?: Drawer;
};

/**
 * A document panel's **drawer**: the context tools (comments, history, …)
 * along its right edge, describing the document the panel is showing. Every
 * registered context tool is listed in it, so all the panel remembers is
 * whether the drawer is open, which tool it last showed, and how wide it was;
 * they're kept while it's closed, so it reopens as it was.
 */
export type Drawer = {
  open: boolean;
  /** The context tool last shown; absent (or uninstalled), the first one. */
  tool?: string;
  /** Width in px (the view caps it at a share of the panel). */
  width: number;
};

/** A split node tiles two children along an axis. */
export type SplitNode = {
  kind: "split";
  id: string;
  direction: SplitDirection;
  children: [LayoutNode, LayoutNode];
  /** Persisted sizes (percentages) for the two children. */
  sizes: [number, number];
};

export type LayoutNode = LeafNode | SplitNode;

/**
 * A standalone document that persists the tiling frame's panel layout so the
 * arrangement survives a reload. Kept separate from the account/config doc so
 * the frame owns its own state instead of leaning on frame-specific fields of
 * {@link TinyPatchworkConfigDoc}.
 */
export type TilingLayoutDoc = {
  layout: LayoutNode | null;
  "@patchwork"?: { type: string };
};
