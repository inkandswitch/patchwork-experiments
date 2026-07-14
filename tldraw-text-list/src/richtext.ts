// A tldraw text / geo / note shape keeps its label in `props.richText`: a
// TipTap/ProseMirror document. This module is the pure, dependency-free leaf of
// the lens chain — the conversion between that JSON and a plain multi-line
// string. It deliberately has no `bireactive` import so the round-trip is
// trivially testable; `tool.tsx` wraps these two functions in an `optic`.
//
// The lens is lossy: reading flattens (dropping marks, colours, links…) and
// writing rebuilds a canonical doc. What keeps the bidirectional bind from
// oscillating is that text→rich→text is the identity, so a write echoes back
// through the CRDT as the same string and the graph settles.

/** A TipTap/ProseMirror node — we only read `text` leaves, `hardBreak`s, and the
 *  block nodes that separate lines. */
interface RTNode {
  type?: string;
  text?: string;
  content?: RTNode[];
}

export interface RichTextDoc {
  type: "doc";
  content: RTNode[];
}

// Leaf blocks that each render as their own line. Containers (doc, listItem,
// blockquote, bulletList…) aren't listed: we recurse through them so a list item
// yields one line from its paragraph, not two from the item *and* the paragraph.
const LINE_BLOCK = new Set(["paragraph", "heading", "codeBlock"]);

/** Flatten a `richText` doc (or anything falsy) to a plain multi-line string. */
export function toPlain(rt: RichTextDoc | undefined | null): string {
  if (!rt || !Array.isArray(rt.content)) return "";
  const lines = [""];
  // The first leaf block claims the initial line; each later one starts a new
  // line. (Tracking "started" rather than inspecting the last line keeps empty
  // paragraphs — i.e. intentional blank lines — from being swallowed.)
  let started = false;
  const walk = (node: RTNode | undefined): void => {
    if (!node) return;
    if (node.type === "text") {
      lines[lines.length - 1] += node.text ?? "";
      return;
    }
    if (node.type === "hardBreak") {
      lines.push("");
      return;
    }
    if (node.type && LINE_BLOCK.has(node.type)) {
      if (started) lines.push("");
      started = true;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of rt.content) walk(node);
  return lines.join("\n");
}

/** Rebuild a canonical doc from plain text — one paragraph per line. */
export function toRichText(text: string): RichTextDoc {
  return {
    type: "doc",
    content: text.split("\n").map((line) =>
      line.length > 0
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" },
    ),
  };
}
