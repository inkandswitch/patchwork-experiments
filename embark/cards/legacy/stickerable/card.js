// "Make stickerable": a card that lets stickers reach text that isn't an
// automerge document. Its middle slot lists the datatypes present on the canvas
// (found by schema-matching `@patchwork.type`); for each one you switch on, it
// watches the canvas for `<patchwork-view>`s showing that datatype, mirrors each
// view's visible text into a throwaway markdown document, and announces that
// mirror so the ordinary sticker sources (schedule, unit, currency, …) scan it.
// When stickers land on the mirror it maps their ranges back onto the live DOM
// and paints them as a floating overlay — never mutating the views themselves.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions and the context-store client are imported with plain relative paths (all cards share one package).

import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  updateText,
} from "@automerge/automerge-repo";
import { For, Show, createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { extractText } from "./extract.js";

import { getContextHandle, subscribeContext } from "../platform.js";
import { OpenDocuments, SchemaMatches, schemaKey } from "../schema-matcher/channels.js";
import { Stickers } from "../stickers-card/channels.js";

// Matches any object carrying a `@patchwork.type` string, i.e. every patchwork
// document. We use the matches only to enumerate which datatypes are around.
// A literal JSON Schema (what zod 4's `z.toJSONSchema` emits for the same
// shape); the matcher treats objects leniently, so extra root fields are fine.
const TYPE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    "@patchwork": {
      type: "object",
      properties: { type: { type: "string" } },
      required: ["type"],
      additionalProperties: false,
    },
  },
  required: ["@patchwork"],
  additionalProperties: false,
};
const TYPE_KEY = schemaKey(TYPE_SCHEMA);

// Make stickerable card behavior, loaded by the shared card shell as this
// package's `card.js`. Its middle slot is the datatype toggle list; the card's
// face (title, description, pips) is drawn by the shell from the card document.
export default function card(_handle, element) {
  injectStyles();
  const repo = element.repo;

  // Datatypes present on the canvas, discovered via schema matching. Resolving a
  // match's `@patchwork.type` is async, so we accumulate url -> type and derive
  // the sorted, de-duplicated list of types from it.
  const [typeByUrl, setTypeByUrl] = createSignal({});
  const presentTypes = createMemo(() =>
    [...new Set(Object.values(typeByUrl()))].sort(),
  );

  // Which datatypes the user has switched on. Toggling re-evaluates which
  // views the bridge mirrors.
  const [enabled, setEnabled] = createSignal(new Set());

  const stopDiscovery = discoverTypes(element, repo, setTypeByUrl);
  const bridge = runBridge({ element, repo, enabled });

  const toggle = (type) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    bridge.refresh();
  };

  // The middle-slot content: a toggle per datatype present on the canvas. The
  // card face (title, description, pips) is drawn by the shared card shell.
  const dispose = render(
    () =>
      html`<div class="stickerable">
        <${Show}
          when=${() => presentTypes().length > 0}
          fallback=${html`<div class="stickerable__empty">
            No documents in context.
          </div>`}
        >
          <${For} each=${presentTypes}>
            ${(type) =>
              html`<label class="stickerable__type">
                <input
                  type="checkbox"
                  checked=${() => enabled().has(type)}
                  on:change=${() => toggle(type)}
                />
                <span>${type}</span>
              </label>`}
          <//>
        <//>
      </div>`,
    element,
  );

  return () => {
    stopDiscovery();
    bridge.stop();
    dispose();
  };
}

