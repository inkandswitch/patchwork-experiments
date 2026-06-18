import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import type { MountedEvent, UnmountedEvent } from "@inkandswitch/patchwork-elements";
import type { z } from "zod";
import { jsonSchemaToZod, type JsonSchema } from "../../lib/schema";
import { extractDocLinks, joinPointer, makeMatchUrl } from "../../lib/match-url";

// A provider that answers "where does this schema occur?". A consumer subscribes
// with a JSON Schema:
//
//   subscribe<AutomergeUrl[]>(el, { type: "schema:matches", schema })
//
// and gets back match urls — each a document url with a JSON Pointer fragment
// (see match-url.ts) pointing at the exact subtree that matched. The provider
// watches every document mounted beneath it (via `patchwork:mounted` /
// `patchwork:unmounted` from `<patchwork-view>`), traverses each one — plus any
// document it links to via an `automerge:` / `/#doc=` string — and re-emits
// whenever the reachable docs, their contents, or the set of subscribers change.
export const MATCHES_SELECTOR = "schema:matches";

// Coalesce bursts (a doc change plus a mount, say) into a single pass.
const REEVAL_DEBOUNCE_MS = 50;

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
      for (const [url, doc] of reachable) {
        collectMatches(doc, "", subscriber.schema, url, matches);
      }
      if (subscriber.last && sameUrls(subscriber.last, matches)) continue;
      subscriber.last = matches;
      subscriber.respond(matches);
    }
  };

  // Breadth-first closure from the mounted roots, following document links found
  // in string values. Lazily loads linked docs and prunes ones no longer
  // referenced. Returns every loaded doc reachable this pass, keyed by url (so a
  // doc reached both directly and via a link appears once).
  const collectReachable = (): Map<AutomergeUrl, unknown> => {
    const reachable = new Map<AutomergeUrl, unknown>();
    const neededRefs = new Set<AutomergeUrl>();
    const enqueued = new Set<AutomergeUrl>(mounted.keys());
    const queue = [...mounted.keys()];

    while (queue.length > 0) {
      const url = queue.shift()!;
      const handle = mounted.get(url)?.handle ?? referenced.get(url)?.handle;
      const doc = handle?.doc();
      if (!doc) continue; // a referenced doc still resolving — revisit on load
      reachable.set(url, doc);

      for (const link of linkedUrls(doc)) {
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

// Depth-first walk: test every node against the schema and record the JSON
// Pointer of each match. A node and its descendants are all candidates, so one
// document can yield several distinct match locations. Links are not followed
// here — the reachable closure already supplies linked docs as their own roots.
function collectMatches(
  node: unknown,
  pointer: string,
  schema: z.ZodType,
  url: AutomergeUrl,
  out: AutomergeUrl[],
): void {
  if (schema.safeParse(node).success) out.push(makeMatchUrl(url, pointer));

  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collectMatches(child, joinPointer(pointer, index), schema, url, out),
    );
  } else if (node !== null && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      collectMatches(child, joinPointer(pointer, key), schema, url, out);
    }
  }
}

function sameUrls(a: AutomergeUrl[], b: AutomergeUrl[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, index) => url === b[index]);
}
