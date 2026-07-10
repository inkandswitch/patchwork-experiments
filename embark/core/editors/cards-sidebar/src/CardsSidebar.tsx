import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js";
import { useDocHandle, useDocument, useRepo } from "solid-automerge";
import { findContextStore } from "@embark/context";
import { Highlight } from "@embark/selection/channels";
import type { InspectDoc } from "@embark/inspect";
import type { DeckDoc, DocumentDragItem } from "@embark/dnd";
import { DEFAULT_BIN } from "./parts-bin/catalog";
import { PartsBinList } from "./parts-bin/PartsBinList";
import { FlapGroup, FlapPane } from "./FlapGroup";
import { TabButton } from "./TabButton";
import { StackPane, appendEntries } from "./StackPane";
import type { CardStackDoc, WithCardStack } from "./types";
import "./cards-sidebar.css";

// The Cards sidebar: a vertical tab rail (Current Doc / Global) on the left
// edge, the active tab's pane beside it as a sheet of paper, and a second
// tabbed sheet on the right edge — the flap group holding the parts bin and
// the Inspector (see FlapGroup). The group expands and folds as one unit,
// squeezing the stack pane when open; its tabs pick which content shows.
//
// Both stacks stay mounted whichever tab is showing (the inactive pane is
// hidden, not unmounted), and the whole sidebar keeps running while parked on
// document.body (see host.tsx) — so cards keep doing their page-wide work
// with the sidebar closed. The Inspector is the exception: nothing in it
// does page-wide work, so it mounts only while its tab is showing (keeping
// the context viewer from registering as a phantom reader on every channel
// while invisible). The pane and bin internals are shared with the full-frame
// card-stack tool (see CardStackTool), which renders one stack with no tabs.
export function CardsSidebar(props: {
  globalStack: DocHandle<CardStackDoc>;
  selectedDoc: Accessor<AutomergeUrl | undefined>;
}) {
  const repo = useRepo();

  // Which tab shows: per-browser chrome state, persisted to localStorage.
  const [tab, setTab] = createSignal<TabId>(readStoredTab());
  createEffect(() => writeStoredTab(tab()));

  // Light the Global tab when it's hidden but one of its cards is highlighted,
  // so highlight coming from the page (a hovered token, a map pin) is visible
  // even with the Global stack tucked behind the Current Doc tab. The sidebar
  // has no embed ancestor, so resolve the page-global store the live cards
  // write to from the mounted root and attribute the read to the sidebar.
  let rootEl: HTMLDivElement | undefined;
  const [highlight, setHighlight] = createSignal<Record<string, true>>(
    Highlight.empty,
  );
  onMount(() => {
    const el = rootEl;
    if (!el) return;
    const store = findContextStore(el);
    setHighlight(() => store.read(Highlight));
    onCleanup(
      store.subscribe(Highlight, (next) => setHighlight(() => next), {
        owner: { toolId: "cards-sidebar" },
      }),
    );
  });

  // Highlight keys can be sub-document urls, so compare by document id.
  const highlightedDocIds = createMemo(() => {
    const ids = new Set<string>();
    for (const url of Object.keys(highlight())) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    return ids;
  });

  // Whether any card in the Global stack points at a highlighted document —
  // either directly, or held one level down inside a deck in the stack.
  const [globalDoc] = useDocument<CardStackDoc>(() => props.globalStack.url);
  const globalCardUrls = createMemo(() =>
    (globalDoc()?.cards ?? [])
      .map((card) => card.url)
      .filter((url): url is AutomergeUrl => isValidAutomergeUrl(url)),
  );
  const deckCardDocIds = createDeckCardDocIds(repo, globalCardUrls);
  const globalHighlighted = createMemo(() => {
    const ids = highlightedDocIds();
    if (ids.size === 0) return false;
    for (const url of globalCardUrls()) {
      if (ids.has(parseAutomergeUrl(url).documentId)) return true;
    }
    const inDecks = deckCardDocIds();
    for (const id of ids) if (inDecks.has(id)) return true;
    return false;
  });

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

  // The flap group's chrome state, persisted like the stack tab: which of its
  // tabs is selected, and whether the group is expanded. Clicking the active
  // tab folds the group; clicking any tab while folded opens it and selects.
  const [flapTab, setFlapTab] = createSignal<FlapTabId>(readStoredFlapTab());
  const [flapOpen, setFlapOpen] = createSignal(readStoredFlapOpen());
  createEffect(() => writeStoredFlapTab(flapTab()));
  createEffect(() => writeStoredFlapOpen(flapOpen()));
  const clickFlapTab = (id: FlapTabId) => {
    if (flapOpen() && flapTab() === id) {
      setFlapOpen(false);
    } else {
      setFlapTab(id);
      setFlapOpen(true);
    }
  };
  const inspectorVisible = () => flapOpen() && flapTab() === "inspector";

  // The Inspector's backing doc: a per-browser singleton inspect doc (same
  // localStorage pattern as the global stack — see host.tsx), resolved lazily
  // when its tab first shows. It persists the picked target across opens;
  // with no target the inspect tool shows the whole shared context.
  const [inspectorDocUrl, setInspectorDocUrl] = createSignal<AutomergeUrl>();
  createEffect(() => {
    if (!inspectorVisible() || inspectorDocUrl() !== undefined) return;
    void resolveInspectorDoc(repo).then(setInspectorDocUrl);
  });

  return (
    <div class="embark-cards embark-cards--sidebar" ref={rootEl}>
      <div class="embark-cards__rail">
        <TabButton
          label="Current Doc"
          active={tab() === "current"}
          onSelect={() => setTab("current")}
        />
        <TabButton
          label="Global"
          active={tab() === "global"}
          highlighted={globalHighlighted() && tab() !== "global"}
          onSelect={() => setTab("global")}
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

      <FlapGroup
        tabs={FLAP_TABS}
        selected={flapTab()}
        open={flapOpen()}
        onTabClick={clickFlapTab}
      >
        <FlapPane active={flapTab() === "bin"}>
          <div class="embark-cards__flap-title">Parts bin</div>
          <PartsBinList entries={DEFAULT_BIN} />
        </FlapPane>
        <FlapPane active={flapTab() === "inspector"}>
          {/* Nothing in the Inspector does page-wide work, so it mounts only
              while visible — keeping the context viewer from registering as a
              phantom reader on every channel while hidden. */}
          <Show when={inspectorVisible()}>
            <Show when={inspectorDocUrl()}>
              {(url) => (
                <patchwork-view
                  class="embark-cards__inspector-view"
                  doc-url={url()}
                  tool-id="inspect"
                />
              )}
            </Show>
          </Show>
        </FlapPane>
      </FlapGroup>
    </div>
  );
}

