import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import {
  registerContextElement,
  type PatchworkContextElement,
} from "@embark/context";
import { renderComponentEmbed } from "../component-embed";
import { getDocumentDragPayload, getDragSource, hasDocumentDrag } from "../dnd";
import type { PartsBinDoc, PartsBinItem } from "./types";
import "./parts-bin.css";

// A palette of example documents. Each row shows an editable headline above a
// non-interactive live preview; dragging that preview writes the standard
// Patchwork drag payload (see the drag-and-drop recipe) so the canvas can drop
// it as an embed. The payload points at a clone, so the example stays editable
// in place.
export const PartsBinTool: ToolRender = (handle, element) => {
  // Host a local context and render the previews into it. Context discovery
  // resolves to the nearest <patchwork-context> (which stops the request), so
  // the previews' search boxes, sticker sources, etc. find this throwaway store
  // instead of the live canvas one — the bin's contents are examples, not
  // active participants in the canvas. Nothing answers their queries here, so
  // they stay inert.
  registerContextElement();
  const contextEl = document.createElement(
    "patchwork-context",
  ) as PatchworkContextElement;
  element.appendChild(contextEl);

  // Keep the previews' mount/unmount events from reaching the canvas: the
  // schema resolver watches these, and the bin's examples shouldn't show up as
  // matches.
  const stopMountEvent = (event: Event) => event.stopPropagation();
  element.addEventListener("patchwork:mounted", stopMountEvent);
  element.addEventListener("patchwork:unmounted", stopMountEvent);

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PartsBin handle={handle as DocHandle<PartsBinDoc>} />
      </RepoContext.Provider>
    ),
    contextEl,
  );

  return () => {
    element.removeEventListener("patchwork:mounted", stopMountEvent);
    element.removeEventListener("patchwork:unmounted", stopMountEvent);
    dispose();
    contextEl.remove();
  };
};

