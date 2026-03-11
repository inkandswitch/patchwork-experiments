# Editor tools

Editor tools render document content in the main document area. Each exports both a `patchwork:datatype` plugin (the schema) and a `patchwork:tool` plugin (the renderer), though they can be in the same package or split across separate entry points.

## codemirror-base

**Package:** `@grjte/codemirror-base`  
**Plugin ID:** `codemirror-base`  
**Supported datatypes:** `["essay", "markdown"]`  
**Framework:** Solid JS

A collaborative text editor built on [CodeMirror 6](https://codemirror.net/) and [`@automerge/automerge-codemirror`](https://github.com/automerge/automerge-codemirror). It is the primary tool for plain-text and markdown documents.

**Document schema (`MarkdownDoc`):**

```ts
type MarkdownDoc = {
  content: string; // Automerge text — syncs character-level edits across peers
};
```

The `MarkdownDatatype` implementation initializes new documents with `content: "# Untitled"` and extracts the title from the first `# Heading` or from YAML frontmatter (`title: "..."`).

**Collaborative features:**

The tool subscribes to the global annotation context to render:

- **Diff highlights** (`Diff` annotations from `@inkandswitch/annotations-diff`) — decorates changed ranges when the user is viewing a historical state via the history view
- **Comment thread markers** (`CommentThread` annotations) — shows comment icons in the gutter for ranges with attached threads
- **Selection highlights** (`IsSelected` annotations) — highlights text ranges selected by other tools (e.g. when a comment thread is focused in the comments view)

The editor registers its own `AnnotationSet` with the global context to publish its current selection state outward.

The CodeMirror instance syncs with Automerge via `@automerge/automerge-codemirror`, which translates CodeMirror transactions into Automerge `splice` operations and vice versa, keeping the CRDT and the editor state in sync.

**Related packages:**

- `codemirror-markdown` — markdown-specific extensions and syntax highlighting
- `codemirror-embed` — extension for embedding Patchwork documents inline within CodeMirror content

---

## tldraw4

**Package:** `@patchwork/tldraw4`  
**Plugin ID:** `tldraw4`  
**Supported datatypes:** `["tldraw4"]`  
**Framework:** React

A canvas drawing tool built on [tldraw v4](https://tldraw.dev/). Stores the full tldraw document state in an Automerge document and syncs it across peers using the tldraw persistence API.

**Document schema:**

The document stores tldraw's native serialization format (shapes, bindings, assets). The datatype's `init` function creates an empty tldraw document, and `getTitle` reads the document name from the tldraw state.

CSS for tldraw is injected at mount time by fetching `./main.css` via the Service Worker (the same handoff mechanism used for modules) and inserting a `<style>` tag.

An older `tldraw` package (v2 alpha) is also present for backwards compatibility.

---

## tenfold

**Package:** `@inkandswitch/tenfold`  
**Plugin ID:** `inkandswitch/tenfold`  
**Supported datatypes:** `["inkandswitch/tenfold"]`  
**Framework:** Solid JS

Tenfold is an experimental REPL / notebook environment. It stores a sequence of cells (`states`), each with positional parameters (`q`, `r`, `x`, `y`) that feed into a letter-rendering function. Documents reference a shared "tenfolder" document at a hardcoded Automerge URL.

The datatype initializes 9 states with randomized positions. `getTitle` / `setTitle` read and write the document's `name` field.

The tool is loaded via Solid's `render()` with a custom component imported lazily from `./tool.tsx`.
