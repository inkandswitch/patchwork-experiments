import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type DocumentId,
  type Repo,
} from "@automerge/automerge-repo/slim";
import {
  accept,
  subscribe,
  type DocHandleDescriptor,
  type SubscribeEvent,
} from "@inkandswitch/patchwork-providers";

import { LayeredDoc, type PatchDoc } from "./patch-layers.js";
import { realmScratchRepo } from "./scratch.js";

/**
 * A `repo:handle-descriptor` answer. `scratchUrl` names a document in the
 * realm's scratch repo shown in place of `cloneUrl ?? url` while the view is
 * live; it's newer than some providers releases this builds against.
 */
export type Descriptor = DocHandleDescriptor & { scratchUrl?: AutomergeUrl };

const DESCRIPTOR_SELECTOR = "repo:handle-descriptor";
const LEASE_SELECTOR = "repo:scratch-lease";

// The part of a folder doc this reads: its links, each link's type, and
// whether it's switched off.
type PatchFolder = {
  docs?: { url?: AutomergeUrl; type?: string; off?: boolean }[];
};

export type PatchProviderOptions = {
  repo: Repo;
  /**
   * A folder doc; its links of type `"patch"` are the patches laid here,
   * except those marked `off: true`, which keep their place in the stack. May
   * be a promise, for a folder that's still being made: subscriptions are
   * claimed straight away and answered once it's known.
   */
  folder: AutomergeUrl | Promise<AutomergeUrl>;
  /** Where layered docs are made. Defaults to the realm's scratch repo. */
  scratchRepo?: Repo;
  /**
   * How long a layered doc nothing holds is kept before it's deleted, in ms.
   * Covers the gap between answering a view and the view taking its lease.
   */
  keepFor?: number;
};

// A layered doc this provider made, shared by every subscription laying the
// same patches over the same backing.
type Entry = {
  key: string;
  doc: Promise<LayeredDoc<unknown>>;
  url?: AutomergeUrl;
  // Subscriptions answering with it, and views' leases on it.
  holds: number;
  timer?: ReturnType<typeof setTimeout>;
  // The lease on the scratch doc it's laid over, from the provider above.
  releaseBase?: () => void;
  gone?: true;
};

/**
 * Lay the patch docs in a folder over every document resolved beneath
 * `element`. Answers `repo:handle-descriptor` by asking its own ancestors
 * first and laying the folder's patches for that document over whatever they
 * answer (the draft's clone, or another provider's layered doc), so it stacks
 * over drafts and other remappers rather than hiding them. Later links in the
 * folder are nearer the front.
 *
 * The layered doc goes back as the answer's `scratchUrl`, keeping the
 * ancestors' `cloneUrl`: a view pinned to heads shows that, unpatched. A view
 * leases the layered doc while it shows it (`repo:scratch-lease`), and it's
 * deleted a little while after nothing holds it.
 *
 * Follows the folder and every patch doc in it live: adding, removing or
 * retargeting a patch re-answers the subscriptions it touches. The first
 * answer waits for the folder to load, so a patched document never flashes
 * unpatched.
 *
 * Returns a teardown.
 */
