// A condensed CodeMirror theme + syntax highlight for Sketchy.
//
// littlebook's theme.ts drives every CodeMirror class and ~60 syntax tags off a
// large `--syntax-*` / `--text-editor-*` CSS variable system. Rather than port
// that whole var system (most would be undefined here → no styling), this is a
// compact theme in Sketchy's risograph palette, reading the few Patchwork theme
// tokens Sketchy already derives, with concrete fallbacks. Extension parity with
// lb is kept (commands/search/lang packs); only the theme is condensed.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// riso palette (matches the Sketchy / sticker house style)
const INK = "var(--ns-ink, var(--studio-line, #2b2b2b))";
const PAPER = "var(--ns-paper, var(--editor-fill-offset-10, #fffdf4))";
const PINK = "#ff2284";
const MINT = "#2aa897";
const BLUE = "#2b6cff";
const PLUM = "#8a4fff";
const MUTE = "color-mix(in srgb, currentColor 45%, transparent)";

export const editorTheme = EditorView.theme({
  "&": {
    color: INK,
    backgroundColor: PAPER,
    fontFamily: "var(--studio-family-mono, ui-monospace, monospace)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-content": { caretColor: PINK, padding: "8px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: PINK },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, " + MINT + " 30%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, " + INK + " 5%, transparent)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: MUTE,
    border: "none",
    fontSize: "11px",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: INK },
  ".cm-panel.cm-search": {
    backgroundColor: PAPER,
    color: INK,
    border: "1px solid " + INK,
  },
  ".cm-scroller": { lineHeight: "1.5", overflow: "auto" },
});

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: MUTE, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: PINK, fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: MINT },
  { tag: [t.number, t.bool, t.atom, t.null], color: PLUM },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: BLUE },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: PLUM, fontWeight: "600" },
  { tag: [t.propertyName, t.attributeName], color: BLUE },
  { tag: [t.variableName, t.definition(t.variableName)], color: INK },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: MUTE },
  { tag: [t.heading], color: PINK, fontWeight: "700" },
  { tag: [t.link, t.url], color: BLUE, textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "700" },
  { tag: [t.invalid], color: "#d11" },
]);

export default [editorTheme, syntaxHighlighting(highlight)];
