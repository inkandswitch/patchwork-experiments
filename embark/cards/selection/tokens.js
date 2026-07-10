// Shared building blocks for context views. Any channel that points at
// documents (selection, highlight, search results, command suggestions)
// renders the same embed token and drives the same shared `Highlight` channel
// on hover; string-keyed channels render as chips. These live in the Selection
// card's package because the hover interaction writes the `Highlight` channel
// this package owns — consumers import them from here (bundleless cards via
// this package's automerge url).
//
// Plain-JS bundleless module: every bare import is importmap-provided.

import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo";
import {
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import html from "solid-js/html";
import { Highlight } from "./channels.js";

// Token labels are clipped to keep pills short (the full url is in `title`).
const MAX_LABEL = 40;

/**
 * The set of document ids currently highlighted (by any scope), plus this
 * view's own writable Highlight slice.
 * @typedef {{
 *   highlightedDocIds: () => Set<string>,
 *   hover: (urls: string[]) => void,
 *   clear: () => void,
 * }} HighlightController
 */

/**
 * An embed's real inline face. Renders the shared `token-view` tool — the same
 * one the mention extension uses — so a document draws whatever token-tagged
 * tool it registers (upgrading in place when the module loads), falling back
 * to a plain title pill. The wrapper keeps the shared hover->Highlight wiring
 * so a visualizer's other panels still light up together. A custom `label`
 * (e.g. a command suggestion) shows verbatim, skipping the embed face.
 *
 * A Solid component (usable from `solid-js/html` templates and JSX alike).
 * @param {{ url: string, highlight: HighlightController, label?: string }} props
 */
export function EmbedToken(props) {
  injectStyles();
  // Reactive to props.url: a consumer may retarget a mounted token (e.g. the
  // inspector's toolbar token following the armed hover preview).
  const ids = createMemo(() => splitDocUrl(props.url));
  const host = document.createElement("span");

  onMount(() => {
    if (props.label !== undefined) {
      host.className = "embark-token";
      host.textContent = clip(props.label);
      return;
    }
    const face = document.createElement("patchwork-view");
    face.setAttribute("tool-id", "token-view");
    // patchwork-view observes doc-url and re-mounts its face on change, so
    // the token swaps in place as the url moves between documents.
    createRenderEffect(() => face.setAttribute("doc-url", props.url));
    host.appendChild(face);
    onCleanup(() => face.remove());
  });

  return html`<span
    class="embark-embed-token"
    classList=${() => ({
      "embark-embed-token--highlighted": props.highlight
        .highlightedDocIds()
        .has(ids().docId),
    })}
    title=${() => props.url}
    on:mouseenter=${() => props.highlight.hover([ids().docUrl])}
    on:mouseleave=${() => props.highlight.clear()}
    >${host}</span
  >`;
}

/**
 * Read/write access to the shared `Highlight` channel for a mounted view.
 * Takes a context view/store (it only needs `read`/`subscribe`/`handle`) and
 * the owner the traffic is attributed to (resolve it with `requireOwner` on
 * the mounted element). Hover/clear rewrite this view's slice to exactly the
 * hovered documents; the slice is released when the owning Solid scope
 * disposes.
 * @returns {HighlightController}
 */
export function useHighlight(store, owner) {
  const [incoming, setIncoming] = createSignal(store.read(Highlight));
  onCleanup(
    store.subscribe(Highlight, (next) => setIncoming(() => next), { owner }),
  );

  const highlightedDocIds = createMemo(() => {
    const ids = new Set();
    for (const url of Object.keys(incoming())) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    return ids;
  });

  const handle = store.handle(Highlight, owner);
  onCleanup(() => handle.release());
  const write = (urls) => {
    handle.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const url of urls) slice[url] = true;
    });
  };

  return { highlightedDocIds, hover: write, clear: () => write([]) };
}

/**
 * A lazily-populated cache of document titles. `request(url)` kicks off a
 * (deduped) async resolve; `titleOf(url)` reactively returns the resolved
 * title or a short id placeholder.
 * @param {{ find: (url: string) => Promise<{ doc: () => unknown }> }} repo
 */
export function useDocTitles(repo) {
  const [titles, setTitles] = createSignal({});
  const pending = new Set();

  const request = (docUrl) => {
    if (pending.has(docUrl) || titles()[docUrl]) return;
    pending.add(docUrl);
    void (async () => {
      try {
        const handle = await repo.find(docUrl);
        const title = docTitle(handle.doc());
        setTitles((prev) => ({ ...prev, [docUrl]: title ?? shortId(docUrl) }));
      } catch {
        setTitles((prev) => ({ ...prev, [docUrl]: shortId(docUrl) }));
      } finally {
        pending.delete(docUrl);
      }
    })();
  };

  const titleOf = (docUrl) => titles()[docUrl] ?? shortId(docUrl);
  return { titleOf, request };
}

// A human label for a document, trying the common title-bearing fields (the
// same ones the search box reads) without pulling in the datatype registry.
function docTitle(doc) {
  if (!doc) return undefined;
  const candidates = [
    doc["@patchwork"]?.title,
    doc.props?.name,
    doc.place?.name,
    doc.content,
    doc.title,
    doc.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

/** A short id placeholder for a document url. */
export function shortId(docUrl) {
  const id = docUrl.replace(/^automerge:/, "");
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Split a doc or match sub-url (`automerge:<id>/seg/seg`) into its owning
// document url and id. Falls back to the raw url if it can't be parsed.
function splitDocUrl(url) {
  try {
    const { documentId } = parseAutomergeUrl(url);
    return { docUrl: `automerge:${documentId}`, docId: documentId };
  } catch {
    return { docUrl: url, docId: url };
  }
}

function clip(text) {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL)}…` : text;
}

// --- Styles --------------------------------------------------------------------
// Injected page-wide once, when the first token mounts (no shadow DOM).

const STYLE_ID = "embark-selection-tokens-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
/* Shared token styling for context views. */

/* --- Document tokens (selection / highlight / search / commands) ---------- */
/* Each document renders its real embed face (see EmbedToken, via the shared
   token-view), falling back to a title pill. The wrapper drives the shared
   Highlight channel on hover and lights up while its document is highlighted
   by anyone. */

.embark-token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.embark-token {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  cursor: default;
  transition:
    background 0.12s ease,
    box-shadow 0.12s ease;
}

.embark-token::before {
  content: "@";
  opacity: 0.55;
  margin-right: 1px;
}

.embark-token:hover {
  background: rgba(59, 130, 246, 0.22);
}

/* The hover/highlight wrapper around an embed's inline face. Kept separate
   from the face itself (a pill or a card's custom token view) so highlighting
   works regardless of what the embed renderer paints inside. Named distinctly
   from the canvas's own .embark-embed frame class (this stylesheet is injected
   page-wide) to avoid clobbering it. */
.embark-embed-token {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border-radius: 999px;
  cursor: default;
  transition: box-shadow 0.12s ease;
}

.embark-embed-token--highlighted {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.6);
}
`;
