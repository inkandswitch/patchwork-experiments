import type { AutomergeUrl } from "@automerge/automerge-repo";

// A folder doc (patchwork filesystem "folder" strategy): a list of named child
// docs. The service worker matches a path segment against `docs[].name` and
// follows the link. `lastSyncAt` is a free field bumped to advance the folder's
// heads (cache-busting) without changing any file.
export type FolderDoc = {
  "@patchwork": { type: "folder"; title?: string };
  title: string;
  docs: DocLink[];
  lastSyncAt?: number;
};

// One entry in a folder's `docs` list, pointing at a child doc by url.
export type DocLink = {
  name: string;
  type: string;
  url: AutomergeUrl;
};
