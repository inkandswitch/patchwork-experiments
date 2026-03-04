import {
  EditorView,
  Decoration,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import katex from "katex";
import { latexTheme } from "./theme.ts";

/** Renders a single math expression with KaTeX */
function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      throwOnError: false,
      output: "html",
    });
  } catch {
    const span = document.createElement("span");
    span.textContent = tex;
    return span.innerHTML;
  }
}

function ensureKatexStyles() {
  if (document.querySelector('link[href*="katex"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
  document.head.appendChild(link);
}

class MathWidget extends WidgetType {
  readonly tex: string;
  readonly display: boolean;
  /** When true, render as a separate block below source (multiline case) */
  readonly blockDecoration: boolean;

  constructor(tex: string, display: boolean, blockDecoration = false) {
    super();
    this.tex = tex;
    this.display = display;
    this.blockDecoration = blockDecoration;
  }

  eq(other: MathWidget) {
    return (
      other.tex === this.tex &&
      other.display === this.display &&
      other.blockDecoration === this.blockDecoration
    );
  }

  toDOM() {
    ensureKatexStyles();
    const inner = document.createElement("span");
    inner.className = this.display
      ? "cm-latex-math cm-latex-math-display"
      : "cm-latex-math cm-latex-math-inline";
    try {
      inner.innerHTML = renderMath(this.tex, this.display);
    } catch {
      inner.textContent = this.tex;
    }
    if (this.blockDecoration) {
      const wrap = document.createElement("div");
      wrap.className = "cm-latex-block-preview";
      wrap.appendChild(inner);
      return wrap;
    }
    return inner;
  }

  ignoreEvent() {
    return true;
  }
}

/** Zero-height widget used to hide source lines in multiline math (we can't replace newlines) */
class EmptyBlockWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-latex-empty-line";
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * Split range [from, to) into segments that do not contain line breaks.
 * Returns [{ from, to }, ...] so we can replace each segment without touching newlines.
 */
function segmentsWithoutNewlines(
  doc: string,
  from: number,
  to: number
): { from: number; to: number }[] {
  const slice = doc.slice(from, to);
  const segments: { from: number; to: number }[] = [];
  let start = from;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const next = slice[i + 1];
    if (c === "\n" || c === "\r" || (c === "\r" && next === "\n")) {
      if (start < from + i) {
        segments.push({ from: start, to: from + i });
      }
      start = from + i + (c === "\r" && next === "\n" ? 2 : 1);
      if (c === "\r" && next === "\n") i++;
    }
  }
  if (start < to) {
    segments.push({ from: start, to });
  }
  return segments;
}

/** Max length for a single math expression (avoids runaway match from unclosed \[ or $$) */
const MAX_MATH_LENGTH = 4000;

/**
 * Find math ranges in the document: \[...\], $$...$$, \(...\), $...$
 * Returns array of { from, to, tex, display, closingLength }.
 * closingLength is the length of the closing delimiter (2 for \] or $$) for multiline handling.
 */
function findMathRanges(
  doc: string,
  fromOffset: number,
  toOffset: number
): {
  from: number;
  to: number;
  tex: string;
  display: boolean;
  closingLength: number;
}[] {
  const slice = doc.slice(fromOffset, toOffset);
  const results: {
    from: number;
    to: number;
    tex: string;
    display: boolean;
    closingLength: number;
  }[] = [];
  // Match \[ \], $$ $$, \( \), then $ $ (order matters so $$ and \[ are tried before single $ in case)
  const regex =
    /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\\(([\s\S]*?)\\\)|\$(?!\$)([^$\n]*?)\$/g;
  let match;
  while ((match = regex.exec(slice)) !== null) {
    const from = fromOffset + match.index;
    const to = from + match[0].length;
    let tex: string;
    let display: boolean;
    let closingLength: number;
    if (match[1] !== undefined) {
      tex = match[1];
      display = true;
      closingLength = 2; // \]
    } else if (match[2] !== undefined) {
      tex = match[2];
      display = true;
      closingLength = 2; // $$
    } else if (match[3] !== undefined) {
      tex = match[3];
      display = false;
      closingLength = 2; // \)
    } else {
      tex = match[4];
      display = false;
      closingLength = 1; // $
    }
    if (tex.length <= MAX_MATH_LENGTH) {
      results.push({ from, to, tex, display, closingLength });
    }
  }
  return results;
}

/** True if the range contains any line break (CodeMirror forbids replace over these) */
function rangeHasLineBreak(doc: string, from: number, to: number): boolean {
  const slice = doc.slice(from, to);
  return slice.includes("\n") || slice.includes("\r") || slice.includes("\r\n");
}

function getMathDecorations(view: EditorView): DecorationSet {
  const entries: { from: number; to: number; deco: Decoration }[] = [];
  const seen = new Set<string>();
  const { state } = view;
  const selection = state.selection.main;
  const doc = state.doc.toString();

  for (const { from, to } of view.visibleRanges) {
    const ranges = findMathRanges(doc, from, to);
    for (const {
      from: rFrom,
      to: rTo,
      tex,
      display,
      closingLength,
    } of ranges) {
      const key = `${rFrom}-${rTo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cursorInside = selection.from >= rFrom && selection.from <= rTo;
      const selectionSpans = selection.from < rFrom && selection.to > rTo;
      if (cursorInside || selectionSpans) continue;

      const multiline = rangeHasLineBreak(doc, rFrom, rTo);

      if (multiline) {
        // Cannot use Decoration.replace() over line breaks. Split into
        // segments (each line of content, excluding newlines) and replace
        // each segment: hide source lines with empty widgets, show rendered
        // math on the last segment. Also add line decorations so the line
        // wrapper collapses (otherwise the editor's line-height keeps them tall).
        const segments = segmentsWithoutNewlines(doc, rFrom, rTo);
        const lastIdx = segments.length - 1;
        segments.forEach((seg, i) => {
          if (seg.from === seg.to) return;
          if (i === lastIdx) {
            entries.push({
              from: seg.from,
              to: seg.to,
              deco: Decoration.replace({
                widget: new MathWidget(tex, display, true),
                inclusive: false,
              }),
            });
          } else {
            entries.push({
              from: seg.from,
              to: seg.to,
              deco: Decoration.replace({
                widget: new EmptyBlockWidget(),
                inclusive: false,
              }),
            });
            const line = state.doc.lineAt(seg.from);
            entries.push({
              from: line.from,
              to: line.from,
              deco: Decoration.line({ class: "cm-latex-hidden-line" }),
            });
          }
        });
      } else {
        entries.push({
          from: rFrom,
          to: rTo,
          deco: Decoration.replace({
            widget: new MathWidget(tex, display),
            inclusive: false,
          }),
        });
      }
    }
  }

  entries.sort((a, b) => (a.from !== b.from ? a.from - b.from : a.to - b.to));
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of entries) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

const mathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = getMathDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = getMathDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export function latexExtensions() {
  return [latexTheme, mathPlugin];
}
