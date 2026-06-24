import {
  cursor,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { z } from "zod";
import { getContextHandle, subscribeContext } from "../../lib/context";
import {
  SchemaMatches,
  SchemaQueries,
  Stickers,
  schemaKey,
} from "../../canvas/channels";
import type { JsonSchema } from "../../lib/schema";
import type { Sticker } from "../types";

// Shared engine for sticker sources. A source watches every markdown document
// reachable on the canvas (via the `SchemaQueries`/`SchemaMatches` channels),
// scans each one's text, and publishes stickers into its own scoped slice of
// the `Stickers` channel keyed by document url. The three example sources
// (color styler, unit converter, timer) differ only in their `scan` function.
//
// The contract a source implements is `scan(ctx)`: given a document's content
// (and helpers to address ranges and mint reusable docs), return the stickers
// it wants on that document. The engine handles discovery, debouncing,
// reconciliation as docs come and go, and cleanup.

// Only the markdown root matches this (it has both keys), so each markdown
// document yields its bare document url — exactly the key the renderer asks
// about. Shipped as JSON Schema because that's the channel's payload type.
const MARKDOWN_SCHEMA = z.toJSONSchema(
  z.object({
    "@patchwork": z.object({ type: z.literal("markdown") }),
    content: z.string(),
  }),
) as unknown as JsonSchema;

const MARKDOWN_KEY = schemaKey(MARKDOWN_SCHEMA);

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
  // Our own scoped slice of the Stickers channel. When the source tears down,
  // releasing it drops every sticker we published (scope GC replaces the old
  // manual registry-doc deletion).
  const stickersHandle = getContextHandle(element, Stickers);

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
    if (writeRegistry) stickersHandle?.change((slice) => delete slice[url]);
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

  // Re-derive a document's stickers and write them into our slice under its
  // url, garbage-collecting any resource docs whose keys no longer appear.
  const rescan = (url: AutomergeUrl) => {
    const entry = docs.get(url);
    if (!entry?.handle || !stickersHandle) return;
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
    stickersHandle.change((slice) => {
      slice[url] = stickers;
    });
    emitCount();
  };

  const emitCount = () => {
    if (!onCount) return;
    let total = 0;
    for (const entry of docs.values()) total += entry.count;
    onCount(total);
  };

  // Publish the markdown schema query and watch for matching documents on the
  // canvas. Both ride the schema channels; the canvas resolver answers.
  const schemaQueries = getContextHandle(element, SchemaQueries);
  schemaQueries?.change((slice) => {
    slice[MARKDOWN_KEY] = MARKDOWN_SCHEMA;
  });
  const unsubscribeMatches = subscribeContext(element, SchemaMatches, (all) => {
    onMatches(all[MARKDOWN_KEY] ?? []);
  });

  return () => {
    unsubscribeMatches();
    schemaQueries?.release();
    // Releasing the slice drops every sticker we published; here we only need
    // to reclaim minted resource docs (no per-key sticker writes needed).
    for (const url of [...docs.keys()]) dropDoc(url, false);
    stickersHandle?.release();
  };
}

function deleteResource(repo: Repo, docUrl: AutomergeUrl) {
  void Promise.resolve(repo.find(docUrl))
    .then((handle) => handle.delete())
    .catch(() => {});
}
