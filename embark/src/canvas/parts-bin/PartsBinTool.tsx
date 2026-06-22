import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { SubscribeEvent } from "@inkandswitch/patchwork-providers";
import { For } from "solid-js";
import { render } from "solid-js/web";
import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import {
  QUERY_SELECTOR,
  RESPONSES_SELECTOR,
} from "../providers/SearchProvider";
import type { PartsBinDoc, PartsBinItem } from "./types";
import "./parts-bin.css";
import { MATCHES_SELECTOR } from "../providers/SchemaMatchProvider";
import { STICKERS_ON_DOCUMENT, STICKERS_REGISTRY } from "../../stickers/types";

// Selectors the bin must isolate. The previews are live documents, so the
// search box / POI provider / sticker sources rendered inside them dispatch
// `patchwork:subscribe` for these. We can't blanket-stop every subscribe (that
// breaks the providers the previews legitimately rely on, e.g.
// `<patchwork-view>`'s own repo lookups), so for now we hard-code the known
// canvas-broker selectors. Isolating `stickers:registry` in particular keeps a
// previewed sticker source from publishing onto the live canvas's documents.
const ISOLATED_SELECTORS = new Set<string>([
  QUERY_SELECTOR,
  RESPONSES_SELECTOR,
  MATCHES_SELECTOR,
  STICKERS_ON_DOCUMENT,
  STICKERS_REGISTRY,
]);

// A palette of example documents. Each row shows an editable headline above a
// non-interactive live preview; dragging that preview writes the standard
// Patchwork drag payload (see the drag-and-drop recipe) so the canvas can drop
// it as an embed. The payload points at a clone, so the example stays editable
// in place.
export const PartsBinTool: ToolRender = (handle, element) => {
  // Stop the search-related subscriptions at the bin's root so they never reach
  // the canvas search broker — the bin's contents are examples, not active
  // participants in the canvas. Everything else propagates as normal.
  const stopSubscribe = (event: SubscribeEvent) => {
    if (ISOLATED_SELECTORS.has(event.detail.selector.type)) {
      event.stopPropagation();
    }
  };
  element.addEventListener("patchwork:subscribe", stopSubscribe);

  // Likewise keep the previews' mount/unmount events from reaching the canvas:
  // the schema-match provider watches these, and the bin's examples shouldn't
  // show up as matches.
  const stopMountEvent = (event: Event) => event.stopPropagation();
  element.addEventListener("patchwork:mounted", stopMountEvent);
  element.addEventListener("patchwork:unmounted", stopMountEvent);

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PartsBin handle={handle as DocHandle<PartsBinDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => {
    element.removeEventListener("patchwork:subscribe", stopSubscribe);
    element.removeEventListener("patchwork:mounted", stopMountEvent);
    element.removeEventListener("patchwork:unmounted", stopMountEvent);
    dispose();
  };
};

function PartsBin(props: { handle: DocHandle<PartsBinDoc> }) {
  const repo = useRepo();
  const [doc] = useDocument<PartsBinDoc>(() => props.handle.url);
  const items = () => doc()?.items ?? [];

  return (
    <div class="embark-parts-bin">
      <div class="embark-parts-bin__header">{doc()?.title ?? "Parts bin"}</div>
      <div class="embark-parts-bin__list">
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
              onToggleFrameless={() =>
                props.handle.change((binDoc) => {
                  const entry = binDoc.items[index()];
                  if (!entry) return;
                  if (entry.frameless) delete entry.frameless;
                  else entry.frameless = true;
                })
              }
            />
          )}
        </For>
      </div>
    </div>
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
  onToggleFrameless: () => void;
}) {
  // Resolve the source handle up front (waits for ready) so dragstart — which
  // must write its payload synchronously — always has a loaded doc to clone
  // instead of falling back to sharing the original.
  const source = useDocHandle<unknown>(() => props.item.url);
  const [doc] = useDocument<NamedDoc>(() => props.item.url);

  // The stored label wins; otherwise fall back to the document's own
  // title/type so a fresh example still reads sensibly.
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

  const onDragStart = (event: DragEvent) => {
    const handle = source();
    if (!event.dataTransfer || !handle) return;
    event.dataTransfer.effectAllowed = "copy";
    // Drop an independent copy so the example in the bin stays pristine. Carry
    // the frameless choice in the rich payload so the canvas drops it framed or
    // frameless to match this example.
    const url = props.repo.clone(handle).url;
    const item = { url, ...(props.item.frameless ? { frameless: true } : {}) };
    event.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "parts-bin", items: [item] }),
    );
    event.dataTransfer.setData("text/x-patchwork-urls", JSON.stringify([url]));

    // Use a small title token as the drag image instead of the browser's
    // snapshot of the live preview (whose full height bled into the ghost). The
    // token must be in the document when captured, then removed next tick.
    const token = document.createElement("div");
    token.className = "embark-parts-bin__drag-token";
    token.textContent = name();
    document.body.appendChild(token);
    event.dataTransfer.setDragImage(token, 12, 12);
    setTimeout(() => token.remove(), 0);
  };

  // An editable headline with hover-revealed frame/delete actions, above a
  // non-interactive live preview that is the drag source. The preview ghost is
  // replaced by the title token (see onDragStart), so its height is irrelevant.
  return (
    <div class="embark-parts-bin__item">
      <div class="embark-parts-bin__head">
        <input
          class="embark-parts-bin__name"
          value={name()}
          placeholder={fallbackName()}
          title="Rename this example"
          on:change={(event) => props.onRename(event.currentTarget.value.trim())}
        />
        <button
          type="button"
          class="embark-parts-bin__frame"
          classList={{
            "embark-parts-bin__frame--off": props.item.frameless === true,
          }}
          title={
            props.item.frameless
              ? "Drops without a frame — click to add one"
              : "Drops with a frame — click to remove it"
          }
          aria-label="Toggle frame on drop"
          aria-pressed={props.item.frameless === true}
          on:click={() => props.onToggleFrameless()}
        >
          <FrameIcon off={props.item.frameless === true} />
        </button>
        <button
          type="button"
          class="embark-parts-bin__delete"
          title="Remove from parts bin"
          aria-label="Remove from parts bin"
          on:click={() => props.onRemove()}
        >
          <CloseIcon />
        </button>
      </div>
      <div
        class="embark-parts-bin__preview"
        draggable={true}
        title="Drag onto the canvas to copy"
        on:dragstart={onDragStart}
      >
        <patchwork-view
          doc-url={props.item.url}
          tool-id={props.item.toolId}
          hide-controls=""
        />
      </div>
    </div>
  );
}

// Frame glyph for the frame toggle: a solid rounded rect when framed, a dashed
// one when the example drops frameless. Inherits the button's text color.
function FrameIcon(props: { off: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-dasharray={props.off ? "4 3" : undefined}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
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
