import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { MountedEvent, UnmountedEvent } from "@inkandswitch/patchwork-elements";
import type { z } from "zod";
import { jsonSchemaToZod, type JsonSchema } from "../../lib/schema";
import { extractDocLinks } from "../../lib/doc-links";

// A provider that answers "where does this schema occur?". A consumer subscribes
// with a JSON Schema:
//
//   subscribe<AutomergeUrl[]>(el, { type: "schema:matches", schema })
//
// and gets back match urls — each a native automerge sub-url
// (`automerge:<id>/seg/seg`, from `handle.sub(...segments).url`) pointing at the
// exact subtree that matched (the bare document url when the whole doc matched).
// The provider watches every document mounted beneath it (via
// `patchwork:mounted` / `patchwork:unmounted` from `<patchwork-view>`),
// traverses each one — plus any document it links to via an `automerge:` string
// — and re-emits whenever the reachable docs, their contents, or the set of
// subscribers change. Documents that live *inside* an opaque container (see
// OPAQUE_CONTAINER_TYPES) are deliberately hidden from this traversal.
export const MATCHES_SELECTOR = "schema:matches";

// Coalesce bursts (a doc change plus a mount, say) into a single pass.
const REEVAL_DEBOUNCE_MS = 50;

// Opaque containers: documents whose internals are private machinery rather than
// canvas content, so the schema matcher must treat everything *inside* them as
// invisible. An llm-card is the motivating case — it keeps its generated spec
// (a markdown doc) and effect code (a folder of files) only to implement
// itself, and those must never surface as canvas matches (otherwise, e.g., an
// annotation contributor would decorate a card's private spec). For these types
// we don't follow the container's links into its internals, AND we exclude
// those internal docs from matching even when they're mounted directly (e.g. a
// spec opened in the inspector tool). The container document itself stays
// matchable; only its contents are ignored. Flag-driven so it's easy to extend.
const OPAQUE_CONTAINER_TYPES = new Set<string>(["llm-card"]);

type Subscriber = {
  schema: z.ZodType;
  respond: (urls: AutomergeUrl[]) => void;
  last?: AutomergeUrl[];
};

// A mounted document. The same url can be mounted by several embeds at once, so
// we refcount and only resolve/release the handle on the 0↔1 edges.
type MountedDoc = { refs: number; handle?: DocHandle<unknown> };

// A document reached only by following a link from another doc. Loaded lazily
// and pruned once nothing links to it anymore.
type ReferencedDoc = { handle?: DocHandle<unknown> };

export function SchemaMatchProvider(element: ToolElement): () => void {
  const repo = element.repo;
  const subscribers = new Set<Subscriber>();
  const mounted = new Map<AutomergeUrl, MountedDoc>();
  const referenced = new Map<AutomergeUrl, ReferencedDoc>();

  let scheduled = false;
  const scheduleReevaluate = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      reevaluateAll();
    }, REEVAL_DEBOUNCE_MS);
  };

  const onSubscribe = (event: SubscribeEvent) => {
    if (event.detail.selector.type !== MATCHES_SELECTOR) return;
    const schema = jsonSchemaToZod(event.detail.selector.schema as JsonSchema);
    accept<AutomergeUrl[]>(event, (respond) => {
      const subscriber: Subscriber = { schema, respond };
      subscribers.add(subscriber);
      scheduleReevaluate();
      return () => subscribers.delete(subscriber);
    });
  };

  // Track docs mounted by descendant `<patchwork-view>`s (and synthetic mounts,
  // e.g. the POI provider's cards). The canvas's own mount event (target ===
  // the provider element) is ignored — we match the contents inside the canvas,
  // not the container. Component mounts carry no doc url, so they're ignored.
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

  // Recompute each subscriber's matches over the reachable doc closure and push
  // only when they changed, so an unrelated doc edit doesn't churn subscribers.
  const reevaluateAll = () => {
    const reachable = collectReachable();
    for (const subscriber of subscribers) {
      const matches: AutomergeUrl[] = [];
      for (const handle of reachable.values()) {
        collectMatches(handle.doc(), [], subscriber.schema, handle, matches);
      }
      if (subscriber.last && sameUrls(subscriber.last, matches)) continue;
      subscriber.last = matches;
      subscriber.respond(matches);
    }
  };

  // Breadth-first closure from the mounted roots, following document links found
  // in string values. Lazily loads linked docs and prunes ones no longer
  // referenced. Returns every loaded doc's handle reachable this pass, keyed by
  // url (so a doc reached both directly and via a link appears once). The handle
  // (not just the doc) is carried so matches can be emitted as sub-urls.
  //
  // Anything that lives inside an opaque container is hidden: such docs are
  // never added to the result and the closure never expands into them, so they
  // can't be matched no matter how they were reached (linked from the container
  // or mounted on their own).
  const collectReachable = (): Map<AutomergeUrl, DocHandle<unknown>> => {
    // Decide what to hide first, so it doesn't matter whether a hidden doc is
    // dequeued before or after the container that owns it.
    const ignored = collectIgnored();

    const reachable = new Map<AutomergeUrl, DocHandle<unknown>>();
    // Keep the hidden docs loaded (we need the folder/files to know they're
    // hidden) so the prune step below doesn't immediately drop them.
    const neededRefs = new Set<AutomergeUrl>(ignored);
    const enqueued = new Set<AutomergeUrl>(mounted.keys());
    const queue = [...mounted.keys()];

    while (queue.length > 0) {
      const url = queue.shift()!;
      // A mounted root that is really a container's internal doc (e.g. a card's
      // spec opened in the inspector) is hidden, not matched.
      if (ignored.has(url)) continue;
      const handle = mounted.get(url)?.handle ?? referenced.get(url)?.handle;
      const doc = handle?.doc();
      if (!handle || !doc) continue; // a referenced doc still resolving — revisit on load
      reachable.set(url, handle);

      // An opaque container exposes nothing to the matcher: don't descend into
      // its links — its internals are already accounted for in `ignored`.
      if (OPAQUE_CONTAINER_TYPES.has(docType(doc) ?? "")) continue;

      for (const link of linkedUrls(doc)) {
        if (ignored.has(link)) continue; // never traverse into hidden internals
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

  // Compute the closure of documents that live inside an opaque container and so
  // must be hidden from matching. Seeded with the links out of every loaded
  // opaque container (e.g. an llm-card -> its spec doc + effect folder) and
  // extended transitively (folder -> its files). Internal docs are loaded as
  // referenced so we can read their own links, but they are never matched and
  // never expand the reachable closure. The container itself is NOT added here —
  // only its contents are ignored.
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

    // Seed from every opaque container currently loaded (mounted on the canvas
    // or pulled in as a reference by an earlier pass).
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

    // Walk inward so nested internals are hidden too (a card's folder pulls in
    // the folder's files). Docs still loading are revisited on a later pass,
    // since their load/change reschedules a re-evaluation.
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

  element.addEventListener("patchwork:subscribe", onSubscribe);
  element.addEventListener("patchwork:mounted", onMounted);
  element.addEventListener("patchwork:unmounted", onUnmounted);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    element.removeEventListener("patchwork:mounted", onMounted);
    element.removeEventListener("patchwork:unmounted", onUnmounted);
    for (const entry of mounted.values()) {
      entry.handle?.off("change", scheduleReevaluate);
    }
    for (const ref of referenced.values()) {
      ref.handle?.off("change", scheduleReevaluate);
    }
    mounted.clear();
    referenced.clear();
    subscribers.clear();
  };
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

function sameUrls(a: AutomergeUrl[], b: AutomergeUrl[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, index) => url === b[index]);
}
