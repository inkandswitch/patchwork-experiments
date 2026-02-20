import type { AutomergeUrl } from "@automerge/automerge-repo";

// --- WorkspaceDoc schema (same as code-llm) ---

export type MappingEntry = {
  cloneUrl: AutomergeUrl;
  originalUrlWithHeads: AutomergeUrl; // original URL with heads at clone time baked in
};

export type WorkspaceDoc = {
  "@patchwork": { type: "workspace" };
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, MappingEntry>; // originalUrl → { cloneUrl, originalUrlWithHeads }
  createdUrls: AutomergeUrl[]; // new files created by the agent — shown as "added" in changeset
};

// --- Changeset types ---

export type FileChange = {
  path: string;
  oldPath?: string; // previous path (set only on moves)
  changeType: "modified" | "added" | "deleted" | "moved" | "unchanged";
  docType: string; // @patchwork.type of the document (e.g. "file", "tldraw", etc.)
  originalContent?: string;
  modifiedContent?: string;
  originalUrl?: AutomergeUrl;
  cloneUrl?: AutomergeUrl;
  originalUrlWithHeads?: AutomergeUrl; // original URL with heads at clone time baked in
};

export type DiffLine = {
  type: "unchanged" | "added" | "removed" | "spacer";
  oldLineNo?: number;
  newLineNo?: number;
  content: string;
};

export type DiffRow = {
  left: DiffLine;
  right: DiffLine;
};
