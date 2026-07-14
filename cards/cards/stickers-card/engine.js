// Shared engine for sticker sources, owned by the Stickers card alongside the
// `stickers` channel it writes (./channels.js). A source watches every
// text-bearing document in the open-document set (via the `schema:matches`
// channel: the declared key interest is the query, answered by the schema
// matcher card), scans each one's text, and publishes stickers into its own
// scoped slice of the `stickers` channel keyed by document url. The example
// sources (unit/metric/currency converters, timer, schedule) differ only in
// their `scan` function.
//
// The contract a source implements is `scan(ctx)`: given a text field's
// content (and helpers to address ranges and mint reusable docs), return the
// stickers it wants. A document may carry text in any of several fields, so
// the engine runs `scan` once per text field it finds and binds the field into
// `ctx.target`; the source itself only ever sees a single string.
//
// The engine handles discovery, debouncing, reconciliation as docs come and
// go, and cleanup.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions from sibling packages are imported by their automerge urls.

import { cursor, parseAutomergeUrl } from "@automerge/automerge-repo";
import { Stickers } from "./channels.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);

// The text fields we scan, in priority order. Any document with a root-level
// string named one of these is scanned, so notes, essays, and other text docs
// all qualify regardless of their `@patchwork.type` or which field holds their
// prose.
const TEXT_FIELDS = ["content", "description", "text"];

// Matches any object carrying at least one of the text fields as a string.
// A literal JSON Schema (what zod 4's `z.toJSONSchema(z.union([...]))` emits),
// so `TEXT_KEY` is identical for every source and they all share one
// schema-matcher query. The resolver reports the subtree that matched; the
// engine keeps only root matches (a bare document url) since that's the text
// an editor actually shows.
const TEXT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  anyOf: TEXT_FIELDS.map((field) => ({
    type: "object",
    properties: { [field]: { type: "string" } },
    required: [field],
    additionalProperties: false,
  })),
};

const TEXT_KEY = schemaKey(TEXT_SCHEMA);

// Coalesce a burst of edits into a single rescan.
const RESCAN_DEBOUNCE_MS = 250;

/**
 * @typedef {import("./channels.js").Sticker} Sticker
 *
 * @typedef {{
 *   content: string,
 *   repo: unknown,
 *   target: (from: number, to: number) => string,
 *   resource: (target: string, create: () => string) => string,
 * }} ScanContext
 *   One text field's content, the repo (for sources that mint backing docs
 *   inside `resource`), a builder for the cursor-based range sub-url of
 *   `[from, to)` within the field being scanned (stable across edits — use it
 *   as a sticker's `target`), and a get-or-create cache of minted documents
 *   keyed by target url (docs are deleted once their span stops appearing).
 *
 * @typedef {{ stop: () => void, rescanAll: () => void }} StickerSource
 *   The engine's public handle: `stop` tears it down; `rescanAll` forces a
 *   fresh pass over every watched document (for sources whose `scan` depends
 *   on async state — e.g. the currency converter, once exchange rates arrive).
 */

/**
 * Run a sticker source against the canvas `element` lives in.
 * @param {HTMLElement & { repo: any }} element
 * @param {{ scan: (ctx: ScanContext) => Sticker[] }} config
 * @param {(count: number) => void} [onCount]
 * @returns {StickerSource}
 */
export function runStickerSource(element, config, onCount) {
  const repo = element.repo;
  const docs = new Map();
  // Our own scoped slice of the Stickers channel. When the source tears down,
  // releasing it drops every sticker we published (scope GC replaces manual
  // registry-doc deletion).
  const stickersHandle = getContextHandle(element, Stickers);

  // Discover text-bearing documents in scope; add/drop watched docs to match.
  // Only root matches (a bare document url) are kept — nested matches point at
  // subtrees no editor renders.
  const onMatches = (urls) => {
    const roots = urls.filter(isRootUrl);
    const wanted = new Set(roots);
    for (const url of roots) if (!docs.has(url)) addDoc(url);
    for (const url of [...docs.keys()]) if (!wanted.has(url)) dropDoc(url, true);
  };

  const addDoc = (url) => {
    const entry = { resources: new Map(), count: 0 };
    docs.set(url, entry);
    Promise.resolve(repo.find(url))
      .then((handle) => {
        if (docs.get(url) !== entry) return; // dropped before it resolved
        entry.handle = handle;
        entry.onChange = () => scheduleRescan(url);
        handle.on("change", entry.onChange);
        scheduleRescan(url);
      })
      .catch(() => {});
  };

  const dropDoc = (url, writeRegistry) => {
    const entry = docs.get(url);
    if (!entry) return;
    docs.delete(url);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.handle && entry.onChange) {
      entry.handle.off("change", entry.onChange);
    }
    for (const docUrl of entry.resources.values()) deleteResource(repo, docUrl);
    entry.resources.clear();
    if (writeRegistry) stickersHandle.change((slice) => delete slice[url]);
    emitCount();
  };

  const scheduleRescan = (url) => {
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
  const rescan = (url) => {
    const entry = docs.get(url);
    if (!entry?.handle) return;
    const doc = entry.handle.doc();
    const used = new Set();
    const stickers = [];

    for (const field of TEXT_FIELDS) {
      const value = doc?.[field];
      if (typeof value !== "string" || value.length === 0) continue;
      const ctx = {
        content: value,
        repo,
        target: (from, to) => entry.handle.sub(field, cursor(from, to)).url,
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
    // Only documents that actually carry stickers get an entry: writing an
    // empty array would still create a key in the merged channel, cluttering
    // the context viewer with every text-bearing doc this source merely
    // scanned (e.g. card docs matched through their `description`).
    stickersHandle.change((slice) => {
      if (stickers.length === 0) delete slice[url];
      else slice[url] = stickers;
    });
    emitCount();
  };

  const emitCount = () => {
    if (!onCount) return;
    let total = 0;
    for (const entry of docs.values()) total += entry.count;
    onCount(total);
  };

  // Watch for text-bearing documents. The declared key interest *is* the
  // query: the schema matcher card sees it on the SchemaMatches reader
  // registry and answers under the same key.
  const unsubscribeMatches = subscribeContext(
    element,
    SchemaMatches,
    (all) => {
      onMatches(all[TEXT_KEY] ?? []);
    },
    [TEXT_KEY],
  );

  const stop = () => {
    unsubscribeMatches();
    // Releasing the slice drops every sticker we published; here we only need
    // to reclaim minted resource docs (no per-key sticker writes needed).
    for (const url of [...docs.keys()]) dropDoc(url, false);
    stickersHandle.release();
  };

  const rescanAll = () => {
    for (const url of docs.keys()) scheduleRescan(url);
  };

  return { stop, rescanAll };
}

// True when the url points at a whole document (no sub-path), i.e. a root match.
function isRootUrl(url) {
  return url === `automerge:${parseAutomergeUrl(url).documentId}`;
}

function deleteResource(repo, docUrl) {
  Promise.resolve(repo.find(docUrl))
    .then((handle) => handle.delete())
    .catch(() => {});
}
