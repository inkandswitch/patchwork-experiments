# prose

A Bear/Typora-style live-preview markdown editor for Patchwork's `markdown`
datatype. The doc stays a plain markdown string in `content` — the delimiters
(`# `, `- `, `**bold**`) live in the text and are hidden and styled in place,
revealing back to raw source wherever your caret is:

- **Line markers** (headings, blockquotes, list bullets, task checkboxes)
  reveal when the caret is anywhere on their line.
- **Inline marks** (`**bold**`, `*em*`, `` `code` ``, `~~strike~~`, `==mark==`,
  `[links](url)`) reveal only when the caret is inside the span, so editing
  stays local.

Extras: cute accent list bullets, tappable task checkboxes (`- [ ]` / `- [x]`),
`---` renders as a rule, fenced code blocks, inline images, Enter continues /
exits lists, and `⌘B` / `⌘I` / `⌘E` wrap the selection. `⌘`-click opens a link.

Everything is theme-powered — colours, type, and spacing derive from the
`--editor-*` / `--studio-*` theme variables, so it follows light/dark and any
active theme.

## Layout

Bundleless vanilla JS — no build step. `pushwork sync` deploys it directly.

- `prose.js` — the Patchwork plugin manifest (a single `patchwork:tool`; the
  `markdown` datatype is provided elsewhere).
- `tool.js` — the `(handle, element) => cleanup` render function. Mounts
  CodeMirror bound to `content`, syncing text via `am.splice` (remote edits
  reconcile with a minimal diff).
- `preview.js` — the live-preview: a CodeMirror `StateField` that classifies each
  line and inline span and emits reveal-on-cursor decorations, plus the list /
  formatting keymap and link clicks.
- `style.js` — the stylesheet, scoped under `.prose-tool`, deriving `--prose-*`
  tokens from the theme.

## Develop

```sh
pushwork sync     # deploy to Patchwork
```
