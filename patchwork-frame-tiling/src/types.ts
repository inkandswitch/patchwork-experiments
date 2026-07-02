import { AutomergeUrl } from "@automerge/automerge-repo";

/**
 * The frame is mounted against an `account` document, shared with (and
 * switchable to/from) other frame implementations like threepane. Only
 * `rootFolderUrl` is required by the tiling frame itself; the rest exist for
 * compatibility with the wider patchwork frame ecosystem — in particular
 * `tools["threepane"]`, which both frames read for tray/context-tool config
 * (see {@link ThreepaneConfigDoc}).
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

  /** @deprecated seeds migration into the threepane config doc's contextbar.tabs */
  contextToolIds?: string[];

  /**
   * Per-tool config doc urls, keyed by tool id. `tools["threepane"]` points at
   * a {@link ThreepaneConfigDoc} — owned by, and shared with, the threepane
   * frame — holding the `tray` and `contextbar` lanes the tiling frame reads,
   * so an account switching between frames sees the same tray and context
   * tools either way, edited via the same frame configurator.
   */
  tools?: { [toolId: string]: AutomergeUrl };

  /** Remembered per-doc / per-datatype tool choices (see {@link ToolPreferences}). */
  toolPreferences?: ToolPreferences;
};

/**
 * A configured tool slot: which tool, and which document it renders against.
 * The docid is a real pin — every lane renders the tuple's tool against the
 * document the tuple itself names.
 */
export type ToolRef = [toolId: string, docId: AutomergeUrl];

/**
 * One entry in a tool lane (tray / contextbar). Either a `[toolId, docId]`
 * tuple rendered as a `patchwork:tool` against the doc the tuple names, or a
 * bare component id rendered as a `patchwork:component` (with no document).
 * Mirrors threepane's `ToolSlot`.
 */
export type ToolSlot = ToolRef | string;

/**
 * The shared frame layout config (its own document, referenced from
 * `tools["threepane"]`). Owned by the threepane frame; the tiling frame only
 * reads its `tray` and `contextbar` lanes (the `sidebar` and `doctitle` lanes
 * are threepane-specific UI it doesn't have).
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
   * instead of splitting the folder. Also absent for a `"context"` panel whose
   * slot is a bare component (mounted against no document) — but **present**
   * for a context panel backed by a `[toolId, docId]` tool-tuple slot, which
   * names the document that tool renders against.
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
