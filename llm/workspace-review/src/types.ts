import type { AutomergeUrl } from "@automerge/automerge-repo";

// --- WorkspaceDoc schema (same as code-llm) ---

export type WorkspaceDoc = {
  "@patchwork": { type: "workspace" };
  rootFolderUrl: AutomergeUrl;
  mappings: Record<string, AutomergeUrl>; // originalUrl → clonedUrl
  linkedUrls: AutomergeUrl[]; // docs linked into workspace (not created) — excluded from changeset unless modified
};

// --- Changeset types ---

export type FileChange = {
  path: string;
  changeType: "modified" | "added" | "deleted";
  originalContent?: string;
  modifiedContent?: string;
  originalUrl?: AutomergeUrl;
  cloneUrl?: AutomergeUrl;
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
