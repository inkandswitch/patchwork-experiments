import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

export interface PatchworkToolProps<T> {
  handle: DocHandle<T>;
  repo: Repo;
  element: PatchworkViewElement;
}

/**
 * The tool can be mounted against a folder document directly, or against an
 * account document — in which case we follow `rootFolderUrl` to find the tree
 * to render.
 */
export type AccountLikeDoc = {
  rootFolderUrl?: AutomergeUrl;
};
