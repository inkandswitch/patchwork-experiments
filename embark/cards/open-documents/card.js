// Open Documents card behavior, loaded by the shared card shell as this
// package's `card.js`. While the card sits face-up on a canvas it tracks the
// frame's currently selected document and publishes it — plus every document
// reachable from it through content links (`@patchwork` metadata links are
// skipped) — into the `OpenDocuments` channel. The Schema Matcher card reads
// that set to answer schema queries, so together the two cards replace the old
// canvas-owned resolver that discovered documents through DOM mounted events.
//
// Selection is tracked frame-agnostically: `patchwork:open-document` events are
// `bubbles + composed`, so every open anywhere in the frame reaches
// document.body — which this card listens on, working even while its canvas
// host is parked outside the frame. The initial value (and back/forward
// navigation) is read from the `#doc=<documentId>` hash the frame's router
// maintains. The card renders nothing into the middle slot — the face is drawn
// by the shell.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import { isValidAutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { OpenDocuments } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);
const { linkedUrls } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "doc-links.js")
);

// Coalesce a burst of doc changes / selection hops into a single closure walk.
const RECOMPUTE_DEBOUNCE_MS = 100;

export default function card(_handle, element) {
  console.log("[open-documents] behavior starting", { connected: element.isConnected });
  const repo = element.repo;
  const openDocs = getContextHandle(element, OpenDocuments);
  // One entry per document in the closure, watched for changes (its links can
  // change). The handle resolves asynchronously, so it may be briefly absent.
  const watched = new Map();
  let selected;
  let timer;
  let stopped = false;

  const scheduleRecompute = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      recompute();
    }, RECOMPUTE_DEBOUNCE_MS);
  };

  const setSelected = (url) => {
    if (url === selected) return;
    console.log(`[open-documents] selected doc: ${url ?? "<none>"}`);
    selected = url;
    scheduleRecompute();
  };

  const ensureWatched = (url) => {
    let entry = watched.get(url);
    if (entry) return entry;
    entry = {};
    watched.set(url, entry);
    void Promise.resolve(repo.find(url))
      .then((handle) => {
        if (stopped || watched.get(url) !== entry) return; // dropped meanwhile
        entry.handle = handle;
        handle.on("change", scheduleRecompute);
        scheduleRecompute();
      })
      .catch(() => {});
    return entry;
  };

  const dropWatched = (url) => {
    const entry = watched.get(url);
    if (!entry) return;
    watched.delete(url);
    entry.handle?.off("change", scheduleRecompute);
  };

  // Breadth-first closure from the selected doc, following content links
  // (`linkedUrls` skips the `@patchwork` subtree). Docs still resolving stay in
  // the set — they're published immediately and their links join on the
  // recompute their handle triggers once loaded. Docs that fall out of the
  // closure are unwatched, and the whole set is rewritten into our one scoped
  // slice of the channel.
  const recompute = () => {
    const reached = new Set();
    if (selected) {
      reached.add(selected);
      const queue = [selected];
      while (queue.length > 0) {
        const url = queue.shift();
        const doc = ensureWatched(url).handle?.doc();
        if (!doc) continue;
        for (const link of linkedUrls(doc)) {
          if (reached.has(link)) continue;
          reached.add(link);
          queue.push(link);
        }
      }
    }
    for (const url of [...watched.keys()]) {
      if (!reached.has(url)) dropWatched(url);
    }
    console.log(
      `[open-documents] publishing ${reached.size} doc(s) into open-documents:`,
      [...reached],
    );
    openDocs.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const url of reached) slice[url] = true;
    });
  };

  const onOpenDocument = (event) => {
    setSelected(normalizeDocUrl(event.detail?.url));
  };

  const onHashChange = () => setSelected(selectedFromHash());

  document.body.addEventListener("patchwork:open-document", onOpenDocument);
  window.addEventListener("hashchange", onHashChange);
  console.log(`[open-documents] initial hash selection: ${selectedFromHash() ?? "<none>"}`);
  setSelected(selectedFromHash());

  return () => {
    console.log("[open-documents] behavior stopping, releasing slice");
    stopped = true;
    document.body.removeEventListener("patchwork:open-document", onOpenDocument);
    window.removeEventListener("hashchange", onHashChange);
    if (timer !== undefined) clearTimeout(timer);
    for (const url of [...watched.keys()]) dropWatched(url);
    // Releasing the slice drops our whole contribution from the merged set.
    openDocs.release();
  };
}

// The frame's hash routing carries the selection as `#doc=<documentId>` (with
// optional `&tool=`/`&heads=` params) — the same format base-2's
// SelectedDocProvider reads. Normalized down to a bare document url.
function selectedFromHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const doc = params.get("doc");
  if (!doc) return undefined;
  return normalizeDocUrl(doc.startsWith("automerge:") ? doc : `automerge:${doc}`);
}

// Normalize any automerge url (possibly carrying heads or a sub-path) to its
// bare document url; undefined when it isn't a valid url at all.
function normalizeDocUrl(url) {
  if (!url || !isValidAutomergeUrl(url)) return undefined;
  return `automerge:${parseAutomergeUrl(url).documentId}`;
}