// Keep `setTypeByUrl` in sync with the `@patchwork.type` matches the schema
// matcher reports, resolving each match's datatype. The declared key interest
// on SchemaMatches is itself the query the matcher answers.
function discoverTypes(element, repo, setTypeByUrl) {
  return subscribeContext(
    element,
    SchemaMatches,
    (all) => {
      const urls = (all[TYPE_KEY] ?? []).filter(isRootUrl);
      const present = new Set(urls);
      setTypeByUrl((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const url of Object.keys(next)) {
          if (!present.has(url)) {
            delete next[url];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      for (const url of urls) {
        void Promise.resolve(repo.find(url))
          .then((handle) => {
            const type = docType(handle.doc());
            if (type) setTypeByUrl((prev) => ({ ...prev, [url]: type }));
          })
          .catch(() => {});
      }
    },
    [TYPE_KEY],
  );
}

// The DOM<->sticker bridge: discovers views, mirrors their text, and paints the
// resulting stickers back as a fixed overlay. Returns `refresh` (re-evaluate
// which views to mirror, e.g. after the enabled set changes) and `stop`.
function runBridge(config) {
  const { element, repo } = config;
  const overlay = createOverlay();

  // Our scoped slice of the `OpenDocuments` channel: the mirror docs we mint
  // live in no `<patchwork-view>`, so publishing them here is their only signal
  // to the schema matcher (mirroring the POI provider). Released on stop,
  // dropping every mirror from the set.
  const openDocs = getContextHandle(element, OpenDocuments);

  // One mirrored view per entry: `{ el, url, mirror, handle, extract,
  // observer }`. `extract` is rebuilt on every (re)scan so the offset map
  // always points at the view's current text nodes.
  const tracked = new Map();
  const resyncTimers = new Map();

  // Painted stickers: each anchor is `{ chip, range, slot }` — its chip element
  // and the live DOM range it tracks.
  let anchors = [];
  let stickersByDoc = {};
  let raf = 0;

  // --- view discovery -------------------------------------------------------

  let reconcileTimer;
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
          const handle = await repo.find(url);
          return { el, url, type: docType(handle.doc()) };
        } catch {
          return null;
        }
      }),
    );
    if (gen !== reconcileGen) return; // a newer reconcile superseded this one

    const enabled = config.enabled();
    const want = new Map();
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
  };

  // Every `<patchwork-view>` on the page except the ones we inject for tool
  // stickers (marked owned, and living inside our overlay).
  const collectViewEls = () =>
    [...document.querySelectorAll("patchwork-view")].filter(
      (el) =>
        !el.__stickerableOwned && !el.closest("[data-stickerable-overlay]"),
    );

  const addView = (el, url) => {
    const extract = extractText(el);
    // The mirror document: a plain markdown doc whose `content` shadows the
    // view's visible text, so the text sticker sources (which scan `content`)
    // pick it up.
    const handle = repo.create({
      "@patchwork": { type: "markdown" },
      content: extract.text,
    });
    const observer = new MutationObserver(() => scheduleResync(el));
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    tracked.set(el, { el, url, mirror: handle.url, handle, extract, observer });
    // Announce the mirror so the schema matcher tracks it and the text sticker
    // sources scan it.
    openDocs.change((slice) => {
      slice[handle.url] = true;
    });
  };

  const removeView = (el) => {
    const entry = tracked.get(el);
    if (!entry) return;
    tracked.delete(el);
    entry.observer.disconnect();
    const timer = resyncTimers.get(el);
    if (timer) {
      clearTimeout(timer);
      resyncTimers.delete(el);
    }
    openDocs.change((slice) => {
      delete slice[entry.mirror];
    });
    void Promise.resolve(entry.handle.delete()).catch(() => {});
    scheduleResolve();
  };

  // --- mirror text upkeep ---------------------------------------------------

  const scheduleResync = (el) => {
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

  const resync = (el) => {
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
    const pending = [];
    for (const entry of tracked.values()) {
      for (const sticker of stickersByDoc[entry.mirror] ?? []) {
        // Style stickers recolor the range itself; with no DOM mutation there's
        // no slot to place them, so we skip them (decided).
        if (sticker.type === "style") continue;
        try {
          const target = await repo.find(sticker.target);
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

  const positionChip = (anchor) => {
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

  const makeChip = (sticker) => {
    const chip = document.createElement("div");
    chip.className = "stickerable-chip";
    if (sticker.type === "text") {
      chip.classList.add("stickerable-chip--text");
      chip.textContent = sticker.text;
      if (sticker.styles) chip.style.cssText += `;${cssText(sticker.styles)}`;
    } else if (sticker.type === "tool") {
      chip.classList.add("stickerable-chip--tool");
      const view = document.createElement("patchwork-view");
      // Mark + nest under the overlay so view discovery never mirrors it.
      view.__stickerableOwned = true;
      view.setAttribute("doc-url", sticker.docUrl);
      view.setAttribute("tool-id", sticker.toolId);
      chip.appendChild(view);
    }
    return chip;
  };

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
      openDocs.release();
      clearAnchors();
      overlay.remove();
    },
  };
}

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.dataset.stickerableOverlay = "";
  overlay.className = "stickerable-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

// Only before/after are supported; anything else (replace/cover/unknown) falls
// back to after, since we can't replace DOM we don't own.
function slotOf(sticker) {
  return "slot" in sticker && sticker.slot === "before" ? "before" : "after";
}

function viewUrl(el) {
  const raw = el.getAttribute("doc-url") ?? el.getAttribute("url");
  return raw && isValidAutomergeUrl(raw) ? raw : undefined;
}

function isRootUrl(url) {
  return url === `automerge:${parseAutomergeUrl(url).documentId}`;
}

function docType(doc) {
  if (doc === null || typeof doc !== "object") return undefined;
  const meta = doc["@patchwork"];
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}

function cssText(styles) {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-stickerable-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
/* The Make-stickerable card's middle-slot content: a toggle per datatype
   present on the canvas. The card frame, title, and pips are drawn by the shared
   card shell. */
.stickerable {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding: 2px 0;
  min-height: 0;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #1f2937;
}

.stickerable__type {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 3px 6px;
  border-radius: 7px;
  cursor: pointer;
  user-select: none;
}

.stickerable__type:hover {
  background: #f8f7f4;
}

.stickerable__type input {
  accent-color: #b45309;
  cursor: pointer;
}

.stickerable__type span {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.stickerable__empty {
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  padding: 4px 0;
}

/* The overlay layer sits above the canvas in viewport coordinates and never
   intercepts pointer events — chips are purely visual annotations. */
.stickerable-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
}

.stickerable-chip {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

.stickerable-chip--text {
  transform-origin: top left;
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  padding: 0 5px;
  height: 18px;
  border-radius: 9px;
  background: #fef3c7;
  color: #92400e;
  font-family:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
}

.stickerable-chip--tool {
  /* Tool stickers carry their own widget chrome; the overlay wrapper only
     positions it and lets it receive its own pointer events. */
  pointer-events: auto;
}
`;
