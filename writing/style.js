// Styles for the prose tool. Everything derives from the theme's `--editor-*`
// (surface/type) and `--studio-*` (accent/spacing) variables, mapped once into
// `--prose-*` tokens in @layer package so themes re-evaluate cleanly. Style rules
// stay unlayered and scoped under `.prose-tool`.

export const STYLE = `
@layer package {
	:root,
	:host,
	[theme] {
		--prose-fill: var(--editor-fill, white);
		--prose-line: var(--editor-line, #1a1a1a);
		--prose-muted: var(--editor-line-offset-40, #8a8a8a);
		--prose-faint: var(--editor-line-offset-20, #c4c4c4);
		--prose-surface: color-mix(in oklch, var(--editor-fill), var(--editor-line) 5%);
		--prose-surface-strong: color-mix(in oklch, var(--editor-fill), var(--editor-line) 9%);
		--prose-border: var(--editor-fill-offset-20, #e4e4e4);
		--prose-accent: var(--studio-primary, #35f7ca);
		--prose-accent-ink: var(--studio-primary-line, #08221b);
		--prose-accent-text: var(--editor-primary-text, var(--studio-primary, #12b48b));
		--prose-link: var(--editor-link-text, var(--studio-link, #2b7fff));
		--prose-selection: var(--editor-selection-fill, color-mix(in oklch, var(--studio-primary, #35f7ca), transparent 70%));
		--prose-cursor: var(--editor-cursor-fill, var(--editor-line, #1a1a1a));
		--prose-family: var(--editor-family-sans, ui-sans-serif, system-ui, sans-serif);
		--prose-code-family: var(--editor-family-code, ui-monospace, "SF Mono", monospace);
	}
}

.prose-tool {
	height: 100%;
	background: var(--prose-fill);
	color: var(--prose-line);
	overflow: hidden;
}

.prose-tool .prose-editor {
	height: 100%;
}

.prose-tool .cm-editor {
	height: 100%;
	background: var(--prose-fill);
	color: var(--prose-line);
}
.prose-tool .cm-editor.cm-focused {
	outline: none;
}
.prose-tool .cm-scroller {
	overflow: auto;
	font-family: var(--prose-family);
	line-height: 1.72;
}
.prose-tool .cm-content {
	max-width: 46rem;
	margin: 0 auto;
	padding: clamp(1.5rem, 5vw, 4rem) clamp(1rem, 5vw, 3rem) 40vh;
	caret-color: var(--prose-cursor);
	font-size: 1.05rem;
	color: var(--prose-line);
}
.prose-tool .cm-line {
	padding: 0;
}
.prose-tool .cm-cursor,
.prose-tool .cm-dropCursor {
	border-left: 2px solid var(--prose-cursor);
}
.prose-tool .cm-selectionBackground,
.prose-tool .cm-content ::selection {
	background: var(--prose-selection);
}
.prose-tool .cm-editor.cm-focused .cm-selectionBackground {
	background: var(--prose-selection);
}

/* --- raw markers (shown dim while editing the line) --- */
.prose-tool .cm-md-marker {
	color: var(--prose-faint);
}

/* --- headings --- */
.prose-tool .cm-md-heading {
	font-weight: 700;
	line-height: 1.25;
	letter-spacing: -0.01em;
}
.prose-tool .cm-md-h1 { font-size: 2.1em; margin: 0.6em 0 0.3em; }
.prose-tool .cm-md-h2 { font-size: 1.6em; margin: 0.6em 0 0.3em; }
.prose-tool .cm-md-h3 { font-size: 1.32em; margin: 0.5em 0 0.25em; }
.prose-tool .cm-md-h4 { font-size: 1.12em; margin: 0.5em 0 0.25em; }
.prose-tool .cm-md-h5 { font-size: 1em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--prose-muted); }
.prose-tool .cm-md-h6 { font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--prose-muted); }

/* --- blockquote --- */
.prose-tool .cm-md-quote {
	border-left: 3px solid color-mix(in oklch, var(--prose-accent), var(--prose-fill) 20%);
	padding-left: 1em;
	color: var(--prose-muted);
	font-style: italic;
}

/* --- lists --- */
.prose-tool .cm-md-li {
	padding-left: calc(1.5em + var(--md-indent, 0) * 0.55ch);
	text-indent: 0;
}
.prose-tool .cm-md-ul {
	position: relative;
}
.prose-tool .cm-md-ul:not(.cm-md-ul-raw)::before {
	content: "";
	position: absolute;
	left: calc(0.55em + var(--md-indent, 0) * 0.55ch);
	top: 0.72em;
	width: 0.4em;
	height: 0.4em;
	border-radius: 999px;
	background: var(--prose-accent);
	box-shadow: 0 0 0 2px color-mix(in oklch, var(--prose-accent), transparent 75%);
}
.prose-tool .cm-md-ol {
	color: var(--prose-line);
}

/* --- task list --- */
.prose-tool .cm-md-task.cm-md-task-done {
	color: var(--prose-muted);
	text-decoration: line-through;
	text-decoration-color: var(--prose-faint);
}
.prose-tool .cm-md-checkbox {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.1em;
	height: 1.1em;
	margin-right: 0.15em;
	vertical-align: -0.18em;
	border: 1.5px solid color-mix(in oklch, var(--prose-line), var(--prose-fill) 55%);
	border-radius: 0.35em;
	cursor: pointer;
	transition: background 0.12s ease, border-color 0.12s ease;
}
.prose-tool .cm-md-checkbox:hover {
	border-color: var(--prose-accent);
}
.prose-tool .cm-md-checkbox[data-checked] {
	background: var(--prose-accent);
	border-color: var(--prose-accent);
}
.prose-tool .cm-md-checkbox[data-checked]::after {
	content: "";
	width: 0.32em;
	height: 0.6em;
	margin-top: -0.08em;
	border: solid var(--prose-accent-ink);
	border-width: 0 0.14em 0.14em 0;
	transform: rotate(43deg);
}

/* --- horizontal rule --- */
.prose-tool .cm-md-rule {
	padding: 0.7em 0;
}
.prose-tool .cm-md-rule hr {
	border: none;
	border-top: 2px solid var(--prose-border);
	margin: 0;
}
.prose-tool .cm-md-hr-raw {
	color: var(--prose-muted);
	letter-spacing: 0.3em;
}

/* --- code block --- */
.prose-tool .cm-md-codeline {
	font-family: var(--prose-code-family);
	font-size: 0.92em;
	background: var(--prose-surface);
	box-shadow: -0.7em 0 0 var(--prose-surface), 0.7em 0 0 var(--prose-surface);
}
.prose-tool .cm-md-fence {
	color: var(--prose-muted);
}

/* --- inline marks --- */
.prose-tool .cm-md-strong { font-weight: 700; }
.prose-tool .cm-md-em { font-style: italic; }
.prose-tool .cm-md-strike { text-decoration: line-through; color: var(--prose-muted); }
.prose-tool .cm-md-code {
	font-family: var(--prose-code-family);
	font-size: 0.9em;
	background: var(--prose-surface-strong);
	padding: 0.08em 0.34em;
	border-radius: 0.35em;
	border: 1px solid var(--prose-border);
}
.prose-tool .cm-md-highlight {
	background: color-mix(in oklch, var(--prose-accent), transparent 55%);
	border-radius: 0.2em;
	padding: 0 0.1em;
}
.prose-tool .cm-md-link {
	color: var(--prose-link);
	text-decoration: underline;
	text-decoration-color: color-mix(in oklch, var(--prose-link), transparent 55%);
	text-underline-offset: 0.15em;
	cursor: text;
}
.prose-tool .cm-md-image {
	display: block;
	max-width: 100%;
	border-radius: var(--studio-radius-md, 8px);
	margin: 0.4em 0;
}
`
