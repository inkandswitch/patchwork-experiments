import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { For, createSignal, onCleanup, onMount } from "solid-js";
import { useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import { registerContextElement } from "@embark/context";
import { rewriteClonedReferences } from "../deep-clone";
import { FRAMELESS_TOOLS } from "../tool-traits";
import type { BinEntry } from "./catalog";
import "./parts-bin.css";

// Cap how tall a preview can grow. Content taller than this is scaled down so
// the whole thing stays visible as a thumbnail rather than being clipped. Kept
// in sync with the `max-height` fallback in parts-bin.css (used until the
// natural size is measured).
const MAX_PREVIEW_HEIGHT = 200;

// The scrolling list of examples, wrapped in its own <patchwork-context> so
// the previews stay inert: every context host owns a self-contained, dead-end
// store, so a preview's search boxes, sticker sources, etc. neither read from
// nor write to the page-global body store. The boundary also swallows the
// previews' mount/unmount events so page-level listeners don't react to inert
// examples. The entries come from the code-defined catalog (see catalog.ts) —
// each row mints its own session-local preview document, so the bin always
// shows the currently shipped set. Hosts wrap this in their own chrome (the
// canvas drawer, the Cards sidebar panel, the card-stack tool).
export function PartsBinList(props: { entries: BinEntry[] }) {
  registerContextElement();
  const repo = useRepo();

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

  return (
    <patchwork-context ref={suppressMountEvents}>
      <div class="embark-parts-bin__list">
        <For each={props.entries}>
          {(entry) => <PartsBinRow repo={repo} entry={entry} />}
        </For>
      </div>
    </patchwork-context>
  );
}

function PartsBinRow(props: { repo: Repo; entry: BinEntry }) {
  // Mint this row's preview document for the session. Created synchronously,
  // so dragstart — which must write its payload before any await — always has
  // a loaded doc to clone.
  const handle = props.entry.create(props.repo);

  // A frameless tool brings its own chrome (a card its playing-card surface),
  // so the preview shows no wrapper border — only framed tools get one, the
  // same rule the canvas uses. The entry's tool id wins, falling back to the
  // minted doc's datatype (which matches the tool id for these tools).
  const frameless = () => {
    const id = props.entry.toolId ?? docType(handle);
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
    // size the catalog names (the canvas falls back to its default when unset).
    const item: {
      url: typeof url;
      width?: number;
      height?: number;
    } = {
      url,
      ...(props.entry.width !== undefined && { width: props.entry.width }),
      ...(props.entry.height !== undefined && { height: props.entry.height }),
    };
    event.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "parts-bin", items: [item] }),
    );
    event.dataTransfer.setData("text/x-patchwork-urls", JSON.stringify([url]));
    setDragToken(event, props.entry.label);
  };

  // A static headline above a non-interactive live preview that is the drag
  // source. The preview ghost is replaced by the title token (see onDragStart),
  // so its height is irrelevant. The preview stops pointerdown so the frameless
  // embed doesn't read it as a surface drag and the native HTML5 drag (which
  // the embed's preventDefault would kill) can start.
  return (
    <div class="embark-parts-bin__item">
      <div class="embark-parts-bin__label">{props.entry.label}</div>
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
            doc-url={handle.url}
            tool-id={props.entry.toolId}
            hide-controls=""
          />
        </div>
      </div>
    </div>
  );
}

// The freshly minted doc's datatype, used when the entry pins no tool id. The
// doc is available synchronously (it was just created) and its type never
// changes, so a plain read is fine.
function docType(handle: DocHandle<unknown>): string | undefined {
  const doc = handle.doc() as
    | { "@patchwork"?: { type?: string } }
    | undefined;
  return doc?.["@patchwork"]?.type;
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
