import { AutomergeUrl } from "@automerge/automerge-repo";

/**
 * The frame is mounted against an `account` document. Only `rootFolderUrl` is
 * required by the tiling frame; the other fields are kept for compatibility
 * with the wider patchwork frame ecosystem.
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
  /**
   * Legacy single shared layout (pre per-tab sessions). Read only as a fallback
   * clone source for the first new-model session so existing users' arrangement
   * carries over; no longer written.
   */
  tilingLayoutUrl?: AutomergeUrl;

  frameToolId?: string;
  accountSidebarToolId?: string;
  contextSidebarToolId?: string;
  contextToolIds?: string[];
  documentToolbarToolIds?: string[];

  /** Remembered per-doc / per-datatype tool choices (see {@link ToolPreferences}). */
  toolPreferences?: ToolPreferences;
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
  url: AutomergeUrl;
  toolId?: string;
  /**
   * Marks a panel as a *context* panel (comments, history, etc.) rather than a
   * content document. Context panels describe the selected content panel and
   * are excluded from being the "selected document" themselves.
   */
  role?: "context";
};

export type SplitDirection = "horizontal" | "vertical";

/** The edge of a target panel a dragged panel is dropped against. */
export type DropSide = "left" | "right" | "top" | "bottom";

/** A leaf panel shows a single document with a back-history stack. */
export type LeafNode = {
  kind: "leaf";
  id: string;
  view: PanelView;
  history: PanelView[];
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
