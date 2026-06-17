import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { SearchDoc } from "./datatype";

// The search broker. It sits on the canvas element and bridges two roles that
// can't talk directly (the provider protocol only flows up the DOM tree, and
// search boxes / contributors are sibling embeds):
//
//   - search box   subscribe({ type: QUERY_SELECTOR, query, doc })  (registers)
//   - contributor  subscribe({ type: RESPONSES_SELECTOR })          -> response doc url
//
// A contributor reads the active query strings (the keys the broker seeds into
// its response doc) and writes result urls back under each. The broker unions
// every contributor's results per query and writes the plain array straight
// into the matching search box's own `SearchDoc.results` (the box only ever
// writes its `query`; the broker owns `results`).
export const QUERY_SELECTOR = "search:query";
export const RESPONSES_SELECTOR = "search:responses";

// A contributor's response doc: each active query maps to the result document
// urls that contributor surfaces for it. The broker owns the keys (active
// queries); the contributor owns the values.
export type SearchResponseDoc = Record<string, AutomergeUrl[]>;

// A registered search box: its current query plus its own SearchDoc handle,
// which the broker writes aggregated results into. The handle resolves async,
// so it may be undefined for a tick after the box subscribes.
type BoxEntry = { query: string; handle?: DocHandle<SearchDoc> };

export function SearchProvider(element: ToolElement): () => void {
  const repo = element.repo;
  // every live search box waiting on results.
  const boxes = new Set<BoxEntry>();
  // every live contributor's response doc handle.
  const contributors = new Set<DocHandle<SearchResponseDoc>>();

  const activeQueries = () => {
    const set = new Set<string>();
    for (const box of boxes) if (box.query) set.add(box.query);
    return Array.from(set);
  };

  const onSubscribe = (event: SubscribeEvent) => {
    const { type } = event.detail.selector;
    if (type === QUERY_SELECTOR) acceptSearchBox(event);
    else if (type === RESPONSES_SELECTOR) acceptContributor(event);
  };

  // A search box registers itself with its current query and its own doc url.
  // The broker tracks it, makes sure contributors know about the query, and
  // writes the current results into the box's doc once its handle resolves.
  const acceptSearchBox = (event: SubscribeEvent) => {
    const { selector } = event.detail;
    const query = String(selector.query ?? "").trim();
    const docUrl = selector.doc as AutomergeUrl | undefined;
    accept<null>(event, () => {
      const entry: BoxEntry = { query };
      boxes.add(entry);
      syncQueryKeys();
      if (docUrl) {
        void Promise.resolve(repo.find<SearchDoc>(docUrl)).then((handle) => {
          if (!boxes.has(entry)) return; // unsubscribed before it resolved
          entry.handle = handle;
          writeBox(entry);
        });
      }

      return () => {
        boxes.delete(entry);
        syncQueryKeys();
      };
    });
  };

  // A contributor joins. Hand it a fresh response doc seeded with the active
  // queries, relay whenever it writes results, and clean the doc up when it
  // unsubscribes.
  const acceptContributor = (event: SubscribeEvent) => {
    accept<AutomergeUrl>(event, (respond) => {
      const handle = repo.create<SearchResponseDoc>({});
      contributors.add(handle);
      handle.change((doc) => {
        for (const query of activeQueries()) doc[query] = [];
      });
      const onChange = () => emitAll();
      handle.on("change", onChange);
      respond(handle.url);

      return () => {
        contributors.delete(handle);
        handle.off("change", onChange);
        handle.delete();
        emitAll();
      };
    });
  };

  // Mirror the active query set into every contributor doc. Contributors learn
  // what to answer from their doc's keys, so seed new queries (value `[]`) and
  // prune ones no search box is asking for anymore.
  const syncQueryKeys = () => {
    const active = new Set(activeQueries());
    for (const handle of contributors) {
      handle.change((doc) => {
        for (const query of active) {
          if (!(query in doc)) doc[query] = [];
        }
        for (const query of Object.keys(doc)) {
          if (!active.has(query)) delete doc[query];
        }
      });
    }
  };

  // Union (dedup, order-stable) the result urls every contributor wrote for
  // `query`. An empty query has no results.
  const resultsForQuery = (query: string): AutomergeUrl[] => {
    if (!query) return [];
    const seen = new Set<AutomergeUrl>();
    const out: AutomergeUrl[] = [];
    for (const handle of contributors) {
      const urls = handle.doc()?.[query];
      if (!urls) continue;
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        out.push(url);
      }
    }
    return out;
  };

  // Write a box's current results into its own doc, but only when they differ
  // so we never churn the document with identical arrays.
  const writeBox = (entry: BoxEntry) => {
    const handle = entry.handle;
    if (!handle) return;
    const next = resultsForQuery(entry.query);
    handle.change((doc) => {
      if (!sameUrls(doc.results, next)) doc.results = next;
    });
  };

  const emitAll = () => {
    for (const box of boxes) writeBox(box);
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    boxes.clear();
    for (const handle of contributors) handle.delete();
    contributors.clear();
  };
}

function sameUrls(a: AutomergeUrl[] | undefined, b: AutomergeUrl[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}
