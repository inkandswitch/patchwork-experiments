import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type {
  MountedEvent,
  UnmountedEvent,
} from "@inkandswitch/patchwork-elements";
import type { z } from "zod";
import { jsonSchemaToZod, type JsonSchema } from "../lib/schema";
import { extractDocLinks } from "../lib/doc-links";
import type { ContextStore } from "../lib/context";
import { SchemaMatches, SchemaQueries, type SchemaQuery } from "./channels";

// Resolves "where does this schema occur?" for the canvas. This is plain canvas
// code, not a provider: it reads the requested schemas from the `SchemaQueries`
// channel and writes match urls into `SchemaMatches`, keyed by the same
// correlation key (`schemaKey`). Mounted-doc discovery stays on the
// `patchwork:mounted` / `patchwork:unmounted` events (a DOM concern), so this
// covers nested views and synthetic POI mounts for free.
//
// Each match url is a native automerge sub-url (`automerge:<id>/seg/seg`, from
// `handle.sub(...segments).url`) pointing at the exact subtree that matched (the
// bare document url when the whole doc matched). It watches every document
// mounted beneath `element` (plus any document they link to via an `automerge:`
// string) and recomputes whenever the reachable docs, their contents, or the
// requested schemas change. Documents inside an opaque container (see
// OPAQUE_CONTAINER_TYPES) are deliberately hidden from this traversal.

// Coalesce bursts (a doc change plus a mount, say) into a single pass.
const REEVAL_DEBOUNCE_MS = 50;

// Opaque containers: documents whose internals are private machinery rather than
// canvas content, so the matcher must treat everything *inside* them as
// invisible. An llm-card is the motivating case — it keeps its generated spec
// (a markdown doc) and effect code (a folder of files) only to implement
// itself, and those must never surface as canvas matches. For these types we
// don't follow the container's links into its internals, AND we exclude those
// internal docs from matching even when mounted directly. The container itself
// stays matchable; only its contents are ignored.
const OPAQUE_CONTAINER_TYPES = new Set<string>(["llm-card"]);

// A mounted document. The same url can be mounted by several embeds at once, so
// we refcount and only resolve/release the handle on the 0<->1 edges.
type MountedDoc = { refs: number; handle?: DocHandle<unknown> };

// A document reached only by following a link from another doc. Loaded lazily
// and pruned once nothing links to it anymore.
type ReferencedDoc = { handle?: DocHandle<unknown> };

