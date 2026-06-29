import type { AutomergeUrl } from "@automerge/automerge-repo";

// A parts bin holds a few examples you can drag onto the canvas. Each entry is
// either a document (previewed with a tool) or a standalone
// `patchwork:component` (referenced by url). Dragging a document entry out drops
// a *clone* so the example stays pristine; a component entry drops a reference to
// the shared, head-less module url.
export type PartsBinDoc = {
  "@patchwork": { type: "parts-bin" };
  title: string;
  items: PartsBinItem[];
};

export type PartsBinItem = {
  // Stable per-item identity, used to reconcile rows across changes (component
  // items have no url to key on). Assigned when the item is seeded or dropped.
  id: string;
  // A document entry points at an automerge document...
  url?: AutomergeUrl;
  // ...or a component entry points at a standalone component module (a stable,
  // head-less url). Exactly one of `url` / `componentUrl` is set.
  componentUrl?: string;
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
