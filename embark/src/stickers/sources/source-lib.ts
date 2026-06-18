import {
  cursor,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { z } from "zod";
import { coreSubscribe, type JSONValue } from "../../lib/providers-solid";
import { MATCHES_SELECTOR } from "../../canvas/providers/SchemaMatchProvider";
import {
  STICKERS_REGISTRY,
  type Sticker,
  type StickerRegistryDoc,
} from "../types";

// Shared engine for sticker sources. A source watches every markdown document
// reachable on the canvas (via the schema-match provider), scans each one's
// text, and publishes stickers into an ephemeral registry doc handed to it by
// the sticker broker. The three example sources (color styler, unit converter,
// timer) differ only in their `scan` function.
//
// The contract a source implements is `scan(ctx)`: given a document's content
// (and helpers to address ranges and mint reusable docs), return the stickers
// it wants on that document. The engine handles discovery, debouncing,
// reconciliation as docs come and go, and cleanup.

// Only the markdown root matches this (it has both keys), so each markdown
// document yields its bare document url — exactly the key the renderer asks
// about. Shipped as JSON Schema because that's all a selector can carry.
const MARKDOWN_SCHEMA = z.toJSONSchema(
  z.object({
    "@patchwork": z.object({ type: z.literal("markdown") }),
    content: z.string(),
  }),
) as unknown as JSONValue;

// Coalesce a burst of edits into a single rescan.
const RESCAN_DEBOUNCE_MS = 250;

type MarkdownDoc = { "@patchwork"?: { type: string }; content?: string };

export type ScanContext = {
  // The scanned document's text.
  content: string;
  // The repo, for sources (e.g. the timer) that mint backing docs inside
  // `resource`.
  repo: Repo;
  // Build the range sub-url for `[from, to)` within this document's content.
  // Use it as a sticker's `target`. The url encodes automerge cursors, so it is
  // stable across edits (it tracks the same characters) — which is what makes
  // it a good `resource` key.
  target: (from: number, to: number) => AutomergeUrl;
  // Get-or-create a cached document for a span, keyed by its (cursor-based)
  // `target` url so the key is stable across edits. `create` runs only the
  // first time a span is seen; the same url is returned on later scans, and a
  // doc is deleted once its span stops appearing. Used by tool stickers so a
  // widget's backing doc survives edits instead of being re-minted each scan.
  resource: (target: AutomergeUrl, create: () => AutomergeUrl) => AutomergeUrl;
};

export type StickerSourceConfig = {
  scan: (ctx: ScanContext) => Sticker[];
};

// One watched markdown document.
type DocEntry = {
  handle?: DocHandle<MarkdownDoc>;
  onChange?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  // target url -> minted doc url, for tool stickers' backing docs.
  resources: Map<AutomergeUrl, AutomergeUrl>;
  count: number;
};

export function runStickerSource(
  element: ToolElement,
  config: StickerSourceConfig,
  onCount?: (count: number) => void,
): () => void {
  const repo = element.repo;
  const docs = new Map<AutomergeUrl, DocEntry>();
  let registry: DocHandle<StickerRegistryDoc> | undefined;

  // Discover markdown documents on the canvas; add/drop watched docs to match.
  const onMatches = (urls: AutomergeUrl[]) => {
    const wanted = new Set(urls);
    for (const url of urls) if (!docs.has(url)) addDoc(url);
    for (const url of [...docs.keys()]) if (!wanted.has(url)) dropDoc(url, true);
  };

  const addDoc = (url: AutomergeUrl) => {
    const entry: DocEntry = { resources: new Map(), count: 0 };
    docs.set(url, entry);
    void Promise.resolve(repo.find<MarkdownDoc>(url))
      .then((handle) => {
        if (docs.get(url) !== entry) return; // dropped before it resolved
        entry.handle = handle;
        entry.onChange = () => scheduleRescan(url);
        handle.on("change", entry.onChange);
        scheduleRescan(url);
      })
      .catch(() => {});
  };

  const dropDoc = (url: AutomergeUrl, writeRegistry: boolean) => {
    const entry = docs.get(url);
    if (!entry) return;
    docs.delete(url);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.handle && entry.onChange) {
      entry.handle.off("change", entry.onChange);
    }
    for (const docUrl of entry.resources.values()) deleteResource(repo, docUrl);
    entry.resources.clear();
    if (writeRegistry) registry?.change((doc) => delete doc[url]);
    emitCount();
  };

  const scheduleRescan = (url: AutomergeUrl) => {
    const entry = docs.get(url);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      rescan(url);
    }, RESCAN_DEBOUNCE_MS);
  };

  // Re-derive a document's stickers and write them into the registry under its
  // url, garbage-collecting any resource docs whose keys no longer appear.
  const rescan = (url: AutomergeUrl) => {
    const entry = docs.get(url);
    if (!entry?.handle || !registry) return;
    const content = entry.handle.doc()?.content ?? "";
    const used = new Set<AutomergeUrl>();
    const ctx: ScanContext = {
      content,
      repo,
      target: (from, to) => entry.handle!.sub("content", cursor(from, to)).url,
      resource: (target, create) => {
        used.add(target);
        let existing = entry.resources.get(target);
        if (!existing) {
          existing = create();
          entry.resources.set(target, existing);
        }
        return existing;
      },
    };

    const stickers = config.scan(ctx);

    for (const [target, docUrl] of [...entry.resources]) {
      if (used.has(target)) continue;
      entry.resources.delete(target);
      deleteResource(repo, docUrl);
    }

    entry.count = stickers.length;
    registry.change((doc) => {
      doc[url] = stickers;
    });
    emitCount();
  };

  const emitCount = () => {
    if (!onCount) return;
    let total = 0;
    for (const entry of docs.values()) total += entry.count;
    onCount(total);
  };

  // Ask the broker for a registry doc to publish into; rescan everything once
  // it resolves so any docs discovered first get written.
  const unsubscribeRegistry = coreSubscribe<AutomergeUrl>(
    element,
    { type: STICKERS_REGISTRY },
    (url) => {
      if (!url || registry) return;
      void Promise.resolve(repo.find<StickerRegistryDoc>(url))
        .then((handle) => {
          registry = handle;
          for (const docUrl of docs.keys()) scheduleRescan(docUrl);
        })
        .catch(() => {});
    },
  );

  const unsubscribeMatches = coreSubscribe<AutomergeUrl[]>(
    element,
    { type: MATCHES_SELECTOR, schema: MARKDOWN_SCHEMA },
    onMatches,
  );

  return () => {
    unsubscribeMatches();
    unsubscribeRegistry();
    // Skip registry writes on teardown — the broker deletes the registry doc
    // when our subscription closes — but still reclaim minted resource docs.
    for (const url of [...docs.keys()]) dropDoc(url, false);
  };
}

function deleteResource(repo: Repo, docUrl: AutomergeUrl) {
  void Promise.resolve(repo.find(docUrl))
    .then((handle) => handle.delete())
    .catch(() => {});
}
