import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { z } from "zod";
import { jsonSchemaToZod, type JsonSchema } from "./schema";
import {
  OpenDocuments,
  SchemaMatches,
  SchemaQueries,
  type SchemaQuery,
} from "./channels";
import type { ContextStore } from "@embark/context";

// Answers "where does this schema occur?" over the open-document set. Reads the
// requested schemas from the `SchemaQueries` channel, matches them against
// every document listed in the `OpenDocuments` channel, and writes match urls
// into `SchemaMatches` keyed by the same correlation key (`schemaKey`).
//
// Discovery is entirely channel-driven: whoever wants a document matched
// publishes its url into `OpenDocuments` (the Open Documents card contributes
// the frame's selected doc plus its link closure; the POI provider and
// stickerable card contribute their minted docs). This replaces the old
// canvas-owned resolver that discovered documents through DOM
// `patchwork:mounted` events and walked links itself — the closure is now the
// writer's job, so the matcher only ever looks at the urls it is handed.
//
// Each match url is a native automerge sub-url (`automerge:<id>/seg/seg`, from
// `handle.sub(...segments).url`) pointing at the exact subtree that matched
// (the bare document url when the whole doc matched). Matching recomputes
// whenever the open-document set, a watched document's contents, or the
// requested schemas change.

// Coalesce bursts (a doc change plus a set change, say) into a single pass.
const REEVAL_DEBOUNCE_MS = 50;

// One watched open document. The handle resolves asynchronously, so it may be
// briefly absent; a doc that never loads simply contributes no matches.
type WatchedDoc = { handle?: DocHandle<unknown> };

export function runSchemaMatcher(store: ContextStore, repo: Repo): () => void {
  const watched = new Map<AutomergeUrl, WatchedDoc>();

  // The matcher is the single writer of the SchemaMatches channel.
  const matchesHandle = store.handle(SchemaMatches);

  // The requested schemas, keyed by schemaKey, plus a cache of their compiled
  // zod equivalents so we hydrate each JSON Schema only once.
  let queries: Record<string, SchemaQuery> = store.read(SchemaQueries);
  const compiled = new Map<string, z.ZodType>();

  const unsubscribeQueries = store.subscribe(SchemaQueries, (next) => {
    queries = next;
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
  const onOpenDocuments = (all: Record<AutomergeUrl, true>) => {
    const wanted = new Set(Object.keys(all) as AutomergeUrl[]);
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
  );
  onOpenDocuments(store.read(OpenDocuments));

  const watch = (url: AutomergeUrl) => {
    const entry: WatchedDoc = {};
    watched.set(url, entry);
    void Promise.resolve(repo.find<unknown>(url))
      .then((handle) => {
        if (watched.get(url) !== entry) return; // dropped before it resolved
        entry.handle = handle;
        handle.on("change", scheduleReevaluate);
        scheduleReevaluate();
      })
      .catch(() => {});
  };

  const unwatch = (url: AutomergeUrl) => {
    const entry = watched.get(url);
    if (!entry) return;
    watched.delete(url);
    entry.handle?.off("change", scheduleReevaluate);
  };

  // Recompute every requested schema's matches over the watched docs and write
  // the whole map. The store suppresses identical emissions, so an unrelated
  // doc edit doesn't churn readers.
  const reevaluateAll = () => {
    const result: Record<string, AutomergeUrl[]> = {};
    for (const [key, query] of Object.entries(queries)) {
      let schema = compiled.get(key);
      if (!schema) {
        schema = jsonSchemaToZod(querySchema(query));
        compiled.set(key, schema);
      }
      const matches: AutomergeUrl[] = [];
      for (const entry of watched.values()) {
        const handle = entry.handle;
        const doc = handle?.doc();
        if (!handle || !doc) continue; // still resolving
        collectMatches(doc, [], schema, handle, matches);
      }
      result[key] = matches;
    }
    for (const key of [...compiled.keys()]) {
      if (!(key in queries)) compiled.delete(key);
    }
    matchesHandle.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      Object.assign(slice, result);
    });
  };

  scheduleReevaluate();

  return () => {
    unsubscribeQueries();
    unsubscribeOpenDocuments();
    for (const url of [...watched.keys()]) unwatch(url);
    compiled.clear();
    matchesHandle.release();
  };
}

// The schema to match from a query value. New consumers publish a
// `{ name, schema }` query; older generated cards may still write a bare JSON
// Schema, so unwrap `.schema` only when present and otherwise treat the value
// as the schema itself. (JSON Schema's own keyword is `$schema`, never bare
// `schema`, so this discrimination is safe.)
function querySchema(query: SchemaQuery | JsonSchema): JsonSchema {
  if (
    query !== null &&
    typeof query === "object" &&
    !Array.isArray(query) &&
    "schema" in query
  ) {
    return (query as SchemaQuery).schema;
  }
  return query as JsonSchema;
}

// Depth-first walk: test every node against the schema and record the native
// sub-url of each match. A node and its descendants are all candidates, so one
// document can yield several distinct match locations. Links are not followed
// here — the open-document set already supplies linked docs as their own roots.
function collectMatches(
  node: unknown,
  segments: (string | number)[],
  schema: z.ZodType,
  handle: DocHandle<unknown>,
  out: AutomergeUrl[],
): void {
  // An empty array vacuously satisfies any "array of X" schema, but an empty
  // collection is never a meaningful occurrence (e.g. an empty route), so don't
  // report it. Non-empty arrays that are merely too short for a given consumer
  // are left for that consumer to filter (the map drops 1-point lines).
  const vacuousArray = Array.isArray(node) && node.length === 0;
  if (!vacuousArray && schema.safeParse(node).success) {
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
