import {
  cursor,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { z } from "zod";
import { getContextHandle, subscribeContext } from "@embark/context";
import { SchemaMatches, SchemaQueries, schemaKey } from "@embark/schema";
import type { JsonSchema } from "@embark/schema";
import { Stickers } from "./channels";
import type { Sticker } from "./sticker";

// Shared engine for sticker sources. A source watches every text-bearing
// document in the open-document set (via the `SchemaQueries`/`SchemaMatches`
// channels, answered by the schema matcher card), scans each one's text, and
// publishes stickers into its own scoped slice of the `Stickers` channel keyed
// by document url. The example sources (color styler, unit converter, currency
// converter, timer) differ only in their `scan` function.
//
// The contract a source implements is `scan(ctx)`: given a text field's content
// (and helpers to address ranges and mint reusable docs), return the stickers it
// wants. A document may carry text in any of several fields, so the engine runs
// `scan` once per text field it finds and binds the field into `ctx.target`; the
// source itself only ever sees a single string.
//
// The engine handles discovery, debouncing, reconciliation as docs come and go,
// and cleanup.

// The text fields we scan, in priority order. Generalized from the original
// markdown-only `content`: any document with a *root-level* string named one of
// these is scanned, so notes, essays, and other text docs all qualify
// regardless of their `@patchwork.type` or which field holds their prose.
const TEXT_FIELDS = ["content", "description", "text"] as const;

// Matches any object carrying at least one of the text fields as a string. The
// resolver reports the subtree that matched; the engine keeps only root matches
// (a bare document url) since that's the text an editor actually shows.
const TEXT_SCHEMA = z.toJSONSchema(
  z.union([
    z.object({ content: z.string() }),
    z.object({ description: z.string() }),
    z.object({ text: z.string() }),
  ]),
) as unknown as JsonSchema;

const TEXT_KEY = schemaKey(TEXT_SCHEMA);

// Coalesce a burst of edits into a single rescan.
const RESCAN_DEBOUNCE_MS = 250;

type TextDoc = Record<string, unknown>;

export type ScanContext = {
  // One text field's content. The engine calls `scan` once per text field a
  // document carries, each time with that field's text here.
  content: string;
  // The repo, for sources (e.g. the timer) that mint backing docs inside
  // `resource`.
  repo: Repo;
  // Build the range sub-url for `[from, to)` within the field currently being
  // scanned. Use it as a sticker's `target`. The url encodes automerge cursors,
  // so it is stable across edits (it tracks the same characters) — which is what
  // makes it a good `resource` key.
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

// The engine's public handle: `stop` tears it down; `rescanAll` forces a fresh
// pass over every watched document (used by sources whose `scan` depends on
// async state — e.g. the currency converter, once exchange rates arrive).
export type StickerSource = {
  stop: () => void;
  rescanAll: () => void;
};

// One watched document.
type DocEntry = {
  handle?: DocHandle<TextDoc>;
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
): StickerSource {
  const repo = element.repo;
  const docs = new Map<AutomergeUrl, DocEntry>();
  // Our own scoped slice of the Stickers channel. When the source tears down,
  // releasing it drops every sticker we published (scope GC replaces the old
  // manual registry-doc deletion).
  const stickersHandle = getContextHandle(element, Stickers);

  // Discover text-bearing documents in scope; add/drop watched docs to match.
  // Only root matches (a bare document url) are kept — nested matches point at
  // subtrees no editor renders.
  const onMatches = (urls: AutomergeUrl[]) => {
    const roots = urls.filter(isRootUrl);
    const wanted = new Set(roots);
    for (const url of roots) if (!docs.has(url)) addDoc(url);
    for (const url of [...docs.keys()]) if (!wanted.has(url)) dropDoc(url, true);
  };

  const addDoc = (url: AutomergeUrl) => {
    const entry: DocEntry = { resources: new Map(), count: 0 };
    docs.set(url, entry);
    void Promise.resolve(repo.find<TextDoc>(url))
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
  // url, scanning every text field it carries and garbage-collecting any
  // resource docs whose keys no longer appear.
  const rescan = (url: AutomergeUrl) => {
    const entry = docs.get(url);
    if (!entry?.handle || !stickersHandle) return;
    const doc = entry.handle.doc();
    const used = new Set<AutomergeUrl>();
    const stickers: Sticker[] = [];

    for (const field of TEXT_FIELDS) {
      const value = doc?.[field];
      if (typeof value !== "string" || value.length === 0) continue;
      const ctx: ScanContext = {
        content: value,
        repo,
        target: (from, to) => entry.handle!.sub(field, cursor(from, to)).url,
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
      stickers.push(...config.scan(ctx));
    }

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

  // Publish the text-field schema query and watch for matching documents. Both
  // ride the schema channels; the schema matcher card answers.
  const schemaQueries = getContextHandle(element, SchemaQueries);
  schemaQueries?.change((slice) => {
    slice[TEXT_KEY] = { name: "Text fields", schema: TEXT_SCHEMA };
  });
  const unsubscribeMatches = subscribeContext(element, SchemaMatches, (all) => {
    onMatches(all[TEXT_KEY] ?? []);
  });

  const stop = () => {
    unsubscribeMatches();
    schemaQueries?.release();
    // Releasing the slice drops every sticker we published; here we only need
    // to reclaim minted resource docs (no per-key sticker writes needed).
    for (const url of [...docs.keys()]) dropDoc(url, false);
    stickersHandle?.release();
  };

  const rescanAll = () => {
    for (const url of docs.keys()) scheduleRescan(url);
  };

  return { stop, rescanAll };
}

// True when the url points at a whole document (no sub-path), i.e. a root match.
function isRootUrl(url: AutomergeUrl): boolean {
  return url === `automerge:${parseAutomergeUrl(url).documentId}`;
}

function deleteResource(repo: Repo, docUrl: AutomergeUrl) {
  void Promise.resolve(repo.find(docUrl))
    .then((handle) => handle.delete())
    .catch(() => {});
}
