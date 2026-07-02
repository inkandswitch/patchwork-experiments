import type { AutomergeUrl } from "@automerge/automerge-repo";

// A parts bin holds a few examples you can drag onto the canvas. Each entry is a
// document previewed with a tool. Dragging an entry out drops a *clone* so the
// example stays pristine.
export type PartsBinDoc = {
  "@patchwork": { type: "parts-bin" };
  title: string;
  items: PartsBinItem[];
};

export type PartsBinItem = {
  // Stable per-item identity, used to reconcile rows across changes. Assigned
  // when the item is seeded or dropped.
  id: string;
  // A document entry points at an automerge document.
  url?: AutomergeUrl;
  // Which tool renders the in-bin preview (the host's default is used on drop).
  toolId?: string;
  // A user-editable display name for the example, shown on its token. Falls back
  // to the document's own title/type when unset.
  label?: string;
  // The canvas footprint to recreate when this example is dropped. Recorded
  // from an embed dragged into the bin; when unset the canvas default is used.
  width?: number;
  height?: number;
};
