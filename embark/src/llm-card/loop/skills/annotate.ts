import type { Skill } from "./index";

// The original card capability: find documents by data shape and decorate their
// text with stickers. Uses the schema:queries / schema:matches channels for
// discovery and the stickers channel for publishing.
export const ANNOTATE_SKILL: Skill = {
  name: "annotate",
  summary:
    "find documents by data shape and attach highlights / inline notes to their text",
  doc: `# Skill: annotate

Find where a data shape occurs on the canvas and attach stickers (highlights / inline text) to those documents. The effect renders nothing visible - it is pure behavior.

You use these channels:
  schema:queries  { [key]: JSONSchema }       - ask "where does this shape occur?" by writing your schema under a key you pick.
  schema:matches  { [key]: AutomergeUrl[] }   - the canvas writes the matching urls back under that same key.
  stickers        { [docUrl]: Sticker[] }     - attach stickers to documents, keyed by the TARGET DOCUMENT url.

## Strategy

1. Express the data the effect needs as a JSON Schema (e.g. "markdown documents", which are { "@patchwork": { type: "markdown" }, content: string }).
2. Publish it in schema:queries under a unique key and read the matches back from schema:matches under that key; re-run when they change.
3. Compute stickers from each document's content and publish them into the stickers channel.

## Discovery: "where does this shape occur?"

Reach the store with getStore(element). Write your schema under a key you choose, then read matches under the same key:

  const SchemaQueries = { name: "schema:queries", empty: {} };
  const SchemaMatches = { name: "schema:matches", empty: {} };
  const store = getStore(element);
  const KEY = "annotate:markdown"; // any unique string; matches come back under it
  const queries = store.handle(SchemaQueries);
  queries.change((s) => { s[KEY] = MARKDOWN_SCHEMA; });
  const onMatches = (urls) => { /* urls = store.read(SchemaMatches)[KEY] ?? [] */ };
  const unsubscribe = store.subscribe(SchemaMatches, () => onMatches(store.read(SchemaMatches)[KEY] ?? []));
  onMatches(store.read(SchemaMatches)[KEY] ?? []); // seed: subscribe has no initial call

Each match url points at the matched subtree (the bare document url when the whole document matched). Treat the array as a live set: diff against what you had, and stop watching documents that disappear. await repo.find(url) then handle.doc() to read the matched value.

To find markdown documents (the usual sticker target) use this schema:
  { type: "object", properties: { "@patchwork": { type: "object", properties: { type: { const: "markdown" } }, required: ["type"] }, content: { type: "string" } }, required: ["@patchwork", "content"] }
A match url is then the document's url, and the document has a string content.

## Publishing: attach stickers to documents

Take your own slice of the stickers channel. It is a plain map keyed by the TARGET DOCUMENT url; under each key write an array of stickers for that document:

  const Stickers = { name: "stickers", empty: {} };
  const stickers = store.handle(Stickers);
  stickers.change((s) => { s[documentUrl] = stickerArray; });   // set/replace
  stickers.change((s) => { delete s[documentUrl]; });           // clear when a doc has none

Re-derive and rewrite a document's stickers whenever its content changes; remove the key when it no longer matches. In cleanup, unsubscribe and call stickers.release() (and queries.release()) to drop everything you published.

## Sticker shapes (only these two)

Each sticker's target is NOT the document url - it is a RANGE sub-url inside the document's text, so the sticker lands on specific characters. Build it from the document handle and a [from, to) character range over content:

  function rangeTarget(handle, from, to) {
    // { AUTOMERGE_REF_CURSOR_MARKER: true, start, end } is automerge's cursor
    // range marker - stable across edits. Built inline to avoid importing wasm.
    return handle.sub("content", { AUTOMERGE_REF_CURSOR_MARKER: true, start: from, end: to }).url;
  }

1. style - decorate the targeted characters with CSS (highlight, color, underline):
   { type: "style", styles: { "background-color": "#cfe8ff", "border-bottom": "2px solid #1d4ed8" }, target }

2. text - insert a small text annotation relative to the targeted range:
   { type: "text", text: "note", target, slot: "after" }   // slot: "before" | "after" | "replace"

## Rules

- Keep effect.js self-contained and idempotent: when a document's content changes, recompute its stickers and overwrite that document's entry; clean up everything in the returned teardown (release your handles).
- Network calls are allowed (fetch), but for pure annotation tasks you usually do not need them.

## Example brief

"Highlight every occurrence of the word blue."
Approach: publish the markdown shape above in schema:queries under a key and read its matches from schema:matches to get each note's url; take a slice of the stickers channel to publish into. For each matched document, find every match of /\\bblue\\b/gi in its content and push a style sticker with a yellow/blue background whose target is rangeTarget(handle, match.index, match.index + 4). Write the array under the document's url. Re-scan a document when it changes (handle.on("change", ...)), drop documents that stop matching, and in cleanup unsubscribe and release your handles.`,
};
