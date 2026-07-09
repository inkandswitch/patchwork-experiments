// Schema Matcher card behavior, loaded by the shared card shell as this
// package's `card.js`. While the card sits face-up on a canvas it runs the
// matcher engine against that canvas's context store, answering "where does
// this schema occur?" over the open-document set. The queries are the
// *declared read interests* on the `SchemaMatches` channel itself: a consumer
// subscribes with `keys: [schemaKey(schema)]` — each key is the canonical
// schema JSON, parsed back with JSON.parse — and the matcher unions those keys
// over `store.interests(SchemaMatches)`, matches each schema against every
// document listed in the `OpenDocuments` channel, and writes match urls into
// `SchemaMatches` under the same key. Reading *is* asking; there is no
// separate query channel. (Readers that declare no keys — the context viewer,
// say — are passive observers and create no queries.)
//
// Discovery is entirely channel-driven: whoever wants a document matched
// publishes its url into `OpenDocuments` (the Open Documents card contributes
// the frame's selected doc plus its link closure; the POI provider and
// stickerable card contribute their minted docs). The closure is the writer's
// job, so the matcher only ever looks at the urls it is handed.
//
// Each match url is a native automerge sub-url (`automerge:<id>/seg/seg`,
// from `handle.sub(...segments).url`) pointing at the exact subtree that
// matched (the bare document url when the whole doc matched). Matching
// recomputes whenever the open-document set, a watched document's contents,
// or the requested schemas change. Flipping or removing the card releases the
// matches slice and stops answering. It renders nothing into the middle slot
// — the face is drawn by the shell.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import { OpenDocuments, SchemaMatches } from "./channels.js";
import { jsonSchemaMatches } from "./match.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { findContextStore, requireOwner } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

// Coalesce bursts (a doc change plus a set change, say) into a single pass.
const REEVAL_DEBOUNCE_MS = 50;

// The json-schema context view rides this module's `plugins` export: the card
// shell registers it when the card first turns face-up and keeps it until the
// card leaves the canvas.
export const plugins = [
  {
    type: "embark:context-view",
    id: "json-schema-context-view",
    name: "JSON Schema context view",
    supports: ["json-schema"],
    async load() {
      const { jsonSchemaView } = await import("./views.js");
      return jsonSchemaView;
    },
  },
];

export default function card(_handle, element) {
  console.log("[schema-matcher] behavior starting", { connected: element.isConnected });
  // Discovery runs from the card's element in the canvas subtree, so the
  // store resolves to the canvas's context (or the page-global body store)
  // and the owner to this card's embed — that's what lets the context viewer
  // attribute the matcher's reads and writes to this card.
  return runSchemaMatcher(
    findContextStore(element),
    element.repo,
    requireOwner(element),
  );
}

