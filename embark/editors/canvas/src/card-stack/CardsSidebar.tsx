import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { useDocHandle, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import { getDocumentDragPayload, hasDocumentDrag, type DocumentDragItem } from "../dnd";
import { AUTOSIZE_TOOLS, FRAMELESS_TOOLS } from "../tool-traits";
import {
  PartsBinList,
  acceptsPartsBinDrop,
  addDroppedItems,
} from "../parts-bin/PartsBinList";
import type { PartsBinDoc } from "../parts-bin/types";
import type { CardStackDoc, WithCardStack } from "./types";
import "./cards-sidebar.css";

// Default row body height for tools that don't report their own size (cards
// and decks shrink-wrap instead — see AUTOSIZE_TOOLS).
const DEFAULT_ROW_HEIGHT = 260;

// The Cards sidebar, laid out per the sketch: a vertical tab rail on the left
// edge (Global / Current Doc), the active tab's card stack in the middle, and
// the parts bin as a fixed right column that collapses behind a chevron on
// the divider.
//
// Both stacks stay mounted whichever tab is showing (the inactive pane is
// hidden, not unmounted), and the whole sidebar keeps running while parked on
// document.body (see host.tsx) — so cards keep doing their page-wide work
// with the sidebar closed. Cards here are *live*: they mount on the
// page-global body store. Only the parts bin previews are inert, behind their
// own <patchwork-context> boundary (see PartsBinList).
export function CardsSidebar(props: {
  globalStack: DocHandle<CardStackDoc>;
  partsBin: DocHandle<PartsBinDoc>;
  selectedDoc: Accessor<AutomergeUrl | undefined>;
}) {
  const repo = useRepo();

  // Which tab shows, and whether the bin is expanded: per-browser chrome
  // state, persisted to localStorage.
  const [tab, setTab] = createSignal<TabId>(readStoredTab());
  createEffect(() => writeStoredTab(tab()));
  const [binOpen, setBinOpen] = createSignal(readStoredBinOpen());
  createEffect(() => writeStoredBinOpen(binOpen()));

  // The current document's stack, resolved through its metadata link. The
  // handle for the selected doc itself is kept warm so a first drop can mint
  // and link a stack synchronously off the already-loaded doc.
  const selectedHandle = useDocHandle<WithCardStack>(() => props.selectedDoc());
  const [selectedSnapshot] = useDocument<WithCardStack>(() =>
    props.selectedDoc(),
  );
  const currentStackUrl = () => {
    const url = selectedSnapshot()?.["@patchwork"]?.cardStackUrl;
    return url && isValidAutomergeUrl(url) ? url : undefined;
  };
  const currentStack = useDocHandle<CardStackDoc>(() => currentStackUrl());

  // Add dropped documents to the current doc's stack, minting and linking the
  // stack on first use. Re-reads the link off the live doc first: another
  // client may have linked a stack since our snapshot.
  const dropOnCurrent = (items: DocumentDragItem[]) => {
    const docHandle = selectedHandle();
    if (!docHandle) return;
    let stack = currentStack();
    if (!stack) {
      const linked = docHandle.doc()?.["@patchwork"]?.cardStackUrl;
      if (linked && isValidAutomergeUrl(linked)) {
        // A linked stack exists but its handle hasn't resolved here yet; the
        // drop would race it. Rare enough to just ignore the drop.
        return;
      }
      stack = repo.create<CardStackDoc>({
        "@patchwork": { type: "card-stack" },
        title: "Cards",
        cards: [],
      });
      docHandle.change((doc) => {
        const meta = doc["@patchwork"];
        if (meta) meta.cardStackUrl = stack!.url;
        else doc["@patchwork"] = { cardStackUrl: stack!.url };
      });
    }
    appendEntries(stack, items);
  };

  return (
    <div class="embark-cards" classList={{ "embark-cards--bin-open": binOpen() }}>
      <div class="embark-cards__rail">
        <TabButton
          label="Global"
          active={tab() === "global"}
          onSelect={() => setTab("global")}
        />
        <TabButton
          label="Current Doc"
          active={tab() === "current"}
          onSelect={() => setTab("current")}
        />
      </div>

      <div class="embark-cards__main">
        <StackPane
          active={tab() === "global"}
          stack={props.globalStack}
          emptyHint="Drag cards here to run them everywhere"
          onDropItems={(items) => appendEntries(props.globalStack, items)}
        />
        <StackPane
          active={tab() === "current"}
          stack={currentStack()}
          emptyHint={
            props.selectedDoc()
              ? "Drag cards here to attach them to this document"
              : "No document open"
          }
          droppable={props.selectedDoc() !== undefined}
          onDropItems={dropOnCurrent}
        />
      </div>

      <div class="embark-cards__divider">
        <button
          type="button"
          class="embark-cards__bin-toggle"
          title={binOpen() ? "Collapse parts bin" : "Expand parts bin"}
          aria-expanded={binOpen()}
          on:click={() => setBinOpen((value) => !value)}
        >
          <ChevronIcon open={binOpen()} />
        </button>
      </div>

      <BinPanel handle={props.partsBin} open={binOpen()} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = "global" | "current";

function TabButton(props: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class="embark-cards__tab"
      classList={{ "embark-cards__tab--active": props.active }}
      aria-selected={props.active}
      on:click={() => props.onSelect()}
    >
      <span class="embark-cards__tab-label">{props.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// A stack pane: drop zone + list (or a hint while there's nothing to show)
// ---------------------------------------------------------------------------

function StackPane(props: {
  active: boolean;
  stack: DocHandle<CardStackDoc> | undefined;
  emptyHint: string;
  // Whether drops are meaningful right now (the Current Doc tab refuses drops
  // while no document is open). Defaults to true.
  droppable?: boolean;
  onDropItems: (items: DocumentDragItem[]) => void;
}) {
  const [dragOver, setDragOver] = createSignal(false);
  const droppable = () => props.droppable !== false;

  const onDragOver = (event: DragEvent) => {
    if (!droppable() || !hasDocumentDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDrop = (event: DragEvent) => {
    setDragOver(false);
    if (!droppable() || !hasDocumentDrag(event.dataTransfer)) return;
    event.preventDefault();
    // Signal a copy so a canvas embed dragged in keeps its original (the
    // synthetic-DnD bridge reads the claim convention, which we don't set).
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    // Read synchronously — a real drop clears the DataTransfer once we yield.
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    props.onDropItems(payload);
  };

  return (
    <div
      class="embark-cards__pane"
      classList={{
        "embark-cards__pane--active": props.active,
        "embark-cards__pane--drag-over": dragOver(),
      }}
      on:dragover={onDragOver}
      on:dragleave={() => setDragOver(false)}
      on:drop={onDrop}
    >
      <Show
        when={props.stack}
        keyed
        fallback={<div class="embark-cards__hint">{props.emptyHint}</div>}
      >
        {(stack) => <CardStackList handle={stack} emptyHint={props.emptyHint} />}
      </Show>
    </div>
  );
}

// Append dropped documents to a stack. Entries always carry a url — items
// without one are skipped rather than inserted.
function appendEntries(
  stack: DocHandle<CardStackDoc>,
  items: DocumentDragItem[],
): void {
  stack.change((doc) => {
    for (const item of items) {
      if (!item.url) continue;
      doc.cards.push({
        id: crypto.randomUUID(),
        url: item.url,
        // Automerge rejects explicit `undefined`, so only set the optional
        // fields the drag actually carried.
        ...(item.toolId !== undefined && { toolId: item.toolId }),
        ...(item.width !== undefined && { width: item.width }),
        ...(item.height !== undefined && { height: item.height }),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// The ordered, reorderable list
// ---------------------------------------------------------------------------

// A live reorder gesture: which entry is being dragged, by which pointer.
type Reorder = { entryId: string; pointerId: number };

function CardStackList(props: {
  handle: DocHandle<CardStackDoc>;
  emptyHint: string;
}) {
  // Drive the list from a full snapshot reconciled on every change, keyed by
  // entry id — matched entries keep identity across changes, so <For> never
  // recreates their rows (see the same pattern in PartsBinList).
  const [doc, setDoc] = createStore<CardStackDoc>(props.handle.doc());
  const syncFromHandle = () =>
    setDoc(reconcile(props.handle.doc(), { key: "id" }));
  props.handle.on("change", syncFromHandle);
  onCleanup(() => props.handle.off("change", syncFromHandle));

  const entries = () => doc.cards ?? [];

  // Stable render order (by id) so <For> never reorders the DOM nodes — that
  // would tear down and remount the embedded <patchwork-view>. Visual order
  // comes from the CSS `order` property instead, driven by each entry's index
  // in the document array (the list is a flex column).
  const sorted = createMemo(() =>
    [...entries()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  const orderOf = (id: string) =>
    entries().findIndex((entry) => entry.id === id);

  // Reordering: a pointer-capture drag on the row's grip. On every move the
  // desired index is how many *other* rows' midpoints sit above the pointer;
  // when it differs from the entry's current index the document array is
  // respliced live (the re-inserted entry is copied to a plain object —
  // automerge won't re-insert a removed proxy). Only `order` styles change,
  // so no DOM moves and no view remounts.
  let listEl: HTMLDivElement | undefined;
  let reorder: Reorder | null = null;
  const [draggingId, setDraggingId] = createSignal<string | null>(null);

  const beginReorder = (entryId: string) => (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    reorder = { entryId, pointerId: event.pointerId };
    setDraggingId(entryId);
  };

  const moveReorder = (event: PointerEvent) => {
    const state = reorder;
    if (!state || state.pointerId !== event.pointerId || !listEl) return;
    const rows = [
      ...listEl.querySelectorAll<HTMLElement>("[data-entry-id]"),
    ].filter((row) => row.dataset.entryId !== state.entryId);
    let target = 0;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (event.clientY > rect.top + rect.height / 2) target += 1;
    }
    props.handle.change((stackDoc) => {
      const from = stackDoc.cards.findIndex(
        (entry) => entry.id === state.entryId,
      );
      if (from < 0 || from === target) return;
      const copy = { ...stackDoc.cards[from] };
      stackDoc.cards.splice(from, 1);
      stackDoc.cards.splice(target, 0, copy);
    });
  };

  const endReorder = (event: PointerEvent) => {
    if (!reorder || reorder.pointerId !== event.pointerId) return;
    const grip = event.currentTarget as HTMLElement;
    if (grip.hasPointerCapture(event.pointerId)) {
      grip.releasePointerCapture(event.pointerId);
    }
    reorder = null;
    setDraggingId(null);
  };

  const removeEntry = (id: string) => {
    props.handle.change((stackDoc) => {
      const index = stackDoc.cards.findIndex((entry) => entry.id === id);
      if (index >= 0) stackDoc.cards.splice(index, 1);
    });
  };

  return (
    <div class="embark-cards__list" ref={listEl}>
      <For each={sorted()}>
        {(entry) => (
          <CardStackRow
            entry={entry}
            order={orderOf(entry.id)}
            dragging={draggingId() === entry.id}
            onGripDown={beginReorder(entry.id)}
            onGripMove={moveReorder}
            onGripUp={endReorder}
            onRemove={() => removeEntry(entry.id)}
          />
        )}
      </For>
      <Show when={entries().length === 0}>
        <div class="embark-cards__hint">{props.emptyHint}</div>
      </Show>
    </div>
  );
}

// A document whose name we want to show on the row header. Patchwork keeps
// the display title under `@patchwork.title`; some datatypes mirror it at the
// root, and we fall back to the type or a generic label.
type NamedDoc = {
  "@patchwork"?: { title?: string; type?: string };
  title?: string;
};

function CardStackRow(props: {
  entry: CardStackDoc["cards"][number];
  order: number;
  dragging: boolean;
  onGripDown: (event: PointerEvent) => void;
  onGripMove: (event: PointerEvent) => void;
  onGripUp: (event: PointerEvent) => void;
  onRemove: () => void;
}) {
  const [rowDoc] = useDocument<NamedDoc>(() => props.entry.url);

  const name = () => {
    const value = rowDoc();
    return (
      value?.["@patchwork"]?.title ||
      value?.title ||
      value?.["@patchwork"]?.type ||
      "Untitled"
    );
  };

  // Presentation traits derive from the rendering tool, same as the canvas:
  // the pinned tool id wins, falling back to the doc's datatype. Auto-size
  // tools (cards, decks) shrink-wrap; everything else gets a fixed body
  // height. Frameless tools bring their own chrome, so no wrapper border.
  const toolId = () => props.entry.toolId ?? rowDoc()?.["@patchwork"]?.type;
  const autosize = () => {
    const id = toolId();
    return id !== undefined && AUTOSIZE_TOOLS.has(id);
  };
  const frameless = () => {
    const id = toolId();
    return id !== undefined && FRAMELESS_TOOLS.has(id);
  };

  return (
    <div
      class="embark-cards__row"
      data-entry-id={props.entry.id}
      classList={{ "embark-cards__row--dragging": props.dragging }}
      style={{ order: String(props.order) }}
    >
      <div class="embark-cards__row-head">
        <span
          class="embark-cards__row-grip"
          title="Drag to reorder"
          on:pointerdown={props.onGripDown}
          on:pointermove={props.onGripMove}
          on:pointerup={props.onGripUp}
          on:pointercancel={props.onGripUp}
        >
          <GripIcon />
        </span>
        <span class="embark-cards__row-name">{name()}</span>
        <button
          type="button"
          class="embark-cards__row-delete"
          title="Remove card"
          aria-label="Remove card"
          on:pointerdown={(event) => event.stopPropagation()}
          on:click={() => props.onRemove()}
        >
          <CloseIcon />
        </button>
      </div>
      <div
        class="embark-cards__row-body"
        classList={{
          "embark-cards__row-body--framed": !frameless(),
          "embark-cards__row-body--autosize": autosize(),
        }}
        style={
          autosize()
            ? undefined
            : { height: `${props.entry.height ?? DEFAULT_ROW_HEIGHT}px` }
        }
      >
        <patchwork-view
          doc-url={props.entry.url}
          tool-id={props.entry.toolId}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The parts bin panel
// ---------------------------------------------------------------------------

// The bin as a fixed sidebar column. Stays mounted while collapsed (hidden
// via CSS) so its inert previews keep their state; the panel doubles as a
// drop target for adding new examples, exactly like the old canvas drawer.
function BinPanel(props: { handle: DocHandle<PartsBinDoc>; open: boolean }) {
  const [dragOver, setDragOver] = createSignal(false);

  const onDragOver = (event: DragEvent) => {
    if (!acceptsPartsBinDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDrop = (event: DragEvent) => {
    if (!acceptsPartsBinDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragOver(false);
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    addDroppedItems(props.handle, payload);
  };

  return (
    <div
      class="embark-cards__bin"
      classList={{ "embark-cards__bin--drag-over": dragOver() }}
      on:dragover={onDragOver}
      on:dragleave={() => setDragOver(false)}
      on:drop={onDrop}
    >
      <div class="embark-cards__bin-title">Parts bin</div>
      <PartsBinList handle={props.handle} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persisted chrome state
// ---------------------------------------------------------------------------

const TAB_STORAGE_KEY = "embark:cards:tab";
const BIN_OPEN_STORAGE_KEY = "embark:cards:bin-open";

function readStoredTab(): TabId {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === "current"
      ? "current"
      : "global";
  } catch {
    return "global";
  }
}

function writeStoredTab(tab: TabId): void {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}

function readStoredBinOpen(): boolean {
  try {
    return localStorage.getItem(BIN_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredBinOpen(open: boolean): void {
  try {
    localStorage.setItem(BIN_OPEN_STORAGE_KEY, String(open));
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}

// ---------------------------------------------------------------------------
// Glyphs (inherit the parent's text color)
// ---------------------------------------------------------------------------

// Six-dot grip for the reorder handle.
function GripIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="9" cy="5" r="1.4" />
      <circle cx="15" cy="5" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="15" cy="19" r="1.4" />
    </svg>
  );
}

// Thin "x" for the remove button.
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

// Divider chevron: points right when the bin is open ("push it away"), left
// when collapsed ("pull it out").
function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      class="embark-cards__chevron"
      classList={{ "embark-cards__chevron--open": props.open }}
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
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
