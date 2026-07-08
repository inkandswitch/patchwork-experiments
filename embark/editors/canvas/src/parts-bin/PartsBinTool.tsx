import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import { getDocumentDragPayload } from "../dnd";
import {
  PartsBinList,
  acceptsPartsBinDrop,
  addDroppedItems,
} from "./PartsBinList";
import type { PartsBinDoc } from "./types";
import "./parts-bin.css";

// A palette of example documents. Each row shows an editable headline above a
// non-interactive live preview; dragging that preview writes the standard
// Patchwork drag payload (see the drag-and-drop recipe) so the canvas can drop
// it as an embed. The payload points at a clone, so the example stays editable
// in place. This drawer face survives for old canvases that still carry a
// parts-bin embed; new bins live in the Cards sidebar (see ../card-stack).
export const PartsBinTool: ToolRender = (handle, element) =>
  render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PartsBinDrawer handle={handle as DocHandle<PartsBinDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

// The bin renders as a drawer pinned to the canvas's left edge: a vertical tab
// is always visible, and clicking it slides the panel of examples out to the
// side. Open/closed is per-view chrome state, so it persists to localStorage
// rather than syncing into the shared document. The examples themselves — and
// the <patchwork-context> boundary that keeps them inert — live in
// PartsBinList, shared with the Cards sidebar.
function PartsBinDrawer(props: { handle: DocHandle<PartsBinDoc> }) {
  const [doc] = useDocument<PartsBinDoc>(() => props.handle.url);

  // Open/closed is per-view chrome, persisted to localStorage so the drawer
  // restores to however it was last left on the next load.
  const [open, setOpen] = createSignal(readStoredOpen());
  createEffect(() => writeStoredOpen(open()));
  const [dragOver, setDragOver] = createSignal(false);

  // The bin doubles as a drop target: dropping a canvas embed (or any document)
  // onto it adds the document as a new example (a reference — drag-out clones it
  // so the bin's copy stays pristine). Canvas embeds arrive as synthetic DnD
  // events dispatched by the embed being dragged; external document drags flow
  // through the same handlers. We ignore the bin's own example drags (source
  // "parts-bin") so dragging a token out and back is inert.
  const onDragOver = (event: DragEvent) => {
    if (!acceptsPartsBinDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
    // Slide the panel out so the drop zone is visible even if the drawer was
    // closed when the drag reached the tab.
    setOpen(true);
  };

  const onDragLeave = () => setDragOver(false);

  const onDrop = (event: DragEvent) => {
    if (!acceptsPartsBinDrop(event.dataTransfer)) return;
    event.preventDefault();
    // Tell the source this was a copy: it keeps the original and springs back.
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(false);
    // Read the payload synchronously, before any await — a real drop clears the
    // DataTransfer once the handler yields.
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    addDroppedItems(props.handle, payload);
  };

  return (
    <div
      class="embark-parts-bin"
      classList={{
        "embark-parts-bin--open": open(),
        "embark-parts-bin--drag-over": dragOver(),
      }}
      on:dragover={onDragOver}
      on:dragleave={onDragLeave}
      on:drop={onDrop}
    >
      <div class="embark-parts-bin__drawer">
        <div class="embark-parts-bin__panel">
          <PartsBinList handle={props.handle} />
        </div>
        <button
          type="button"
          class="embark-parts-bin__tab"
          title={open() ? "Close drawer" : "Open drawer"}
          aria-expanded={open()}
          // Keep the press off the canvas surface so it can't be read as a drag;
          // a plain click toggles the drawer.
          on:pointerdown={(event) => event.stopPropagation()}
          on:click={() => setOpen((value) => !value)}
        >
          <ChevronIcon open={open()} />
          <span class="embark-parts-bin__tab-label">
            {doc()?.title ?? "Parts bin"}
          </span>
        </button>
      </div>
    </div>
  );
}

// Persisted open/closed preference. A single global key (the bin is browser-
// local chrome, not document state), defaulting to open when nothing is stored
// or storage is unavailable (private mode, disabled).
const OPEN_STORAGE_KEY = "embark:parts-bin:open";

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, String(open));
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}

// Caret on the drawer tab: points right when closed ("pull out this way") and
// flips to point left when open. Inherits the tab's text color.
function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      class="embark-parts-bin__chevron"
      classList={{ "embark-parts-bin__chevron--open": props.open }}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
