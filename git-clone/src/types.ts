import type { AutomergeUrl, ImmutableString } from "@automerge/automerge-repo";

export type CloneStatus = "idle" | "cloning" | "done" | "error";

/**
 * The configuration / status document for a git-clone tool instance. This is
 * the doc the tool itself edits. The cloned repository is materialized into a
 * separate tree of `folder` / `file` documents (see `resultUrl`), using the
 * same shapes pushwork's `patchwork-folder` shape produces.
 */
export type GitCloneDoc = {
  "@patchwork"?: { type: "git-clone" };
  title: string;
  /** Git remote URL, e.g. https://github.com/owner/repo */
  url: string;
  /** Branch / tag / ref to clone. Empty = default branch (HEAD). */
  ref: string;
  /** CORS proxy used by isomorphic-git to reach the git host from the browser. */
  corsProxy: string;
  status: CloneStatus;
  /** Human-readable status / error message. */
  message: string;
  /** Root `folder` doc of the cloned repository, once cloning completes. */
  resultUrl?: AutomergeUrl;
  /** Display name of the cloned repo (root folder title). */
  resultTitle?: string;
  /** Number of files written in the last successful clone. */
  fileCount?: number;
  clonedAt?: number;
};

/** A `folder` document, compatible with Patchwork and pushwork. */
export type FolderDoc = {
  "@patchwork": { type: "folder" };
  title: string;
  docs: DocLink[];
  lastSyncAt?: number;
};

export type DocLink = {
  name: string;
  type: string;
  url: AutomergeUrl;
  icon?: string;
};

/** A `file` document, compatible with Patchwork's file datatype and pushwork. */
export type FileDoc = {
  "@patchwork": { type: "file" };
  content: string | Uint8Array | ImmutableString;
  extension: string;
  mimeType: string;
  name: string;
};
