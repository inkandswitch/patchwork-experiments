import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useDocHandle, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import { registerContextElement } from "@embark/context";
import {
  getDragSource,
  hasDocumentDrag,
  type DocumentDragItem,
} from "../dnd";
import { rewriteClonedReferences } from "../deep-clone";
import { FRAMELESS_TOOLS } from "../tool-traits";
import type { PartsBinDoc, PartsBinItem } from "./types";
import "./parts-bin.css";

// Cap how tall a preview can grow. Content taller than this is scaled down so
// the whole thing stays visible as a thumbnail rather than being clipped. Kept
// in sync with the `max-height` fallback in parts-bin.css (used until the
// natural size is measured).
const MAX_PREVIEW_HEIGHT = 200;

// Whether a drag should be taken as a new bin example: any document drag
// except the bin's own drags, so dragging a token out and back is inert.
export function acceptsPartsBinDrop(
  dataTransfer: DataTransfer | null,
): boolean {
  return (
    hasDocumentDrag(dataTransfer) && getDragSource(dataTransfer) !== "parts-bin"
  );
}

// Append dropped documents to the bin. Shared by the drawer (old canvases)
// and the Cards sidebar panel, which own their drag handlers at different
// scopes but add items the same way.
export function addDroppedItems(
  handle: DocHandle<PartsBinDoc>,
  items: DocumentDragItem[],
): void {
  for (const item of items) {
    if (!item.url) continue;
    const url = item.url;
    handle.change((binDoc) => {
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
}

// The scrolling list of examples, wrapped in its own <patchwork-context> so
// the previews stay inert: every context host owns a self-contained, dead-end
// store, so a preview's search boxes, sticker sources, etc. neither read from
// nor write to the page-global body store. The boundary also swallows the
// previews' mount/unmount events so page-level listeners don't react to inert
// examples. Hosts wrap this in their own chrome (the canvas drawer, the Cards
// sidebar panel) and own their drop handlers, calling addDroppedItems.
export function PartsBinList(props: { handle: DocHandle<PartsBinDoc> }) {
  registerContextElement();
  const repo = useRepo();

  // Drive the list from a full snapshot reconciled on every change rather than
  // solid-automerge's fine-grained projection. That projection applies Automerge
  // *insert* patches incrementally (via cabbages) and can transiently duplicate
  // a freshly pushed array item — so a dropped example rendered twice until
  // reload. Reconciling the whole doc keeps the item count correct while still
  // preserving unchanged rows (and their live previews) by matching on `id`.
  const [doc, setDoc] = createStore<PartsBinDoc>(props.handle.doc());
  const syncFromHandle = () =>
    setDoc(reconcile(props.handle.doc(), { key: "id" }));
  props.handle.on("change", syncFromHandle);
  onCleanup(() => props.handle.off("change", syncFromHandle));

  const items = () => doc.items ?? [];

  // Keep the previews' mount/unmount events from escaping the bin: page-level
  // listeners (the frame's routing, the stickerable card's rescans) shouldn't
  // react to inert examples. Attached via ref — the namespaced event names
  // can't be written as JSX attributes.
  const stopMountEvent = (event: Event) => event.stopPropagation();
  const suppressMountEvents = (el: HTMLElement) => {
    el.addEventListener("patchwork:mounted", stopMountEvent);
    el.addEventListener("patchwork:unmounted", stopMountEvent);
    onCleanup(() => {
      el.removeEventListener("patchwork:mounted", stopMountEvent);
      el.removeEventListener("patchwork:unmounted", stopMountEvent);
    });
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
    <patchwork-context ref={suppressMountEvents}>
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
    </patchwork-context>
  );
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
  // Resolve the source handle up front (waits for ready) so dragstart — which
  // must write its payload synchronously — always has a loaded doc to clone
  // instead of falling back to sharing the original.
  const source = useDocHandle<unknown>(() => props.item.url);
  const [doc] = useDocument<NamedDoc>(() => props.item.url);

  // The stored label wins; otherwise fall back to the document's own title/type.
  const fallbackName = () => {
    const value = doc();
    return (
      value?.["@patchwork"]?.title ||
      value?.title ||
      value?.["@patchwork"]?.type ||
      "Untitled"
    );
  };
  const name = () => props.item.label || fallbackName();

  // A frameless tool brings its own chrome (a card its playing-card surface),
  // so the preview shows no wrapper border — only framed tools get one, the
  // same rule the canvas uses. The tool id wins, falling back to the doc's
  // datatype (which matches the tool id for these tools).
  const frameless = () => {
    const id = props.item.toolId ?? doc()?.["@patchwork"]?.type;
    return id !== undefined && FRAMELESS_TOOLS.has(id);
  };

  // Scale the preview down to a capped height so tall content (e.g. a
  // fixed-size card) reads as a whole thumbnail instead of being clipped. We
  // measure the natural layout height (unaffected by the CSS transform) and,
  // when it exceeds the cap, shrink by the fitting ratio; the wrapper collapses
  // to the resulting height.
  let naturalEl: HTMLDivElement | undefined;
  const [scale, setScale] = createSignal(1);
  const [previewHeight, setPreviewHeight] = createSignal<number | undefined>(
    undefined,
  );
  onMount(() => {
    const el = naturalEl;
    if (!el) return;
    const measure = () => {
      const natural = el.offsetHeight;
      if (natural <= 0) return;
      setScale(Math.min(1, MAX_PREVIEW_HEIGHT / natural));
      setPreviewHeight(Math.min(natural, MAX_PREVIEW_HEIGHT));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    onCleanup(() => observer.disconnect());
  });

  const onDragStart = (event: DragEvent) => {
    if (!event.dataTransfer) return;

    const handle = source();
    if (!handle) return;
    event.dataTransfer.effectAllowed = "copy";
    // Drop an independent copy so the example in the bin stays pristine. The
    // canvas decides framed vs. frameless from the dropped doc's tool, so the
    // payload only needs to carry the url. The root is cloned synchronously
    // (dragstart must write its payload before any await); the documents it
    // references (a card's behavior package, its spec and module files) are
    // then deep-cloned and re-pointed in the background, so the dragged-out
    // copy is fully independent — editing its spec never touches the bin's
    // example. The rewrite settles long before a drop resolves the references.
    const clone = props.repo.clone(handle);
    const url = clone.url;
    void rewriteClonedReferences(
      props.repo,
      clone,
      new Map([[handle.url, url]]),
    );
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
        classList={{ "embark-parts-bin__preview--framed": !frameless() }}
        draggable={true}
        title="Drag out to copy"
        style={
          previewHeight() !== undefined
            ? { height: `${previewHeight()}px` }
            : undefined
        }
        on:pointerdown={(event) => event.stopPropagation()}
        on:dragstart={onDragStart}
      >
        <div
          class="embark-parts-bin__preview-natural"
          ref={naturalEl}
          style={{ transform: `scale(${scale()})` }}
        >
          <patchwork-view
            doc-url={props.item.url}
            tool-id={props.item.toolId}
            hide-controls=""
          />
        </div>
      </div>
    </div>
  );
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