export function providePatchLayers(
  element: HTMLElement,
  { repo, folder, scratchRepo, keepFor = 2000 }: PatchProviderOptions
): () => void {
  const scratch = scratchRepo ?? realmScratchRepo();
  let disposed = false;
  // The folder's patch docs by the document they patch, back first.
  let index = new Map<DocumentId, AutomergeUrl[]>();
  const patchHandles = new Map<AutomergeUrl, DocHandle<PatchDoc>>();
  // Every live subscription, by the document it asked about.
  const live = new Map<DocumentId, Set<() => void>>();
  const entries = new Map<string, Entry>();
  const byUrl = new Map<AutomergeUrl, Entry>();

  // The folder's patch links, in folder order.
  let links: AutomergeUrl[] = [];

  let folderHandle: DocHandle<PatchFolder> | undefined;
  const ready = Promise.resolve(folder).then(async (url) => {
    const handle = await repo.find<PatchFolder>(url);
    if (disposed) return;
    folderHandle = handle;
    handle.on("change", reindex);
    await reindex();
  });
  ready.catch((err) =>
    console.error(`[patchy] patch folder unavailable:`, err)
  );

  async function reindex() {
    links = (folderHandle?.doc()?.docs ?? [])
      .filter(
        (link) =>
          link.type === "patch" && !link.off && isValidAutomergeUrl(link.url)
      )
      .map((link) => link.url!);

    for (const url of links) {
      if (patchHandles.has(url)) continue;
      try {
        // The realm's own repo, unremapped: patch docs are configuration,
        // not content, so a draft never swaps them for copies.
        const handle = await repo.find<PatchDoc>(url);
        if (disposed) return;
        if (patchHandles.has(url)) continue;
        patchHandles.set(url, handle);
        handle.on("change", rebuild);
      } catch (err) {
        console.warn(`[patchy] patch ${url} unavailable:`, err);
      }
    }
    for (const [url, handle] of patchHandles) {
      if (links.includes(url)) continue;
      handle.off("change", rebuild);
      patchHandles.delete(url);
    }
    rebuild();
  }

  // Re-read which document each patch is on, and re-answer every
  // subscription whose layers that changed.
  function rebuild() {
    if (disposed) return;
    const next = new Map<DocumentId, AutomergeUrl[]>();
    for (const url of links) {
      const on = patchHandles.get(url)?.doc()?.on;
      if (!on || !isValidAutomergeUrl(on)) continue;
      const { documentId } = parseAutomergeUrl(on);
      const list = next.get(documentId) ?? [];
      list.push(url);
      next.set(documentId, list);
    }
    const before = index;
    index = next;
    for (const [documentId, sends] of live) {
      if (sameList(before.get(documentId), next.get(documentId))) continue;
      for (const send of sends) send();
    }
  }

  // The layered doc laying `own` (front first) over what `upstream` shows,
  // held once more. Undefined for an upstream pinned to heads: a pinned view
  // never shows a scratch doc, so there's nothing to lay.
  function hold(upstream: Descriptor, own: AutomergeUrl[]): Entry | undefined {
    const stored = parseAutomergeUrl(upstream.cloneUrl ?? upstream.url);
    if (stored.heads) return undefined;
    const under = upstream.scratchUrl
      ? parseAutomergeUrl(upstream.scratchUrl).documentId
      : undefined;
    const baseKey = under ? `scratch:${under}` : stored.documentId;
    const key = `${baseKey}|${own.join(",")}`;

    let entry = entries.get(key);
    if (!entry) {
      const layers = own
        .map((url) => patchHandles.get(url))
        .filter((h): h is DocHandle<PatchDoc> => !!h);
      const made: Entry = { key, holds: 0, doc: undefined! };
      if (under) {
        // Keep the provider above from deleting what this is laid over.
        made.releaseBase = subscribe(
          element.parentElement ?? element,
          {
            type: LEASE_SELECTOR,
            url: stringifyAutomergeUrl({ documentId: under }),
          },
          () => {}
        );
      }
      made.doc = (async () => {
        const base = under
          ? await scratch.find<unknown>(stringifyAutomergeUrl({ documentId: under }))
          : await repo.find<unknown>(
              stringifyAutomergeUrl({ documentId: stored.documentId })
            );
        const doc = new LayeredDoc(base, layers, scratch);
        if (made.gone) {
          doc.dispose();
          scratch.delete(doc.handle.documentId);
        } else {
          made.url = doc.handle.url;
          byUrl.set(doc.handle.url, made);
        }
        return doc;
      })();
      made.doc.catch(() => destroy(made));
      entry = made;
      entries.set(key, entry);
    }
    entry.holds++;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    return entry;
  }

  function drop(entry: Entry | undefined) {
    if (!entry || entry.gone) return;
    if (--entry.holds > 0) return;
    entry.timer = setTimeout(() => destroy(entry), keepFor);
  }

  function destroy(entry: Entry) {
    if (entry.gone) return;
    entry.gone = true;
    if (entry.timer) clearTimeout(entry.timer);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (entry.url && byUrl.get(entry.url) === entry) byUrl.delete(entry.url);
    entry.releaseBase?.();
    void entry.doc.then(
      (doc) => {
        doc.dispose();
        scratch.delete(doc.handle.documentId);
      },
      () => {}
    );
  }

  const onSubscribe = (event: SubscribeEvent) => {
    const selector = event.detail.selector;
    if (selector.type === LEASE_SELECTOR) {
      const url = selector.url as AutomergeUrl | undefined;
      const entry = url ? byUrl.get(url) : undefined;
      // Someone else's scratch doc: let it go on up.
      if (!entry || entry.gone) return;
      accept(event, () => {
        entry.holds++;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = undefined;
        return () => drop(entry);
      });
      return;
    }

    if (selector.type !== DESCRIPTOR_SELECTOR) return;
    const url = selector.url as AutomergeUrl | undefined;
    if (!url || !isValidAutomergeUrl(url)) return;
    const { documentId } = parseAutomergeUrl(url);

    accept<Descriptor>(event, (respond) => {
      let upstream: Descriptor | undefined;
      let loaded = false;
      // What this subscription last answered with.
      let held: Entry | undefined;
      let version = 0;

      const answer = (entry: Entry | undefined, descriptor: Descriptor) => {
        const previous = held;
        held = entry;
        drop(previous);
        respond(descriptor);
      };

      const send = () => {
        if (!upstream || !loaded || disposed) return;
        const mine = ++version;
        const from = upstream;
        const own = [...(index.get(documentId) ?? [])].reverse();
        const entry = own.length > 0 ? hold(from, own) : undefined;
        if (!entry) return answer(undefined, from);
        entry.doc.then(
          (doc) => {
            if (mine !== version || disposed) return drop(entry);
            answer(entry, { ...from, scratchUrl: doc.handle.url });
          },
          (err) => {
            console.error(`[patchy] couldn't lay patches over ${url}:`, err);
            drop(entry);
            if (mine === version && !disposed) answer(undefined, from);
          }
        );
      };

      let sends = live.get(documentId);
      if (!sends) {
        sends = new Set();
        live.set(documentId, sends);
      }
      sends.add(send);

      const parent = element.parentElement;
      const unsubscribeUp = parent
        ? subscribe<Descriptor>(parent, selector, (d) => {
            upstream = d;
            send();
          })
        : ((upstream = { url }), () => {});
      const load = () => {
        loaded = true;
        send();
      };
      ready.then(load, load);

      return () => {
        version++;
        unsubscribeUp();
        sends.delete(send);
        if (sends.size === 0) live.delete(documentId);
        drop(held);
        held = undefined;
      };
    });
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);
  return () => {
    disposed = true;
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    folderHandle?.off("change", reindex);
    for (const handle of patchHandles.values()) handle.off("change", rebuild);
    patchHandles.clear();
    live.clear();
    // Layered docs go as the views beneath let go of them, as ever.
  };
}

function sameList(
  a: AutomergeUrl[] | undefined,
  b: AutomergeUrl[] | undefined
) {
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
