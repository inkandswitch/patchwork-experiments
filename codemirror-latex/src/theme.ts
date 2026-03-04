import { EditorView } from "@codemirror/view";

export const latexTheme = EditorView.baseTheme({
  ".cm-latex-math": {
    display: "inline-block",
  },
  ".cm-latex-math-inline": {
    marginLeft: "0.15em",
    marginRight: "0.15em",
  },
  ".cm-latex-math-display": {
    display: "block",
    margin: "0.75em 0",
    overflowX: "auto",
    overflowY: "hidden",
    textAlign: "center",
  },
  ".cm-latex-math-display .katex": {
    fontSize: "1.1em",
  },
  ".cm-latex-block-preview": {
    display: "block",
    marginTop: "0.5em",
    marginBottom: "0.75em",
    padding: "0.75em",
    borderRadius: "4px",
    backgroundColor: "var(--color-base-200, #f1f5f9)",
    border: "1px solid var(--color-base-300, #e2e8f0)",
  },
  "&dark .cm-latex-block-preview": {
    backgroundColor: "var(--color-base-200, #1e293b)",
    borderColor: "var(--color-base-300, #334155)",
  },
  ".cm-latex-empty-line": {
    display: "block",
    height: 0,
    overflow: "hidden",
    margin: 0,
    padding: 0,
    lineHeight: 0,
    minHeight: 0,
  },
  /* Collapse the entire line when it only contains the empty widget */
  ".cm-latex-hidden-line": {
    height: 0,
    minHeight: 0,
    overflow: "hidden",
    margin: 0,
    padding: 0,
    lineHeight: 0,
    border: "none",
  },
  ".cm-latex-hidden-line .cm-line": {
    height: 0,
    minHeight: 0,
    overflow: "hidden",
    margin: 0,
    padding: 0,
    lineHeight: 0,
  },
});
