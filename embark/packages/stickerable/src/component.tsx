import type { JSX } from "solid-js";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  updateText,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import { MountedEvent, UnmountedEvent } from "@inkandswitch/patchwork-elements";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { z } from "zod";
import {
  SchemaMatches,
  SchemaQueries,
  Stickers,
  getContextHandle,
  schemaKey,
  subscribeContext,
  type JsonSchema,
  type Sticker,
} from "@embark/core";
import { extractText, type TextExtract } from "./extract";
import "@inkandswitch/patchwork-elements";
import "./stickerable.css";

// "Make stickerable": a handle-less component that lets stickers reach text that
// isn't an automerge document. It lists the datatypes present on the canvas
// (found by schema-matching `@patchwork.type`); for each one you switch on, it
// watches the canvas for `<patchwork-view>`s showing that datatype, mirrors each
// view's visible text into a throwaway markdown document, and announces that
// mirror so the ordinary sticker sources (schedule, unit, currency, …) scan it.
// When stickers land on the mirror it maps their ranges back onto the live DOM
// and paints them as a floating overlay — never mutating the views themselves.

// Matches any object carrying a `@patchwork.type` string, i.e. every patchwork
// document. We use the matches only to enumerate which datatypes are around.
const TYPE_SCHEMA = z.toJSONSchema(
  z.object({ "@patchwork": z.object({ type: z.string() }) }),
) as unknown as JsonSchema;
const TYPE_KEY = schemaKey(TYPE_SCHEMA);

// The `toolId` we tag the synthetic mount/unmount events with, purely for
// debuggability (the schema resolver keys on the url, not this).
const MIRROR_TOOL = "stickerable-mirror";

// The mirror document: a plain markdown doc whose `content` shadows a view's
// visible text, so the text sticker sources (which scan `content`) pick it up.
type MirrorDoc = { "@patchwork": { type: "markdown" }; content: string };

export default function component(element: ToolElement): () => void {
  return render(() => <Stickerable element={element} />, element);
}