// The bin renders as a drawer pinned to the canvas's left edge: a vertical tab
// is always visible, and clicking it slides the panel of examples out to the
// side. Open/closed is per-view chrome state, so it persists to localStorage
// rather than syncing into the shared document.
function PartsBin(props: { handle: DocHandle<PartsBinDoc> }) {
  const repo = useRepo();
  // Drive the list from a full snapshot reconciled on every change rather than
  // solid-automerge's fine-grained projection. That projection applies Automerge
  // *insert* patches incrementally (via cabbages) and can transiently duplicate
  // a freshly pushed array item — so a dropped example rendered twice until
  // reload. Reconciling the whole doc keeps the item count correct while still
  // preserving unchanged rows (and their live previews) by matching on `url`.
  const [doc, setDoc] = createStore<PartsBinDoc>(props.handle.doc());
  const syncFromHandle = () =>
    setDoc(reconcile(props.handle.doc(), { key: "id" }));
  props.handle.on("change", syncFromHandle);
  onCleanup(() => props.handle.off("change", syncFromHandle));

  const items = () => doc.items ?? [];
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
  const acceptsDrop = (dataTransfer: DataTransfer | null) =>
    hasDocumentDrag(dataTransfer) &&
    getDragSource(dataTransfer) !== "parts-bin";

  const onDragOver = (event: DragEvent) => {
    if (!acceptsDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
    // Slide the panel out so the drop zone is visible even if the drawer was
    // closed when the drag reached the tab.
    setOpen(true);
  };

  const onDragLeave = () => setDragOver(false);

  const onDrop = (event: DragEvent) => {
    if (!acceptsDrop(event.dataTransfer)) return;
    event.preventDefault();
    // Tell the source this was a copy: it keeps the original and springs back.
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(false);
    // Read the payload synchronously, before any await — a real drop clears the
    // DataTransfer once the handler yields.
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    for (const item of payload) {
      // Component items have no document — store the (shared, head-less) url as
      // an example directly, no cloning.
      if (item.componentUrl) {
        const componentUrl = item.componentUrl;
        props.handle.change((binDoc) => {
          binDoc.items.push({
            id: crypto.randomUUID(),
            componentUrl,
            ...(item.toolId !== undefined && { toolId: item.toolId }),
            ...(item.width !== undefined && { width: item.width }),
            ...(item.height !== undefined && { height: item.height }),
          });
        });
        continue;
      }
      if (!item.url) continue;
      const url = item.url;
      props.handle.change((binDoc) => {
        // Automerge rejects explicit `undefined`, so only set optional fields
        // the drag actually carried.
        binDoc.items.push({
          id: crypto.randomUUID(),
          url,
          ...(item.toolId !== undefined && { toolId: item.toolId }),
          ...(item.width !== undefined && { width: item.width }),
          ...(item.height !== undefined && { height: item.height }),
        });
      });
    }
  };

  // Smoothly scroll the list to the newest entry. The new row's
  // <patchwork-view> reports its height a few frames later, so re-pin once after
  // it settles to make sure the whole entry lands in view.
  let listEl: HTMLDivElement | undefined;
  const scrollListToBottom = () => {
    const el = listEl;
    if (!el) return;
    const toBottom = () =>
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    requestAnimationFrame(toBottom);
    setTimeout(toBottom, 300);
  };

  // Animate to the bottom whenever an item is added (e.g. an embed dragged into
  // the bin) so the fresh entry slides into view. We capture the count on the
  // first load instead of scrolling, so only real additions trigger it.
  let knownCount = -1;
  createEffect(() => {
    const count = items().length;
    if (knownCount < 0) {
      knownCount = count;
      return;
    }
    if (count > knownCount) scrollListToBottom();
    knownCount = count;
  });

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
          <div class="embark-parts-bin__list" ref={listEl}>
            <For each={items()}>
              {(item, index) => (
                <PartsBinRow
                  repo={repo}
                  item={item}
                  onRemove={() =>
                    props.handle.change((binDoc) => {
                      binDoc.items.splice(index(), 1);
                    })
                  }
                  onRename={(label) =>
                    props.handle.change((binDoc) => {
                      const entry = binDoc.items[index()];
                      if (!entry) return;
                      if (label) entry.label = label;
                      else delete entry.label;
                    })
                  }
                />
              )}
            </For>
          </div>
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
            {doc.title ?? "Parts bin"}
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

// A document whose name we want to show on the token. Patchwork keeps the
// display title under `@patchwork.title`; some datatypes also mirror it at the
// root, and we fall back to the type or a generic label.
type NamedDoc = {
  "@patchwork"?: { title?: string; type?: string };
  title?: string;
};

function PartsBinRow(props: {
  repo: Repo;
  item: PartsBinItem;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const isComponent = () => Boolean(props.item.componentUrl);

  // Resolve the source handle up front (waits for ready) so dragstart — which
  // must write its payload synchronously — always has a loaded doc to clone
  // instead of falling back to sharing the original. Component items have no
  // document, so these stay inert for them.
  const source = useDocHandle<unknown>(() => props.item.url);
  const [doc] = useDocument<NamedDoc>(() => props.item.url);

  // The stored label wins; otherwise fall back to the document's own title/type
  // (component items have no document, so they fall back to a generic name).
  const fallbackName = () => {
    if (isComponent()) return "Component";
    const value = doc();
    return (
      value?.["@patchwork"]?.title ||
      value?.title ||
      value?.["@patchwork"]?.type ||
      "Untitled"
    );
  };
  const name = () => props.item.label || fallbackName();

  const onDragStart = (event: DragEvent) => {
    if (!event.dataTransfer) return;

    // A component item drops a reference to its shared, head-less url — no
    // cloning, no document. The canvas imports and runs it directly.
    if (props.item.componentUrl) {
      event.dataTransfer.effectAllowed = "copy";
      const item: {
        componentUrl: string;
        toolId?: string;
        width?: number;
        height?: number;
      } = {
        componentUrl: props.item.componentUrl,
        ...(props.item.toolId !== undefined && { toolId: props.item.toolId }),
        ...(props.item.width !== undefined && { width: props.item.width }),
        ...(props.item.height !== undefined && { height: props.item.height }),
      };
      event.dataTransfer.setData(
        "text/x-patchwork-dnd",
        JSON.stringify({ source: "parts-bin", items: [item] }),
      );
      setDragToken(event, name());
      return;
    }

    const handle = source();
    if (!handle) return;
    event.dataTransfer.effectAllowed = "copy";
    // Drop an independent copy so the example in the bin stays pristine. The
    // canvas decides framed vs. frameless from the dropped doc's tool, so the
    // payload only needs to carry the url.
    const url = props.repo.clone(handle).url;
    // Carry the recorded footprint so the canvas recreates this example at the
    // size it was captured at (the canvas falls back to its default when unset).
    const item: {
      url: typeof url;
      width?: number;
      height?: number;
    } = {
      url,
      ...(props.item.width !== undefined && { width: props.item.width }),
      ...(props.item.height !== undefined && { height: props.item.height }),
    };
    event.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "parts-bin", items: [item] }),
    );
    event.dataTransfer.setData("text/x-patchwork-urls", JSON.stringify([url]));
    setDragToken(event, name());
  };

  // An editable headline with a hover-revealed delete action, above a
  // non-interactive live preview that is the drag source. The preview ghost is
  // replaced by the title token (see onDragStart), so its height is irrelevant.
  // Interactive bits stop pointerdown so the frameless embed doesn't read them
  // as a surface drag — the input can focus, the button can click, and the
  // preview's native HTML5 drag (which the embed's preventDefault would kill)
  // can start.
  return (
    <div class="embark-parts-bin__item">
      <div class="embark-parts-bin__head">
        <input
          class="embark-parts-bin__name"
          value={name()}
          placeholder={fallbackName()}
          title="Rename this example"
          on:pointerdown={(event) => event.stopPropagation()}
          on:change={(event) =>
            props.onRename(event.currentTarget.value.trim())
          }
        />
        <button
          type="button"
          class="embark-parts-bin__delete"
          title="Remove from parts bin"
          aria-label="Remove from parts bin"
          on:pointerdown={(event) => event.stopPropagation()}
          on:click={() => props.onRemove()}
        >
          <CloseIcon />
        </button>
      </div>
      <div
        class="embark-parts-bin__preview"
        draggable={true}
        title="Drag onto the canvas to copy"
        on:pointerdown={(event) => event.stopPropagation()}
        on:dragstart={onDragStart}
      >
        <Show
          when={props.item.componentUrl}
          fallback={
            <patchwork-view
              doc-url={props.item.url}
              tool-id={props.item.toolId}
              hide-controls=""
            />
          }
        >
          {(componentUrl) => <ComponentPreview componentUrl={componentUrl()} />}
        </Show>
      </div>
    </div>
  );
}

// A non-interactive live preview of a component example: a host div that imports
// and runs the component module (against the bin's throwaway context, so its
// provider logic stays inert). renderComponentEmbed stamps `repo` on the host.
function ComponentPreview(props: { componentUrl: string }) {
  const repo = useRepo();
  let hostEl: HTMLDivElement | undefined;
  onMount(() => {
    const host = hostEl;
    if (!host) return;
    const dispose = renderComponentEmbed(host, props.componentUrl, repo);
    onCleanup(dispose);
  });
  return <div ref={hostEl} class="embark-parts-bin__component" />;
}

// Use a small title token as the drag image instead of the browser's snapshot of
// the live preview (whose full height bled into the ghost). The token must be in
// the document when captured, then removed next tick.
function setDragToken(event: DragEvent, label: string): void {
  const token = document.createElement("div");
  token.className = "embark-parts-bin__drag-token";
  token.textContent = label;
  document.body.appendChild(token);
  event.dataTransfer?.setDragImage(token, 12, 12);
  setTimeout(() => token.remove(), 0);
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

// Thin "x" glyph for the delete button; inherits the button's text color.
function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
