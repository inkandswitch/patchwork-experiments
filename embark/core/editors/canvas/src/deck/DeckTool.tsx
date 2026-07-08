import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import {
  findContextStore,
  requireOwner,
  type ScopeOwner,
} from "@embark/context";
import { Highlight } from "@embark/selection/channels";
import {
  getDocumentDragPayload,
  getDragSource,
  hasDocumentDrag,
  type DocumentDragItem,
} from "../dnd";
import { markEmbedClaimed } from "../drop-claim";
import type { DeckCard, DeckDoc } from "./types";
import "./deck.css";

// Card geometry. Mirrored in deck.css (`.embark-deck__card` / `__cover`); keep
// them in sync. The slot matches the playing card's 0.7 aspect ratio so a held
// card fills it edge to edge. PAD keeps fanned/tilted cards clear of the
// frame's clip edge.
const CARD_W = 154;
const CARD_H = 220;
const PAD = 14;
// Cap on how wide a held card lays out before being scaled into its slot.
// Fixed-size content (a card's playing-card surface) shrink-wraps below this;
// fluid content that would stretch forever stops at the canvas's default embed
// width, so its thumbnail matches what dealing it out would show.
const NATURAL_MAX_W = 360;
// Folded: each card peeks `PILE_STEP` past the one above, capped at `PILE_MAX`
// so a big deck still folds into a compact pile.
const PILE_STEP = 3;
const PILE_MAX = 6;
// Fanned: ideal gap between successive card left edges, but never so wide the
// spread exceeds `FAN_MAX_W` — beyond that the cards crowd closer instead.
const FAN_STEP = 130;
const FAN_MAX_W = 820;
const FAN_TILT = 3;

// Tool entry point. Unlike the parts bin, the deck does NOT host its own
// context: the cards are live participants, not inert examples. We render the
// thumbnails straight into `element`, so each card's context discovery finds no
// enclosing host and resolves to the page-global body store — its queries,
// sticker sources, selection reads, etc. are answered there alongside every
// other card. The deck is purely a way to organize and collapse; folding is
// visual only, so cards stay mounted and active in either state.
export const DeckTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Deck handle={handle as DocHandle<DeckDoc>} host={element} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => {
    dispose();
  };
};

