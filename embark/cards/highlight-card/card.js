// Highlight card behavior, loaded by the shared card shell as this package's
// `card.js`. While face-up it reads the shared `highlight` channel (owned by
// the Selection card) and draws a blue glow around every mounted
// `<patchwork-view>` whose document is highlighted — wherever that view is: a
// canvas embed, a sidebar card, a full-frame editor. Renders nothing into the
// middle slot.
//
// This replaces the per-surface special cases (the canvas embed ring, the
// deck thumbnail glow): views are matched generically by their `doc-url` (or
// component-mode `url`) attribute, normalized to document ids because
// highlight keys can be sub-document urls. The glow itself is one injected
// CSS class, so views that mount or repoint after an emission are caught by a
// MutationObserver and classed on arrival.
//
// Plain-JS bundleless module: bare imports are importmap-provided; the core
// platform and the channel definition are imported by their automerge urls.

import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SELECTION_PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

const { subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { Highlight } = await import(
  getImportableUrlFromAutomergeUrl(SELECTION_PACKAGE_URL, "channels.js")
);

const HIGHLIGHT_CLASS = "embark-highlighted";

export default function card(_handle, element) {
  injectStyles();

  // The currently highlighted documents, as bare document ids (highlight keys
  // can be sub-document urls, and so can a view's doc-url).
  let highlightedDocIds = new Set();

  const viewDocId = (view) => {
    const url = view.getAttribute("doc-url") ?? view.getAttribute("url");
    if (!url || !isValidAutomergeUrl(url)) return undefined;
    return parseAutomergeUrl(url).documentId;
  };

  // One full sweep: class every mounted view whose document is highlighted,
  // unclass the rest. Cheap enough to rerun wholesale on every emission and
  // DOM change — no bookkeeping to drift out of sync.
  const apply = () => {
    for (const view of document.querySelectorAll("patchwork-view")) {
      const docId = viewDocId(view);
      view.classList.toggle(
        HIGHLIGHT_CLASS,
        docId !== undefined && highlightedDocIds.has(docId),
      );
    }
  };

  const unsubscribe = subscribeContext(element, Highlight, (all) => {
    const ids = new Set();
    for (const url of Object.keys(all)) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    highlightedDocIds = ids;
    apply();
  });

  // Views that mount (or repoint) after an emission still need their class;
  // sweeps are coalesced to one per frame so a burst of mutations stays cheap.
  let frame = 0;
  const scheduleApply = () => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    }
  };
  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["doc-url", "url"],
  });

  return () => {
    unsubscribe();
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    for (const view of document.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) {
      view.classList.remove(HIGHLIGHT_CLASS);
    }
  };
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-highlight-card-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The same blue ring the canvas embeds used to draw, now on the view itself.
const CSS = `
patchwork-view.${HIGHLIGHT_CLASS} {
  border-radius: 8px;
  box-shadow:
    0 0 0 2px rgba(59, 130, 246, 0.6),
    0 0 16px 2px rgba(59, 130, 246, 0.45);
}
`;
