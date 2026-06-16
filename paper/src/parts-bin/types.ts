import type { AutomergeUrl } from "@automerge/automerge-repo";

// A parts bin holds a few example documents you can drag onto a surface. Each
// entry is just a document url plus the tool to preview it with; dragging an
// entry out drops a *clone*, so the example in the bin stays pristine.
export type PartsBinDoc = {
  "@patchwork": { type: "parts-bin" };
  title: string;
  items: PartsBinItem[];
};

export type PartsBinItem = {
  url: AutomergeUrl;
  // Which tool renders the in-bin preview (the host's default is used on drop).
  toolId?: string;
};