function Stickerable(props: { element: ToolElement }) {
  const repo = props.element.repo;

  // Datatypes present on the canvas, discovered via schema matching. Resolving a
  // match's `@patchwork.type` is async, so we accumulate url -> type and derive
  // the sorted, de-duplicated list of types from it.
  const [typeByUrl, setTypeByUrl] = createSignal<Record<string, string>>({});
  const presentTypes = createMemo(() =>
    [...new Set(Object.values(typeByUrl()))].sort(),
  );

  // Which datatypes the user has switched on.
  const [enabled, setEnabled] = createSignal<Set<string>>(new Set());
  const toggle = (type: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const [viewCount, setViewCount] = createSignal(0);
  const [stickerCount, setStickerCount] = createSignal(0);

  onMount(() => {
    discoverTypes(props.element, repo, setTypeByUrl, onCleanup);

    const bridge = runBridge({
      element: props.element,
      repo,
      enabled,
      onStatus: (views, stickers) => {
        setViewCount(views);
        setStickerCount(stickers);
      },
    });
    // Re-evaluate which views to mirror whenever the enabled set changes.
    createEffect(() => {
      enabled();
      bridge.refresh();
    });
    onCleanup(bridge.stop);
  });

  return (
    <div class="stickerable-card">
      <div class="stickerable-card__title">
        <SparklesIcon />
        <span>Make stickerable</span>
      </div>
      <p class="stickerable-card__desc">
        Bridge other cards' text into the sticker system. Switch on a datatype
        and any sticker source can annotate views that show it.
      </p>
      <div class="stickerable-card__types">
        <Show
          when={presentTypes().length > 0}
          fallback={
            <div class="stickerable-card__empty">No documents in context.</div>
          }
        >
          <For each={presentTypes()}>
            {(type) => (
              <label class="stickerable-card__type">
                <input
                  type="checkbox"
                  checked={enabled().has(type)}
                  on:change={() => toggle(type)}
                />
                <span>{type}</span>
              </label>
            )}
          </For>
        </Show>
      </div>
      <div class="stickerable-card__status">
        {viewCount()} view{viewCount() === 1 ? "" : "s"} · {stickerCount()}{" "}
        sticker{stickerCount() === 1 ? "" : "s"}
      </div>
    </div>
  );
}

// Publish the `@patchwork.type` schema query and keep `setTypeByUrl` in sync with
// the matches the canvas resolver reports, resolving each match's datatype.
function discoverTypes(
  element: ToolElement,
  repo: Repo,
  setTypeByUrl: (update: (prev: Record<string, string>) => Record<string, string>) => void,
  registerCleanup: (fn: () => void) => void,
): void {
  const queries = getContextHandle(element, SchemaQueries);
  queries?.change((slice) => {
    slice[TYPE_KEY] = { name: "Patchwork documents", schema: TYPE_SCHEMA };
  });

  const unsubscribe = subscribeContext(element, SchemaMatches, (all) => {
    const urls = (all[TYPE_KEY] ?? []).filter(isRootUrl);
    const present = new Set(urls);
    setTypeByUrl((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const url of Object.keys(next)) {
        if (!present.has(url as AutomergeUrl)) {
          delete next[url];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    for (const url of urls) {
      void Promise.resolve(repo.find<unknown>(url))
        .then((handle) => {
          const type = docType(handle.doc());
          if (type) setTypeByUrl((prev) => ({ ...prev, [url]: type }));
        })
        .catch(() => {});
    }
  });

  registerCleanup(() => {
    unsubscribe();
    queries?.release();
  });
}

type BridgeConfig = {
  element: ToolElement;
  repo: Repo;
  enabled: () => Set<string>;
  onStatus: (views: number, stickers: number) => void;
};

// The DOM<->sticker bridge: discovers views, mirrors their text, and paints the
// resulting stickers back as a fixed overlay. Returns `refresh` (re-evaluate
// which views to mirror, e.g. after the enabled set changes) and `stop`.
function runBridge(config: BridgeConfig): { refresh: () => void; stop: () => void } {
  const { element, repo } = config;
  const overlay = createOverlay();

  // One mirrored view. `extract` is rebuilt on every (re)scan so the offset map
  // always points at the view's current text nodes.
  type Tracked = {
    el: Element;
    url: AutomergeUrl;
    mirror: AutomergeUrl;
    handle: DocHandle<MirrorDoc>;
    extract: TextExtract;
    observer: MutationObserver;
  };
  const tracked = new Map<Element, Tracked>();
  const resyncTimers = new Map<Element, ReturnType<typeof setTimeout>>();

  // A painted sticker: its chip element and the live DOM range it tracks.
  type Anchor = { chip: HTMLElement; range: Range; slot: "before" | "after" };
  let anchors: Anchor[] = [];
  let stickersByDoc: Record<AutomergeUrl, Sticker[]> = {};
  let raf = 0;

  // --- view discovery -------------------------------------------------------

  let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleReconcile = () => {
    if (reconcileTimer) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = undefined;
      void reconcileViews();
    }, 100);
  };

  let reconcileGen = 0;
  const reconcileViews = async () => {
    const gen = ++reconcileGen;
    const els = collectViewEls();
    const resolved = await Promise.all(
      els.map(async (el) => {
        const url = viewUrl(el);
        if (!url) return null;
        try {
          const handle = await repo.find<unknown>(url);
          return { el, url, type: docType(handle.doc()) };
        } catch {
          return null;
        }
      }),
    );
    if (gen !== reconcileGen) return; // a newer reconcile superseded this one

    const enabled = config.enabled();
    const want = new Map<Element, AutomergeUrl>();
    for (const entry of resolved) {
      if (entry && entry.type && enabled.has(entry.type)) {
        want.set(entry.el, entry.url);
      }
    }
    for (const [el, entry] of [...tracked]) {
      if (want.get(el) !== entry.url) removeView(el);
    }
    for (const [el, url] of want) {
      if (!tracked.has(el)) addView(el, url);
    }
    emitStatus();
  };

  // Every `<patchwork-view>` on the page except the ones we inject for tool
  // stickers (marked owned, and living inside our overlay).
  const collectViewEls = (): Element[] =>
    [...document.querySelectorAll("patchwork-view")].filter(
      (el) =>
        !(el as OwnedView).__stickerableOwned &&
        !el.closest("[data-stickerable-overlay]"),
    );

  const addView = (el: Element, url: AutomergeUrl) => {
    const extract = extractText(el);
    const handle = repo.create<MirrorDoc>({
      "@patchwork": { type: "markdown" },
      content: extract.text,
    });
    const observer = new MutationObserver(() => scheduleResync(el));
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    tracked.set(el, { el, url, mirror: handle.url, handle, extract, observer });
    // Announce the mirror so the canvas schema resolver tracks it and the text
    // sticker sources scan it (it lives in no `<patchwork-view>`, so this
    // synthetic event is its only signal — mirroring the POI provider).
    element.dispatchEvent(new MountedEvent({ url: handle.url, toolId: MIRROR_TOOL }));
  };

  const removeView = (el: Element) => {
    const entry = tracked.get(el);
    if (!entry) return;
    tracked.delete(el);
    entry.observer.disconnect();
    const timer = resyncTimers.get(el);
    if (timer) {
      clearTimeout(timer);
      resyncTimers.delete(el);
    }
    element.dispatchEvent(
      new UnmountedEvent({ url: entry.mirror, toolId: MIRROR_TOOL }),
    );
    void Promise.resolve(entry.handle.delete()).catch(() => {});
    scheduleResolve();
  };

  // --- mirror text upkeep ---------------------------------------------------

  const scheduleResync = (el: Element) => {
    const prev = resyncTimers.get(el);
    if (prev) clearTimeout(prev);
    resyncTimers.set(
      el,
      setTimeout(() => {
        resyncTimers.delete(el);
        resync(el);
      }, 200),
    );
  };

  const resync = (el: Element) => {
    const entry = tracked.get(el);
    if (!entry) return;
    const extract = extractText(el);
    // Diff-update the text so automerge cursors (and therefore existing
    // stickers) stay pinned to the same characters across edits.
    if (extract.text !== entry.extract.text) {
      entry.handle.change((doc) => updateText(doc, ["content"], extract.text));
    }
    // Always refresh the offset map: even with identical text the DOM may have
    // re-created its text nodes, invalidating the old ranges.
    entry.extract = extract;
    scheduleResolve();
  };

  // --- sticker resolution + overlay -----------------------------------------

  const unsubscribeStickers = subscribeContext(element, Stickers, (all) => {
    stickersByDoc = all;
    scheduleResolve();
  });

  let resolveScheduled = false;
  const scheduleResolve = () => {
    if (resolveScheduled) return;
    resolveScheduled = true;
    queueMicrotask(() => {
      resolveScheduled = false;
      void resolveAnchors();
    });
  };

  let resolveGen = 0;
  const resolveAnchors = async () => {
    const gen = ++resolveGen;
    const pending: { entry: Tracked; sticker: Sticker; from: number; to: number }[] =
      [];
    for (const entry of tracked.values()) {
      for (const sticker of stickersByDoc[entry.mirror] ?? []) {
        // Style stickers recolor the range itself; with no DOM mutation there's
        // no slot to place them, so we skip them (decided).
        if (sticker.type === "style") continue;
        try {
          const target = await repo.find<unknown>(sticker.target);
          const positions = target.rangePositions();
          if (!positions) continue;
          pending.push({
            entry,
            sticker,
            from: positions[0],
            to: positions[1],
          });
        } catch {
          // skip stickers whose target fails to load
        }
      }
    }
    if (gen !== resolveGen) return; // superseded by a newer resolve

    clearAnchors();
    for (const item of pending) {
      const range = item.entry.extract.rangeFor(item.from, item.to);
      if (!range) continue;
      const chip = makeChip(item.sticker);
      overlay.appendChild(chip);
      anchors.push({ chip, range, slot: slotOf(item.sticker) });
    }
    emitStatus();
    ensureRaf();
  };

  const clearAnchors = () => {
    for (const anchor of anchors) anchor.chip.remove();
    anchors = [];
  };

  // Reposition every chip each frame while any exist: the canvas pans by
  // rewriting embeds' inline positions, so there's no single scroll event to
  // hook — re-reading the live ranges' client rects is the robust option.
  const ensureRaf = () => {
    if (raf || anchors.length === 0) return;
    const tick = () => {
      for (const anchor of anchors) positionChip(anchor);
      raf = anchors.length > 0 ? requestAnimationFrame(tick) : 0;
    };
    raf = requestAnimationFrame(tick);
  };

  const positionChip = (anchor: Anchor) => {
    const rects = anchor.range.getClientRects();
    const rect = rects.length
      ? anchor.slot === "before"
        ? rects[0]
        : rects[rects.length - 1]
      : anchor.range.getBoundingClientRect();
    // A detached / collapsed range reports an empty rect at the origin; hide the
    // chip rather than parking it in the top-left corner.
    if (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0) {
      anchor.chip.style.display = "none";
      return;
    }
    anchor.chip.style.display = "";
    const x =
      anchor.slot === "before" ? rect.left - anchor.chip.offsetWidth : rect.right;
    anchor.chip.style.transform = `translate(${x}px, ${rect.top}px)`;
  };

  const makeChip = (sticker: Sticker): HTMLElement => {
    const chip = document.createElement("div");
    chip.className = "stickerable-chip";
    if (sticker.type === "text") {
      chip.classList.add("stickerable-chip--text");
      chip.textContent = sticker.text;
      if (sticker.styles) chip.style.cssText += `;${cssText(sticker.styles)}`;
    } else if (sticker.type === "tool") {
      chip.classList.add("stickerable-chip--tool");
      const view = document.createElement("patchwork-view") as OwnedView;
      // Mark + nest under the overlay so view discovery never mirrors it.
      view.__stickerableOwned = true;
      view.setAttribute("doc-url", sticker.docUrl);
      view.setAttribute("tool-id", sticker.toolId);
      chip.appendChild(view);
    }
    return chip;
  };

  const emitStatus = () => config.onStatus(tracked.size, anchors.length);

  // --- lifecycle ------------------------------------------------------------

  const onMountEvent = () => scheduleReconcile();
  document.addEventListener("patchwork:mounted", onMountEvent);
  document.addEventListener("patchwork:unmounted", onMountEvent);
  scheduleReconcile();

  return {
    refresh: scheduleReconcile,
    stop: () => {
      document.removeEventListener("patchwork:mounted", onMountEvent);
      document.removeEventListener("patchwork:unmounted", onMountEvent);
      unsubscribeStickers();
      if (raf) cancelAnimationFrame(raf);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      for (const el of [...tracked.keys()]) removeView(el);
      clearAnchors();
      overlay.remove();
    },
  };
}

// A `<patchwork-view>` we created for a tool sticker; tagged so view discovery
// skips it (otherwise we'd try to mirror our own chips).
type OwnedView = HTMLElement & { __stickerableOwned?: boolean };

function createOverlay(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.dataset.stickerableOverlay = "";
  overlay.className = "stickerable-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

// Only before/after are supported; anything else (replace/cover/unknown) falls
// back to after, since we can't replace DOM we don't own.
function slotOf(sticker: Sticker): "before" | "after" {
  return "slot" in sticker && sticker.slot === "before" ? "before" : "after";
}

function viewUrl(el: Element): AutomergeUrl | undefined {
  const raw = el.getAttribute("doc-url") ?? el.getAttribute("url");
  return raw && isValidAutomergeUrl(raw) ? (raw as AutomergeUrl) : undefined;
}

function isRootUrl(url: AutomergeUrl): boolean {
  return url === `automerge:${parseAutomergeUrl(url).documentId}`;
}

function docType(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const meta = (doc as { "@patchwork"?: { type?: unknown } })["@patchwork"];
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}

function cssText(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function SparklesIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
    </svg>
  );
}
