import { type DocHandle, type Repo } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
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
// card fills it edge to edge. PAD keeps the folded pile clear of the frame's
// clip edge and mirrors the fanned panel's CSS padding.
const CARD_W = 154;
const CARD_H = 220;
const PAD = 14;
// Cap on how wide a held card lays out before being scaled into its slot.
// Fixed-size content (a card's playing-card surface) shrink-wraps below this;
// fluid content that would stretch forever stops at the canvas's default embed
// width, so its thumbnail matches what dealing it out would show.
const NATURAL_MAX_W = 360;
// Folded: each card peeks `PILE_STEP` past the one above, capped at `PILE_MAX`
// so a big deck still folds into a compact pile. The fanned layout is pure
// CSS — a wrapping flex row; see `.embark-deck--fanned` in deck.css.
const PILE_STEP = 3;
const PILE_MAX = 6;
// The fold/unfold choreography: a FLIP pass around each doc-driven re-render
// (see `flip` below) glides every slot between the two layouts.
const FLIP_TRANSITION = "transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1)";
const FLIP_TIMEOUT_MS = 300;

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
  let rootEl: HTMLDivElement | undefined;

  // Drive the view from a full snapshot reconciled on every change (matching the
  // parts bin): solid-automerge's fine-grained projection can transiently
  // duplicate a freshly pushed array item, so reconciling the whole doc keyed by
  // `id` keeps the card count correct while preserving unchanged thumbnails.
  // Every change — local or remote — funnels through here, so wrapping the
  // reconcile in a FLIP pass animates fold/unfold and dealt/added cards no
  // matter which client drove the change. `:scope >` keeps a deck thumbnail
  // rendered *inside* one of our cards from contributing its own slots.
  const [doc, setDoc] = createStore<DeckDoc>(props.handle.doc());
  const collectSlots = () =>
    rootEl
      ? [
          ...rootEl.querySelectorAll<HTMLElement>(
            ":scope > .embark-deck__cover, :scope > .embark-deck__card",
          ),
        ]
      : [];
  const syncFromHandle = () =>
    flip(collectSlots, () =>
      setDoc(reconcile(props.handle.doc(), { key: "id" })),
    );
  props.handle.on("change", syncFromHandle);
  onCleanup(() => props.handle.off("change", syncFromHandle));

  const cards = () => doc.cards ?? [];
  const count = () => cards().length;
  const fanned = () => doc.fanned ?? false;

  const [dragOver, setDragOver] = createSignal(false);
  const [editing, setEditing] = createSignal(false);

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
    if (!acceptsDrop(dataTransfer)) return;
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
    if (!acceptsDrop(dataTransfer)) return;
    event.preventDefault();
    setDragOver(false);
    // Read the payload synchronously, before any await — a real drop clears the
    // DataTransfer once the handler yields.
    const payload = getDocumentDragPayload(dataTransfer);
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

  // Folded, the root reports the pile's explicit footprint and the embed
  // auto-sizes to it (see AUTOSIZE_TOOLS in canvas.tsx). Fanned, no inline
  // size is set: the flex layout in deck.css lays cover and cards out as a
  // wrapping row against whatever width the container provides, so the embed
  // tracks that instead.
  const foldedSize = () => {
    const peek = Math.min(count(), PILE_MAX) * PILE_STEP;
    return { width: PAD * 2 + CARD_W + peek, height: PAD * 2 + CARD_H + peek };
  };

  const pileTransform = (index: number) => {
    const offset = Math.min(index + 1, PILE_MAX) * PILE_STEP;
    return `translate(${PAD + offset}px, ${PAD + offset}px)`;
  };

  return (
    <div
      ref={rootEl}
      class="embark-deck"
      classList={{
        "embark-deck--fanned": fanned(),
        "embark-deck--drag-over": dragOver(),
      }}
      style={
        fanned()
          ? undefined
          : {
              width: `${foldedSize().width}px`,
              height: `${foldedSize().height}px`,
            }
      }
      on:dragover={onDragOver}
      on:dragleave={onDragLeave}
      on:drop={onDrop}
    >
      <For each={cards()}>
        {(card, index) => (
          <DeckCardView
            repo={repo}
            card={card}
            transform={fanned() ? undefined : pileTransform(index())}
            z={fanned() ? undefined : index() + 1}
            onDealt={() => removeCard(card.id)}
          />
        )}
      </For>

      {/* Folded, the cover sits on top of the pile (cards are z 1..n); fanned
          it's a flex item pulled to the front of the row by CSS order. */}
      <div
        class="embark-deck__cover"
        style={
          fanned()
            ? undefined
            : {
                transform: `translate(${PAD}px, ${PAD}px)`,
                "z-index": count() + 5,
              }
        }
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
  // Inline pile placement, set only while the deck is folded; fanned, the
  // slot is a plain flex item and both stay unset.
  transform?: string;
  z?: number;
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

// First/Last/Invert/Play around a synchronous DOM update: measure the slots,
// apply the update (Solid renders synchronously, so the new layout is
// measurable right away), then glide every surviving slot from its old spot
// to its new one with a transform transition. Deltas are measured in screen
// space and mapped back through any ancestor scaling (e.g. a scaled-down
// thumbnail of this deck) before being applied as local translates. Slots
// with no old rect (freshly added) simply appear in place; removed slots
// vanish.
function flip(collect: () => HTMLElement[], update: () => void): void {
  const before = new Map<HTMLElement, DOMRect>();
  for (const el of collect()) before.set(el, el.getBoundingClientRect());

  update();

  const moved: { el: HTMLElement; target: string }[] = [];
  for (const el of collect()) {
    const old = before.get(el);
    if (!old) continue;
    const now = el.getBoundingClientRect();
    const scale = el.offsetWidth > 0 ? now.width / el.offsetWidth : 1;
    const dx = (old.left - now.left) / scale;
    const dy = (old.top - now.top) / scale;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    // A slot still mid-glide keeps its visual position (the old rect measured
    // the interpolated transform); disarm that pass's cleanup so it can't
    // clip the new glide.
    activeFlips.get(el)?.();
    // Compose ahead of the slot's target transform (the folded pile
    // translate, or none when fanned), then release to the target alone.
    const target = el.style.transform;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)${target ? ` ${target}` : ""}`;
    moved.push({ el, target });
  }
  const probe = moved[0];
  if (!probe) return;

  // One reflow so the inverted positions take hold, then release everything.
  void probe.el.offsetWidth;
  for (const { el, target } of moved) {
    el.style.transition = FLIP_TRANSITION;
    el.style.transform = target;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (event?: TransitionEvent) => {
      if (event && (event.target !== el || event.propertyName !== "transform"))
        return;
      el.style.transition = "";
      disarm();
    };
    const disarm = () => {
      el.removeEventListener("transitionend", finish);
      clearTimeout(timer);
      activeFlips.delete(el);
    };
    // transitionend can be swallowed (hidden tab, interrupted glide); a timer
    // backstops the cleanup.
    timer = setTimeout(finish, FLIP_TIMEOUT_MS);
    el.addEventListener("transitionend", finish);
    activeFlips.set(el, disarm);
  }
}

// Cleanup cancellers for slots currently mid-glide, so an interrupting FLIP
// pass can disarm the previous pass's listeners before starting its own.
const activeFlips = new WeakMap<HTMLElement, () => void>();

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
