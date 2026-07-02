import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { CardIcon } from "./icons";
import type { CardDoc } from "./datatype";
import "./card.css";

// The module every card feature package ships as its `card.js`. It renders the
// card's middle slot and runs the card's behavior against the shared canvas
// context. Its shape is the tool-render contract: it receives the card document
// handle and a host element (with `repo` stamped on, sitting inside the canvas
// `<patchwork-context>`) and returns an optional teardown. Behavior-only cards
// render nothing into the slot.
export type CardModule = (
  handle: DocHandle<CardDoc>,
  element: ToolElement,
) => (() => void) | void;

// The generic card tool: the only tool the `card` datatype registers. It draws
// the playing-card shell (title / middle / description, mirrored corner pips,
// and a flip affordance) and, while face-up, loads and runs the behavior module
// named by `doc.src` into the middle slot. Flipping to the back tears the
// module down, so a deactivated card stops contributing to the canvas entirely.
export const CardTool: ToolRender<CardDoc> = (handle, element) =>
  render(() => <Card handle={handle} host={element} />, element);

function Card(props: { handle: DocHandle<CardDoc>; host: ToolElement }) {
  const [doc, setDoc] = createSignal<CardDoc>(props.handle.doc());
  const sync = () => setDoc(props.handle.doc());
  props.handle.on("change", sync);
  onCleanup(() => props.handle.off("change", sync));

  const title = () => doc()?.["@patchwork"]?.title || "Card";
  const description = () => doc()?.description ?? "";
  const icon = () => doc()?.icon || "card";
  const accent = () => doc()?.accent || "#16a34a";
  // Memoized so the load effect below re-runs only when the source or the
  // active/inactive state actually changes — not on every card state edit (e.g.
  // a module writing its own persisted fields).
  const src = createMemo(() => doc()?.src || "");
  const active = createMemo(() => doc()?.flipped !== true);

  const toggleFlip = () =>
    props.handle.change((d) => {
      d.flipped = d.flipped !== true;
    });

  let slotEl: HTMLDivElement | undefined;

  onMount(() => {
    let cleanup: (() => void) | void;
    let token = 0;

    const teardown = () => {
      if (typeof cleanup === "function") {
        try {
          cleanup();
        } catch {
          // ignore module teardown errors
        }
      }
      cleanup = undefined;
    };

    createEffect(() => {
      const moduleSrc = src();
      const isActive = active();
      const host = slotEl;
      // A fresh generation invalidates any import still in flight.
      const mine = ++token;
      teardown();
      host?.replaceChildren();
      if (!isActive || !moduleSrc || !host) return;
      // The embed contract: the module reaches the repo and (via DOM discovery)
      // the shared context through its host element.
      (host as unknown as { repo: Repo }).repo = props.host.repo;
      void (async () => {
        try {
          const mod = (await import(/* @vite-ignore */ moduleSrc)) as {
            default: CardModule;
          };
          if (mine !== token) return;
          const dispose =
            typeof mod.default === "function"
              ? mod.default(props.handle, host as unknown as ToolElement)
              : undefined;
          if (mine !== token) {
            if (typeof dispose === "function") dispose();
            return;
          }
          cleanup = dispose ?? undefined;
        } catch {
          // leave the slot empty when the module can't be loaded
        }
      })();
    });

    onCleanup(() => {
      token++;
      teardown();
    });
  });

  return (
    <div
      class="embark-card"
      classList={{ "embark-card--flipped": !active() }}
      style={{ "--embark-card-accent": accent() }}
    >
      <span class="embark-card__pip embark-card__pip--tl">
        <CardIcon name={icon()} />
      </span>
      <div class="embark-card__body">
        <div class="embark-card__title">{title()}</div>
        <div class="embark-card__middle" ref={slotEl} />
        <p class="embark-card__desc">{description()}</p>
      </div>
      <span class="embark-card__pip embark-card__pip--br">
        <CardIcon name={icon()} />
      </span>
      <button
        type="button"
        class="embark-card__flip"
        title={active() ? "Deactivate card" : "Activate card"}
        aria-label={active() ? "Deactivate card" : "Activate card"}
        on:pointerdown={(event) => event.stopPropagation()}
        on:click={toggleFlip}
      >
        <FlipIcon />
      </button>
    </div>
  );
}

function FlipIcon() {
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
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