// localStorage key holding this browser's singleton sidebar inspector doc.
// Deliberately per-device, not synced through the account (like the global
// card stack), so the same inspector reopens across sessions.
const INSPECTOR_DOC_KEY = "embark:sidebar-inspector-doc";

// Find-or-create the singleton inspector doc. A stored url that can't be
// resolved in this repo (e.g. a different device or account) is treated as
// absent and a fresh doc is minted.
async function resolveInspectorDoc(repo: Repo): Promise<AutomergeUrl> {
  const stored = localStorage.getItem(INSPECTOR_DOC_KEY);
  if (stored && isValidAutomergeUrl(stored)) {
    try {
      return (await repo.find<InspectDoc>(stored)).url;
    } catch {
      // Fall through and mint a new one.
    }
  }
  const created = repo.create<InspectDoc>({
    "@patchwork": { type: "inspect" },
  });
  localStorage.setItem(INSPECTOR_DOC_KEY, created.url);
  return created.url;
}

// Doc ids of the cards held *inside* any deck sitting in the given stack.
// One level only — decks don't nest — kept live as those decks load and
// change. Every stack card is watched (not just decks): a card's type is only
// knowable once its doc loads, and staying subscribed means a freshly dropped
// deck lights up without re-seeding.
function createDeckCardDocIds(
  repo: Repo,
  cardUrls: Accessor<AutomergeUrl[]>,
): Accessor<Set<string>> {
  type Entry = { handle?: DocHandle<DeckDoc>; onChange?: () => void };
  const watched = new Map<AutomergeUrl, Entry>();
  const [ids, setIds] = createSignal<Set<string>>(new Set());

  const recompute = () => {
    const next = new Set<string>();
    for (const entry of watched.values()) {
      const doc = entry.handle?.doc();
      if (doc?.["@patchwork"]?.type !== "deck") continue;
      for (const card of doc.cards ?? []) {
        if (card.url && isValidAutomergeUrl(card.url)) {
          next.add(parseAutomergeUrl(card.url).documentId);
        }
      }
    }
    setIds(next);
  };

  createEffect(() => {
    const wanted = new Set(cardUrls());
    for (const [url, entry] of watched) {
      if (wanted.has(url)) continue;
      if (entry.handle && entry.onChange) {
        entry.handle.off("change", entry.onChange);
      }
      watched.delete(url);
    }
    for (const url of wanted) {
      if (watched.has(url)) continue;
      const entry: Entry = {};
      watched.set(url, entry);
      void Promise.resolve(repo.find<DeckDoc>(url))
        .then((handle) => {
          if (watched.get(url) !== entry) return; // dropped while loading
          entry.handle = handle;
          entry.onChange = recompute;
          handle.on("change", entry.onChange);
          recompute();
        })
        .catch(() => {});
    }
    recompute();
  });

  onCleanup(() => {
    for (const entry of watched.values()) {
      if (entry.handle && entry.onChange) {
        entry.handle.off("change", entry.onChange);
      }
    }
    watched.clear();
  });

  return ids;
}

// ---------------------------------------------------------------------------
// Persisted chrome state
// ---------------------------------------------------------------------------

type TabId = "global" | "current";

const TAB_STORAGE_KEY = "embark:cards:tab";

// A previously stored "inspector" (from when the Inspector was a tab) falls
// back to "current".
function readStoredTab(): TabId {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === "global"
      ? "global"
      : "current";
  } catch {
    return "current";
  }
}

function writeStoredTab(tab: TabId): void {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}

// The flap group's tabs on the sidebar's right edge.
type FlapTabId = "bin" | "inspector";

const FLAP_TABS: readonly { id: FlapTabId; label: string }[] = [
  { id: "bin", label: "Parts bin" },
  { id: "inspector", label: "Inspector" },
];

const FLAP_TAB_STORAGE_KEY = "embark:cards:flap-tab";
const FLAP_OPEN_STORAGE_KEY = "embark:cards:flap-open";

function readStoredFlapTab(): FlapTabId {
  try {
    return localStorage.getItem(FLAP_TAB_STORAGE_KEY) === "inspector"
      ? "inspector"
      : "bin";
  } catch {
    return "bin";
  }
}

function writeStoredFlapTab(tab: FlapTabId): void {
  try {
    localStorage.setItem(FLAP_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}

function readStoredFlapOpen(): boolean {
  try {
    return localStorage.getItem(FLAP_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredFlapOpen(open: boolean): void {
  try {
    localStorage.setItem(FLAP_OPEN_STORAGE_KEY, String(open));
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}
