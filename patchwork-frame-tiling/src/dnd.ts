/**
 * Patchwork's cross-tool drag and drop is a MIME-type convention (no central
 * bus). We emit the shapes existing drop targets (sideboard, folder, paper,
 * space, the markdown embed extension, …) read:
 *
 *  - `text/x-patchwork-dnd`  → `{ source, items: [{ url, name?, type?, toolId? }] }`
 *  - `text/x-patchwork-urls` → `[url, …]`
 *  - `text/uri-list`         → a web link (`…/#doc=<id>`), so canvases that only
 *    read links accept it and Chrome treats the drag as a link
 *  - `text/plain`            → the raw automerge URL (universal fallback)
 *
 * Copied from patchwork-experiments/universal-dnd's `dnd.ts`.
 */
export interface PatchworkDndItem {
  url: string;
  name?: string;
  /** Datatype id (`@patchwork.type`), if known. */
  type?: string;
  /** The tool this panel was rendering it with. */
  toolId?: string;
}

const webLinkFor = (url: string): string | null => {
  const id = url.replace(/^automerge:/, "").split(/[?#/]/)[0];
  if (!id) return null;
  try {
    return `${location.origin}/#doc=${id}`;
  } catch {
    return null;
  }
};

export function setPatchworkDragData(
  dt: DataTransfer,
  item: PatchworkDndItem,
  source: string,
): void {
  dt.setData("text/x-patchwork-dnd", JSON.stringify({ source, items: [item] }));
  dt.setData("text/x-patchwork-urls", JSON.stringify([item.url]));
  const link = webLinkFor(item.url);
  if (link) dt.setData("text/uri-list", `${link}\r\n`);
  dt.setData("text/plain", item.url);
  // copy, move and link: link is what lets Chrome offer split view when the
  // doc is dragged out of the app.
  dt.effectAllowed = "all";
}
