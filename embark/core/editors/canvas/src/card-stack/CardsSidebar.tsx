import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import { createEffect, createSignal, type Accessor } from "solid-js";
import { useDocHandle, useDocument, useRepo } from "solid-automerge";
import type { DocumentDragItem } from "../dnd";
import { DEFAULT_BIN } from "../parts-bin/catalog";
import { BinColumn } from "./BinColumn";
import { StackPane, appendEntries } from "./StackPane";
import type { CardStackDoc, WithCardStack } from "./types";
import "./cards-sidebar.css";

// The Cards sidebar, laid out per the sketch: the active tab's card stack on
// the left, the parts bin as a fixed column that collapses behind a chevron
// on the divider, and a vertical tab rail (Global / Current Doc) on the outer
// right edge.
//
// Both stacks stay mounted whichever tab is showing (the inactive pane is
// hidden, not unmounted), and the whole sidebar keeps running while parked on
// document.body (see host.tsx) — so cards keep doing their page-wide work
// with the sidebar closed. The pane and bin internals are shared with the
// full-frame card-stack tool (see CardStackTool), which renders one stack
// with no tabs.
export function CardsSidebar(props: {
  globalStack: DocHandle<CardStackDoc>;
  selectedDoc: Accessor<AutomergeUrl | undefined>;
}) {
  const repo = useRepo();

  // Which tab shows: per-browser chrome state, persisted to localStorage.
  const [tab, setTab] = createSignal<TabId>(readStoredTab());
  createEffect(() => writeStoredTab(tab()));

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
    <div class="embark-cards">
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

      <BinColumn entries={DEFAULT_BIN} />

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
// Persisted chrome state
// ---------------------------------------------------------------------------

const TAB_STORAGE_KEY = "embark:cards:tab";

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
