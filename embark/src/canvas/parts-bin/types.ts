import type { AutomergeUrl } from "@automerge/automerge-repo";

// A parts bin holds a few example documents you can drag onto the canvas. Each
// entry is a document url plus the tool to preview it with; dragging an entry
// out drops a *clone*, so the example in the bin stays pristine.
export type PartsBinDoc = {
  "@patchwork": { type: "parts-bin" };
  title: string;
  items: PartsBinItem[];
};

export type PartsBinItem = {
  url: AutomergeUrl;
  // Which tool renders the in-bin preview (the host's default is used on drop).
  toolId?: string;
  // A user-editable display name for the example, shown on its token. Falls back
  // to the document's own title/type when unset.
  label?: string;
  // When true, this example drops onto the canvas as a frameless embed: no drag
  // border and no clipping, with the embedded tool providing its own chrome.
  frameless?: boolean;
};