// `owner` tags the matcher's write scope and read subscriptions with the card
// that runs it, so the context viewer can attribute `schema:matches` to this
// card and list it as a reader of `open-documents` (which it genuinely
// consumes whole, so no key interest is declared).
function runSchemaMatcher(store, repo, owner) {
  // One watched open document each: `{ handle? }` — the handle resolves
  // asynchronously, so it may be briefly absent; a doc that never loads simply
  // contributes no matches.
  const watched = new Map();

  // The matcher is the single writer of the SchemaMatches channel.
  const matchesHandle = store.handle(SchemaMatches, owner);

  // The requested schemas — the union of keys declared by SchemaMatches
  // readers (each key is the canonical schema JSON) — plus a cache of their
  // parsed forms so we parse each one only once.
  let queryKeys = readQueryKeys(store);
  const parsed = new Map();

  // The reader registry is store-wide and churns on any (un)subscription, so
  // re-derive the key union and reevaluate only when it actually changed.
  const unsubscribeReaders = store.subscribeReaders(() => {
    const next = readQueryKeys(store);
    if (sameKeys(next, queryKeys)) return;
    console.log(`[schema-matcher] query keys changed: ${next.size} schema(s) requested`);
    queryKeys = next;
    scheduleReevaluate();
  });

  let scheduled = false;
  const scheduleReevaluate = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      reevaluateAll();
    }, REEVAL_DEBOUNCE_MS);
  };

  // Reconcile the watched set against the channel's url union: watch new urls,
  // drop ones no writer contributes anymore.
  const onOpenDocuments = (all) => {
    const wanted = new Set(Object.keys(all));
    console.log(
      `[schema-matcher] open-documents set: ${wanted.size} doc(s)`,
      [...wanted],
    );
    for (const url of wanted) if (!watched.has(url)) watch(url);
    for (const url of [...watched.keys()]) {
      if (!wanted.has(url)) unwatch(url);
    }
    scheduleReevaluate();
  };

  // `store.subscribe` emits only on change, so seed from a direct read.
  const unsubscribeOpenDocuments = store.subscribe(
    OpenDocuments,
    onOpenDocuments,
    { owner },
  );
  onOpenDocuments(store.read(OpenDocuments));

  const watch = (url) => {
    const entry = {};
    watched.set(url, entry);
    void Promise.resolve(repo.find(url))
      .then((handle) => {
        if (watched.get(url) !== entry) return; // dropped before it resolved
        entry.handle = handle;
        handle.on("change", scheduleReevaluate);
        scheduleReevaluate();
      })
      .catch(() => {});
  };

  const unwatch = (url) => {
    const entry = watched.get(url);
    if (!entry) return;
    watched.delete(url);
    entry.handle?.off("change", scheduleReevaluate);
  };

  // Recompute every requested schema's matches over the watched docs and write
  // the whole map. A queried key always gets an entry (an empty array when
  // nothing matches) so the request stays visible; keys whose last reader left
  // drop out via the clear-and-assign. The store suppresses identical
  // emissions, so an unrelated doc edit doesn't churn readers.
  const reevaluateAll = () => {
    const result = {};
    for (const key of queryKeys) {
      let schema = parsed.get(key);
      if (schema === undefined) {
        schema = parseQueryKey(key);
        if (schema === undefined) continue; // not a valid schema key; skip
        parsed.set(key, schema);
      }
      const matches = [];
      for (const entry of watched.values()) {
        const handle = entry.handle;
        const doc = handle?.doc();
        if (!handle || !doc) continue; // still resolving
        collectMatches(doc, [], schema, handle, matches);
      }
      result[key] = matches;
    }
    for (const key of [...parsed.keys()]) {
      if (!queryKeys.has(key)) parsed.delete(key);
    }
    console.log(
      `[schema-matcher] reevaluated ${queryKeys.size} schema(s) over ${watched.size} doc(s):`,
      Object.fromEntries(
        Object.entries(result).map(([key, urls]) => [key, `${urls.length} match(es)`]),
      ),
    );
    matchesHandle.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      Object.assign(slice, result);
    });
  };

  scheduleReevaluate();

  return () => {
    console.log("[schema-matcher] behavior stopping, releasing matches slice");
    unsubscribeReaders();
    unsubscribeOpenDocuments();
    for (const url of [...watched.keys()]) unwatch(url);
    parsed.clear();
    matchesHandle.release();
  };
}

// The current demand: the union of keys declared by SchemaMatches readers.
// Interests without keys are passive whole-channel observers, not queries.
function readQueryKeys(store) {
  const keys = new Set();
  for (const interest of store.interests(SchemaMatches)) {
    for (const key of interest.keys ?? []) keys.add(key);
  }
  return keys;
}

function sameKeys(a, b) {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

// A set member back to its schema: the key is `schemaKey(schema)` — canonical
// JSON — so parsing recovers it exactly. A key that doesn't parse (a rogue
// writer) yields no matches rather than throwing mid-pass.
function parseQueryKey(key) {
  try {
    return JSON.parse(key);
  } catch {
    return undefined;
  }
}

// Depth-first walk: test every node against the schema and record the native
// sub-url of each match. A node and its descendants are all candidates, so one
// document can yield several distinct match locations. Links are not followed
// here — the open-document set already supplies linked docs as their own roots.
function collectMatches(node, segments, schema, handle, out) {
  // An empty array vacuously satisfies any "array of X" schema, but an empty
  // collection is never a meaningful occurrence (e.g. an empty route), so don't
  // report it. Non-empty arrays that are merely too short for a given consumer
  // are left for that consumer to filter (the map drops 1-point lines).
  const vacuousArray = Array.isArray(node) && node.length === 0;
  if (!vacuousArray && jsonSchemaMatches(schema, node)) {
    out.push(handle.sub(...segments).url);
  }

  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collectMatches(child, [...segments, index], schema, handle, out),
    );
  } else if (node !== null && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      collectMatches(child, [...segments, key], schema, handle, out);
    }
  }
}