export function runSchemaResolver(
  store: ContextStore,
  element: HTMLElement,
  repo: Repo,
): () => void {
  const mounted = new Map<AutomergeUrl, MountedDoc>();
  const referenced = new Map<AutomergeUrl, ReferencedDoc>();

  // The resolver is the single writer of the SchemaMatches channel.
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

  // Track docs mounted by descendant `<patchwork-view>`s (and synthetic mounts,
  // e.g. the POI provider's cards). The canvas's own mount event (target ===
  // element) is ignored — we match the contents inside the canvas, not the
  // container. Component mounts carry no doc url, so they're ignored.
  const onMounted = (event: MountedEvent) => {
    if (event.target === element) return;
    if (!("url" in event.detail)) return;
    track(event.detail.url);
  };

  const onUnmounted = (event: UnmountedEvent) => {
    if (event.target === element) return;
    if (!("url" in event.detail)) return;
    untrack(event.detail.url);
  };

  const track = (url: AutomergeUrl) => {
    const existing = mounted.get(url);
    if (existing) {
      existing.refs++;
      return;
    }
    const entry: MountedDoc = { refs: 1 };
    mounted.set(url, entry);
    void Promise.resolve(repo.find<unknown>(url))
      .then((handle) => {
        if (mounted.get(url) !== entry) return; // unmounted before it resolved
        entry.handle = handle;
        handle.on("change", scheduleReevaluate);
        scheduleReevaluate();
      })
      .catch(() => {});
  };

  const untrack = (url: AutomergeUrl) => {
    const entry = mounted.get(url);
    if (!entry) return;
    entry.refs--;
    if (entry.refs > 0) return;
    mounted.delete(url);
    entry.handle?.off("change", scheduleReevaluate);
    scheduleReevaluate();
  };

  // Recompute every requested schema's matches over the reachable doc closure
  // and write the whole map. The store suppresses identical emissions, so an
  // unrelated doc edit doesn't churn readers.
  const reevaluateAll = () => {
    const reachable = collectReachable();
    const result: Record<string, AutomergeUrl[]> = {};
    for (const [key, query] of Object.entries(queries)) {
      let schema = compiled.get(key);
      if (!schema) {
        schema = jsonSchemaToZod(querySchema(query));
        compiled.set(key, schema);
      }
      const matches: AutomergeUrl[] = [];
      for (const handle of reachable.values()) {
        collectMatches(handle.doc(), [], schema, handle, matches);
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

  // Breadth-first closure from the mounted roots, following document links found
  // in string values. Lazily loads linked docs and prunes ones no longer
  // referenced. Returns every loaded doc's handle reachable this pass, keyed by
  // url (so a doc reached both directly and via a link appears once). The handle
  // (not just the doc) is carried so matches can be emitted as sub-urls.
  //
  // Anything that lives inside an opaque container is hidden: such docs are
  // never added to the result and the closure never expands into them, so they
  // can't be matched no matter how they were reached.
  const collectReachable = (): Map<AutomergeUrl, DocHandle<unknown>> => {
    const ignored = collectIgnored();

    const reachable = new Map<AutomergeUrl, DocHandle<unknown>>();
    const neededRefs = new Set<AutomergeUrl>(ignored);
    const enqueued = new Set<AutomergeUrl>(mounted.keys());
    const queue = [...mounted.keys()];

    while (queue.length > 0) {
      const url = queue.shift()!;
      if (ignored.has(url)) continue;
      const handle = mounted.get(url)?.handle ?? referenced.get(url)?.handle;
      const doc = handle?.doc();
      if (!handle || !doc) continue; // a referenced doc still resolving
      reachable.set(url, handle);

      if (OPAQUE_CONTAINER_TYPES.has(docType(doc) ?? "")) continue;

      for (const link of linkedUrls(doc)) {
        if (ignored.has(link)) continue;
        if (!mounted.has(link)) {
          neededRefs.add(link);
          ensureReferenced(link);
        }
        if (!enqueued.has(link)) {
          enqueued.add(link);
          queue.push(link);
        }
      }
    }

    for (const [url, ref] of referenced) {
      if (neededRefs.has(url)) continue;
      ref.handle?.off("change", scheduleReevaluate);
      referenced.delete(url);
    }

    return reachable;
  };

  // The closure of documents that live inside an opaque container and so must be
  // hidden from matching. Seeded with the links out of every loaded opaque
  // container and extended transitively. Internal docs are loaded as referenced
  // so we can read their own links, but they are never matched and never expand
  // the reachable closure. The container itself is NOT added here.
  const collectIgnored = (): Set<AutomergeUrl> => {
    const ignored = new Set<AutomergeUrl>();
    const queue: AutomergeUrl[] = [];

    const hide = (links: AutomergeUrl[]) => {
      for (const link of links) {
        if (ignored.has(link)) continue;
        ignored.add(link);
        ensureReferenced(link);
        queue.push(link);
      }
    };

    for (const entry of mounted.values()) {
      const doc = entry.handle?.doc();
      if (doc && OPAQUE_CONTAINER_TYPES.has(docType(doc) ?? "")) {
        hide(linkedUrls(doc));
      }
    }
    for (const ref of referenced.values()) {
      const doc = ref.handle?.doc();
      if (doc && OPAQUE_CONTAINER_TYPES.has(docType(doc) ?? "")) {
        hide(linkedUrls(doc));
      }
    }

    while (queue.length > 0) {
      const url = queue.shift()!;
      const doc =
        mounted.get(url)?.handle?.doc() ?? referenced.get(url)?.handle?.doc();
      if (!doc) continue;
      hide(linkedUrls(doc));
    }

    return ignored;
  };

  const ensureReferenced = (url: AutomergeUrl) => {
    if (mounted.has(url) || referenced.has(url)) return;
    const ref: ReferencedDoc = {};
    referenced.set(url, ref);
    void Promise.resolve(repo.find<unknown>(url))
      .then((handle) => {
        if (referenced.get(url) !== ref) return; // pruned before it resolved
        ref.handle = handle;
        handle.on("change", scheduleReevaluate);
        scheduleReevaluate();
      })
      .catch(() => {});
  };

  element.addEventListener("patchwork:mounted", onMounted as EventListener);
  element.addEventListener("patchwork:unmounted", onUnmounted as EventListener);
  scheduleReevaluate();

  return () => {
    element.removeEventListener("patchwork:mounted", onMounted as EventListener);
    element.removeEventListener(
      "patchwork:unmounted",
      onUnmounted as EventListener,
    );
    for (const entry of mounted.values()) {
      entry.handle?.off("change", scheduleReevaluate);
    }
    for (const ref of referenced.values()) {
      ref.handle?.off("change", scheduleReevaluate);
    }
    mounted.clear();
    referenced.clear();
    compiled.clear();
    unsubscribeQueries();
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

// The patchwork datatype a document declares (`@patchwork.type`), if any. Used
// to recognize opaque containers (see OPAQUE_CONTAINER_TYPES).
function docType(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const meta = (doc as { "@patchwork"?: { type?: unknown } })["@patchwork"];
  return meta && typeof meta.type === "string" ? meta.type : undefined;
}

// Every document url referenced by a string anywhere in `doc`.
function linkedUrls(doc: unknown): AutomergeUrl[] {
  const out = new Set<AutomergeUrl>();
  walk(doc);
  return [...out];

  function walk(node: unknown): void {
    if (typeof node === "string") {
      for (const url of extractDocLinks(node)) out.add(url);
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (node !== null && typeof node === "object") {
      for (const child of Object.values(node)) walk(child);
    }
  }
}

// Depth-first walk: test every node against the schema and record the native
// sub-url of each match. A node and its descendants are all candidates, so one
// document can yield several distinct match locations. Links are not followed
// here — the reachable closure already supplies linked docs as their own roots.
function collectMatches(
  node: unknown,
  segments: (string | number)[],
  schema: z.ZodType,
  handle: DocHandle<unknown>,
  out: AutomergeUrl[],
): void {
  if (schema.safeParse(node).success) out.push(handle.sub(...segments).url);

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