function Deck(props: { handle: DocHandle<DeckDoc>; host: ToolElement }) {
  const repo = useRepo();
  // Drive the view from a full snapshot reconciled on every change (matching the
  // parts bin): solid-automerge's fine-grained projection can transiently
  // duplicate a freshly pushed array item, so reconciling the whole doc keyed by
  // `id` keeps the card count correct while preserving unchanged thumbnails.
  const [doc, setDoc] = createStore<DeckDoc>(props.handle.doc());
  const syncFromHandle = () =>
    setDoc(reconcile(props.handle.doc(), { key: "id" }));
  props.handle.on("change", syncFromHandle);
  onCleanup(() => props.handle.off("change", syncFromHandle));

  const cards = () => doc.cards ?? [];
  const count = () => cards().length;
  const fanned = () => doc.fanned ?? false;

  const [dragOver, setDragOver] = createSignal(false);
  const [editing, setEditing] = createSignal(false);

  // Attribution for the context subscription: resolved structurally where
  // possible (the deck sits inside a `<patchwork-view doc-url=…>`), falling
  // back to naming the deck document itself (anonymous traffic throws by
  // contract). Same convention as the canvas.
  const contextOwner = (element: Element): ScopeOwner => {
    try {
      return requireOwner(element);
    } catch {
      return { docUrl: props.handle.url, toolId: "deck" };
    }
  };

  // Read the shared `Highlight` channel — the same one the canvas embeds
  // glow from — so a held card whose document is being emphasized elsewhere
  // (a hovered mention, a map pin, a context-viewer token) lights up in the
  // pile. Highlight keys can be sub-document urls, so compare by document id.
  const [highlight, setHighlight] = createSignal(Highlight.empty);
  onMount(() => {
    const store = findContextStore(props.host);
    setHighlight(() => store.read(Highlight));
    onCleanup(
      store.subscribe(Highlight, (next) => setHighlight(() => next), {
        owner: contextOwner(props.host),
      }),
    );
  });
  const highlightedDocIds = createMemo(() => {
    const ids = new Set<string>();
    for (const url of Object.keys(highlight())) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    return ids;
  });

  const toggleFan = () =>
    props.handle.change((d) => {
      d.fanned = !d.fanned;
    });

  // --- Accept a card dropped in, preferring a move (the card moves into the
  // deck rather than being copied). We ignore the deck's own card drags so
  // dragging a card out and back is inert.
  const acceptsDrop = (dataTransfer: DataTransfer | null) =>
    hasDocumentDrag(dataTransfer) && getDragSource(dataTransfer) !== "deck";

  const onDragOver = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!acceptsDrop(dataTransfer)) {
      console.debug("[deck] dragover ignored", {
        source: getDragSource(dataTransfer),
        types: dataTransfer ? Array.from(dataTransfer.types) : null,
      });
      return;
    }
    event.preventDefault();
    // Advertise an effect the source permits. A copy-only native drag (a
    // parts-bin example) must see "copy" — per the DnD spec a final dropEffect
    // outside effectAllowed cancels the whole drop, there is no fallback. Every
    // other source gets "move". Synthetic bridge drags don't care either way:
    // their script-created DataTransfer ignores the effect setters (its
    // effectAllowed reads "none", landing in the "move" arm), and the move-in
    // claim rides markEmbedClaimed, not dropEffect (see drop-claim).
    if (dataTransfer) {
      const allowed = dataTransfer.effectAllowed;
      dataTransfer.dropEffect =
        allowed === "copy" || allowed === "copyLink" ? "copy" : "move";
    }
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const onDrop = (event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!acceptsDrop(dataTransfer)) {
      console.debug("[deck] drop ignored", {
        source: getDragSource(dataTransfer),
        types: dataTransfer ? Array.from(dataTransfer.types) : null,
      });
      return;
    }
    event.preventDefault();
    setDragOver(false);
    // Read the payload synchronously, before any await — a real drop clears the
    // DataTransfer once the handler yields.
    const payload = getDocumentDragPayload(dataTransfer);
    console.debug("[deck] drop", {
      source: getDragSource(dataTransfer),
      payloadCount: payload?.length ?? 0,
    });
    if (!payload) return;
    let added = false;
    props.handle.change((d) => {
      for (const item of payload) {
        const card: DeckCard = { id: crypto.randomUUID() };
        // Cards are held by reference: store the dropped url directly (no
        // clone). Automerge rejects explicit `undefined`, so only set the
        // optional fields the drag actually carried.
        if (item.url) card.url = item.url;
        else continue;
        if (item.toolId !== undefined) card.toolId = item.toolId;
        if (item.width !== undefined) card.width = item.width;
        if (item.height !== undefined) card.height = item.height;
        d.cards.push(card);
        added = true;
      }
    });
    // Tell the canvas we claimed the card so it deletes the source embed (a move
    // in). `dropEffect` can't carry this on the synthetic bridge — see
    // drop-claim — so mark the event directly.
    if (added) markEmbedClaimed(event);
    console.debug(
      "[deck] cards after drop:",
      props.handle.doc().cards.length,
      added ? "— claimed; canvas should delete the source embed" : "— nothing added",
    );
  };

  const removeCard = (id: string) =>
    props.handle.change((d) => {
      const index = d.cards.findIndex((card) => card.id === id);
      if (index >= 0) d.cards.splice(index, 1);
    });

  const commitTitle = (value: string) => {
    const next = value.trim();
    props.handle.change((d) => {
      d.title = next || "Deck";
    });
    setEditing(false);
  };

  // The deck's footprint follows its layout, and the embed auto-sizes to it (see
  // AUTOSIZE_TOOLS in canvas.tsx), so folding/fanning grows and shrinks the card
  // on the canvas. Folded: one card plus the peeking pile. Fanned: the cover at
  // the left with the held cards spread to its right.
  const fanStep = () => {
    const n = count();
    if (n < 1) return 0;
    return Math.min(FAN_STEP, (FAN_MAX_W - CARD_W) / n);
  };

  const size = () => {
    const n = count();
    if (fanned()) {
      return { width: PAD * 2 + CARD_W + fanStep() * n, height: PAD * 2 + CARD_H + 10 };
    }
    const peek = Math.min(n, PILE_MAX) * PILE_STEP;
    return { width: PAD * 2 + CARD_W + peek, height: PAD * 2 + CARD_H + peek };
  };

  const cardTransform = (index: number) => {
    if (fanned()) {
      const x = PAD + (index + 1) * fanStep();
      const mid = (count() - 1) / 2;
      const tilt =
        count() > 1 ? ((index - mid) / Math.max(mid, 1)) * FAN_TILT : 0;
      return `translate(${x}px, ${PAD}px) rotate(${tilt}deg)`;
    }
    const offset = Math.min(index + 1, PILE_MAX) * PILE_STEP;
    return `translate(${PAD + offset}px, ${PAD + offset}px)`;
  };

  // Folded, the cover sits on top of the pile; fanned, it drops beneath the
  // spread so the held cards read over it.
  const coverZ = () => (fanned() ? 0 : count() + 5);

  return (
    <div
      class="embark-deck"
      classList={{
        "embark-deck--fanned": fanned(),
        "embark-deck--drag-over": dragOver(),
      }}
      style={{ width: `${size().width}px`, height: `${size().height}px` }}
      on:dragover={onDragOver}
      on:dragleave={onDragLeave}
      on:drop={onDrop}
    >
      <For each={cards()}>
        {(card, index) => (
          <DeckCardView
            repo={repo}
            card={card}
            transform={cardTransform(index())}
            z={index() + 1}
            highlighted={
              card.url ? highlightedDocIds().has(docIdOf(card.url)) : false
            }
            onDealt={() => removeCard(card.id)}
          />
        )}
      </For>

      <div
        class="embark-deck__cover"
        style={{ transform: `translate(${PAD}px, ${PAD}px)`, "z-index": coverZ() }}
        title="Click to fan / gather"
        // The press deliberately bubbles to the embed surface: on a frameless
        // deck that's what lets the cover drag the deck around. A stationary
        // press still comes back as a click (the canvas defers the move behind
        // a travel threshold) and toggles the fan; a pull captures the pointer
        // and the trailing click retargets away from the cover, so it doesn't
        // also toggle.
        on:click={() => {
          if (!editing()) toggleFan();
        }}
      >
        <div class="embark-deck__cover-inner">
          <Show
            when={editing()}
            fallback={
              <div
                class="embark-deck__title"
                title="Double-click to rename"
                on:click={(event) => event.stopPropagation()}
                on:dblclick={(event) => {
                  event.stopPropagation();
                  setEditing(true);
                }}
              >
                {doc.title || "Deck"}
              </div>
            }
          >
            <input
              ref={(el) =>
                queueMicrotask(() => {
                  el.focus();
                  el.select();
                })
              }
              class="embark-deck__title-input"
              value={doc.title || ""}
              on:click={(event) => event.stopPropagation()}
              on:pointerdown={(event) => event.stopPropagation()}
              on:keydown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitTitle(event.currentTarget.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
              on:blur={(event) => commitTitle(event.currentTarget.value)}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}

// A document whose name we want for the drag token. Patchwork keeps the display
// title under `@patchwork.title`; some datatypes mirror it at the root.
type NamedDoc = {
  "@patchwork"?: { title?: string; type?: string };
  title?: string;
};

// A single card in the pile: a non-interactive live thumbnail that is the drag
// source. Dragging it onto the canvas (or another drop target) deals it out —
// `dragend` removes it from the deck once the drop is accepted.
//
// The slot renders no chrome of its own (no border/background/shadow — the
// content brings whatever surface it has). Like a parts-bin preview, the
// content lays out at its natural footprint and is scaled down by a CSS
// transform to fit the slot.
function DeckCardView(props: {
  repo: Repo;
  card: DeckCard;
  transform: string;
  z: number;
  highlighted: boolean;
  onDealt: () => void;
}) {
  const [doc] = useDocument<NamedDoc>(() => props.card.url);

  // Natural footprint: the wrapper shrink-wraps the content (so a playing
  // card's fixed 224×320 surface lays out at exactly that, not stretched into
  // some recorded embed width — autosize embeds carry a stale footprint), and
  // both dimensions are measured live so the scale tracks the real layout.
  let naturalEl: HTMLDivElement | undefined;
  const [naturalSize, setNaturalSize] = createSignal<{
    width: number;
    height: number;
  }>();
  onMount(() => {
    const el = naturalEl;
    if (!el) return;
    const measure = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        setNaturalSize({ width: el.offsetWidth, height: el.offsetHeight });
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    onCleanup(() => observer.disconnect());
  });

  // Shrink to fit the slot in both dimensions, never enlarging small content.
  // Until the first measurement lands, estimate from the recorded footprint
  // (else the width cap) so the first paint is already scaled down rather than
  // flashing full-size.
  const scale = () => {
    const size = naturalSize();
    const width = size?.width ?? props.card.width ?? NATURAL_MAX_W;
    const height = size?.height ?? props.card.height;
    return Math.min(1, CARD_W / width, height ? CARD_H / height : 1);
  };
  const name = () => {
    const value = doc();
    return (
      value?.["@patchwork"]?.title ||
      value?.title ||
      value?.["@patchwork"]?.type ||
      "Card"
    );
  };

  const onDragStart = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    // Allow either effect: the canvas advertises "copy" but accepts the drop, so
    // dragend sees a non-"none" effect and we treat the card as dealt out.
    event.dataTransfer.effectAllowed = "copyMove";
    const item: DocumentDragItem = {};
    if (props.card.url) item.url = props.card.url;
    if (props.card.toolId !== undefined) item.toolId = props.card.toolId;
    if (props.card.width !== undefined) item.width = props.card.width;
    if (props.card.height !== undefined) item.height = props.card.height;
    event.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "deck", items: [item] }),
    );
    if (props.card.url) {
      event.dataTransfer.setData(
        "text/x-patchwork-urls",
        JSON.stringify([props.card.url]),
      );
    }
    setDragToken(event, name());
  };

  // Dealt out only when a drop target actually took the card: a rejected drop
  // (released over nothing, or back onto the deck which declines its own drags)
  // leaves `dropEffect` as "none", so the card stays put.
  const onDragEnd = (event: DragEvent) => {
    if (event.dataTransfer && event.dataTransfer.dropEffect !== "none") {
      props.onDealt();
    }
  };

  return (
    <div
      class="embark-deck__card"
      classList={{ "embark-deck__card--highlighted": props.highlighted }}
      draggable={true}
      style={{ transform: props.transform, "z-index": props.z }}
      title="Drag onto the canvas to deal this card out"
      on:pointerdown={(event) => event.stopPropagation()}
      on:click={(event) => event.stopPropagation()}
      on:dragstart={onDragStart}
      on:dragend={onDragEnd}
    >
      <div
        class="embark-deck__card-natural"
        ref={naturalEl}
        style={{ transform: `scale(${scale()})` }}
      >
        <patchwork-view
          doc-url={props.card.url}
          tool-id={props.card.toolId}
          hide-controls=""
        />
      </div>
    </div>
  );
}

// The document id of a card's url, used to match against the (possibly
// sub-document) urls in the Highlight channel. Falls back to the raw url when
// it can't be parsed so a malformed url simply never matches. Mirrors the
// canvas's helper.
function docIdOf(url: AutomergeUrl): string {
  return isValidAutomergeUrl(url) ? parseAutomergeUrl(url).documentId : url;
}

// Use a small title token as the drag image instead of the browser's snapshot of
// the live thumbnail. The token must be in the document when captured, then
// removed next tick.
function setDragToken(event: DragEvent, label: string): void {
  const token = document.createElement("div");
  token.className = "embark-deck__drag-token";
  token.textContent = label;
  document.body.appendChild(token);
  event.dataTransfer?.setDragImage(token, 12, 12);
  setTimeout(() => token.remove(), 0);
}
