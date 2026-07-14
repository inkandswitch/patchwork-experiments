import type { AutomergeUrl } from "@automerge/automerge-repo";

// Legacy shape, kept only so old canvases that embed a parts-bin document
// still have a registered datatype. The bin's actual contents are code-defined
// now (see catalog.ts) and the items stored here are ignored.
export type PartsBinDoc = {
  "@patchwork": { type: "parts-bin" };
  title: string;
  items: PartsBinItem[];
};

export type PartsBinItem = {
  id: string;
  url?: AutomergeUrl;
  toolId?: string;
  label?: string;
  width?: number;
  height?: number;
};
