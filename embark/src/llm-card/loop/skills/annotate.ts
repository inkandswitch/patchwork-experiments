import type { Skill } from "./index";

// The original card capability: find documents by data shape and decorate their
// text with stickers. Two providers - schema:matches (discovery) and
// stickers:registry (publishing).
export const ANNOTATE_SKILL: Skill = {
  name: "annotate",
  summary:
    "find documents by data shape and attach highlights / inline notes to their text",
  doc: `# Skill: annotate

Find where a data shape occurs on the canvas and attach stickers (highlights / inline text) to those documents. The effect renders nothing visible - it is pure behavior.

You have exactly two providers:
  1. schema:matches  - find where a data shape occurs in the documents on the canvas.
  2. stickers:registry - attach stickers to those documents.

## Strategy

1. Express the data the effect needs as a JSON Schema (e.g. "markdown documents", which are { "@patchwork": { type: "markdown" }, content: string }).
2. Subscribe to that schema with schema:matches to get the matching documents, and re-run when they change.
3. Compute stickers from each document's content and publish them into the sticker registry.

## Provider 1: schema:matches - "where does this shape occur?"

  subscribe(element, { type: "schema:matches", schema: <JSON Schema> }, (urls) => { ... })

The callback receives an AutomergeUrl[]; each url points at the matched subtree (the bare document url when the whole document matched). It is re-invoked whenever the matches change (documents added/removed/edited), so treat it as a live set: diff against what you had, and stop watching documents that disappear. await repo.find(url) then handle.doc() to read the matched value.

To find markdown documents (the usual sticker target) subscribe with:
  { type: "object", properties: { "@patchwork": { type: "object", properties: { type: { const: "markdown" } }, required: ["type"] }, content: { type: "string" } }, required: ["@patchwork", "content"] }
A match url is then the document's url, and the document has a string \`content\`.

## Provider 2: stickers:registry - "attach stickers to documents"

  subscribe(element, { type: "stickers:registry" }, (registryDocUrl) => { ... })

You are handed the url of a fresh, empty registry document to write into. It is a plain map keyed by the TARGET DOCUMENT url; under each key you write an array of stickers for that document:

  const registry = await repo.find(registryDocUrl);
  registry.change((doc) => { doc[documentUrl] = stickers; });        // set/replace
  registry.change((doc) => { delete doc[documentUrl]; });            // clear when a doc has none

Re-derive and rewrite a document's stickers whenever its content changes; remove the key when it no longer matches or on cleanup.

## Sticker shapes (only these two)

Each sticker's \`target\` is NOT the document url - it is a RANGE sub-url inside the document's text, so the sticker lands on specific characters. Build it from the document handle and a [from, to) character range over \`content\`:

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

- Keep effect.js self-contained and idempotent: when a document's content changes, recompute its stickers and overwrite that document's entry; clean up everything in the returned teardown.
- Network calls are allowed (fetch), but for pure annotation tasks you usually do not need them.

## Example brief

"Highlight every occurrence of the word blue."
Approach: subscribe to schema:matches for the markdown shape above to get each note's url; subscribe to stickers:registry for somewhere to publish. For each matched document, find every match of /\\bblue\\b/gi in its content and push a style sticker with a yellow/blue background whose target is rangeTarget(handle, match.index, match.index + 4). Write the array under the document's url. Re-scan a document when it changes (handle.on("change", ...)), drop documents that stop matching, and in cleanup unsubscribe and clear the registry entries.`,
};
