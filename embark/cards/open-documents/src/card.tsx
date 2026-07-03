import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { OpenDocuments, linkedUrls } from "@embark/schema";

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
const card: ToolRender = (_handle, element) =>
  render(() => <OpenDocumentsCard element={element} />, element);

function OpenDocumentsCard(props: { element: ToolElement }) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree, so the channel
    // handle resolves against the right store.
    const stop = runOpenDocuments(props.element);
    onCleanup(stop);
  });

  return null;
}

export default card;

// Coalesce a burst of doc changes / selection hops into a single closure walk.
const RECOMPUTE_DEBOUNCE_MS = 100;

// One document in the closure, watched for changes (its links can change). The
// handle resolves asynchronously, so it may be briefly absent.
type WatchedDoc = { handle?: DocHandle<unknown> };

function runOpenDocuments(element: ToolElement): () => void {
  const repo = element.repo;
  const openDocs = getContextHandle(element, OpenDocuments);
  const watched = new Map<AutomergeUrl, WatchedDoc>();
  let selected: AutomergeUrl | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const scheduleRecompute = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      recompute();
    }, RECOMPUTE_DEBOUNCE_MS);
  };

  const setSelected = (url: AutomergeUrl | undefined) => {
    if (url === selected) return;
    selected = url;
    scheduleRecompute();
  };

  const ensureWatched = (url: AutomergeUrl): WatchedDoc => {
    let entry = watched.get(url);
    if (entry) return entry;
    entry = {};
    watched.set(url, entry);
    void Promise.resolve(repo.find<unknown>(url))
      .then((handle) => {
        if (stopped || watched.get(url) !== entry) return; // dropped meanwhile
        entry.handle = handle;
        handle.on("change", scheduleRecompute);
        scheduleRecompute();
      })
      .catch(() => {});
    return entry;
  };

  const dropWatched = (url: AutomergeUrl) => {
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
    const reached = new Set<AutomergeUrl>();
    if (selected) {
      reached.add(selected);
      const queue: AutomergeUrl[] = [selected];
      while (queue.length > 0) {
        const url = queue.shift()!;
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
    openDocs.change((slice) => {
      for (const key of Object.keys(slice)) {
        delete slice[key as AutomergeUrl];
      }
      for (const url of reached) slice[url] = true;
    });
  };

  const onOpenDocument = (event: Event) => {
    const url = (event as OpenDocumentEvent).detail?.url;
    setSelected(normalizeDocUrl(url));
  };

  const onHashChange = () => setSelected(selectedFromHash());

  document.body.addEventListener(
    "patchwork:open-document",
    onOpenDocument as EventListener,
  );
  window.addEventListener("hashchange", onHashChange);
  setSelected(selectedFromHash());

  return () => {
    stopped = true;
    document.body.removeEventListener(
      "patchwork:open-document",
      onOpenDocument as EventListener,
    );
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
function selectedFromHash(): AutomergeUrl | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const doc = params.get("doc");
  if (!doc) return undefined;
  return normalizeDocUrl(doc.startsWith("automerge:") ? doc : `automerge:${doc}`);
}

// Normalize any automerge url (possibly carrying heads or a sub-path) to its
// bare document url; undefined when it isn't a valid url at all.
function normalizeDocUrl(url: string | undefined): AutomergeUrl | undefined {
  if (!url || !isValidAutomergeUrl(url)) return undefined;
  return `automerge:${parseAutomergeUrl(url).documentId}` as AutomergeUrl;
}
