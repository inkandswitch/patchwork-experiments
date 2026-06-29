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

  /**
   * Per-tool config doc urls, keyed by tool id. `tools["threepane"]` points at a
   * {@link ThreepaneConfigDoc}; the tiling frame reuses it (shared with the
   * threepane frame) so the frame configurator and **system tray** are driven by
   * the same configuration across frames.
   */
  tools?: { [toolId: string]: AutomergeUrl };

  /** Remembered per-doc / per-datatype tool choices (see {@link ToolPreferences}). */
  toolPreferences?: ToolPreferences;
};

/** A configured tool: a `[toolId, docId]` tuple, or a bare `patchwork:component` id. */
export type ToolRef = [toolId: string, docId: AutomergeUrl];
export type ToolSlot = ToolRef | string;

/**
 * The shared frame layout config (its own document, referenced from
 * `tools["threepane"]`). The tiling frame only consumes the **tray** lane; the
 * other lanes are owned by the threepane frame but kept here for type parity.
 */
export type ThreepaneConfigDoc = {
  sidebar?: { widgets: ToolSlot[] };
  contextbar?: { tabs: ToolSlot[] };
  doctitle?: { tools: ToolSlot[] };
  tray?: { tools: ToolSlot[] };
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
   * a placeholder content panel kept beside the folder/context panes so they
   * never span the full width. The next document opened fills the empty frame
   * instead of splitting the folder.
   */
  url?: AutomergeUrl;
  toolId?: string;
  /**
   * Marks a panel's special role:
   * - `"context"` — a context panel (comments, history, …) that describes the
   *   selected content panel and is itself excluded from being the "selected
   *   document".
   * - `"root-folder"` — the account's root folder navigator. The url is
   *   deliberately **not** stored; it's resolved to the *viewer's*
   *   `rootFolderUrl` at render time, so a shared layout doesn't carry (and
   *   leak) the author's folder — the recipient sees their own folders instead.
   */
  role?: "context" | "root-folder";
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
