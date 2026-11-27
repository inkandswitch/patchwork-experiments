import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo/slim";

// Asked by the panel to find the folder the provider above it is laying.
export const FOLDER_SELECTOR = "patch-layers:folder";

// Asked by editors: whether to highlight what patches change, and each laid
// patch's colours and name.
export const HIGHLIGHTS_SELECTOR = "patchwork:patch-highlights";

export type PatchHighlights = {
  on: boolean;
  patches: Record<string, { fill: string; wash: string; name: string }>;
};

const STORAGE_KEY = "patchwork:patch-layers-folder";

export type PatchLink = {
  name: string;
  type: "patch";
  url: AutomergeUrl;
  /** Kept in the stack, but not laid. */
  off?: boolean;
};

/**
 * The folder of patches this browser lays, later ones in front. A link marked
 * `off` keeps its place but isn't laid. It's an ordinary folder doc, so it can
 * be opened (or dropped in the sidebar) like any other.
 */
export type PatchFolder = {
  "@patchwork"?: { type: "folder" };
  title: string;
  docs: PatchLink[];
  /** Editors highlight what the laid patches change. */
  highlight?: boolean;
  /** Older folders kept switched-off patches here; the panel moves them. */
  shelved?: PatchLink[];
};

let folder: Promise<AutomergeUrl> | undefined;

export function patchFolder(repo: Repo): Promise<AutomergeUrl> {
  folder ??= (async () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage blocked: make a fresh folder each session */
    }
    if (saved && isValidAutomergeUrl(saved)) return saved;
    const handle = repo.create<PatchFolder>({
      "@patchwork": { type: "folder" },
      title: "Patches",
      docs: [],
    });
    try {
      localStorage.setItem(STORAGE_KEY, handle.url);
    } catch {
      /* see above */
    }
    return handle.url;
  })();
  return folder;
}
