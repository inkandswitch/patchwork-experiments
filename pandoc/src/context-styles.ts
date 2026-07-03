export const contextStyles = `
@layer package {
	:root,
	:host,
	[theme] {
		--pandoc-ctx-bg: var(--editor-fill, white);
		--pandoc-ctx-fg: var(--editor-line, black);
		--pandoc-ctx-panel: var(--editor-fill-offset-10, color-mix(in oklch, var(--editor-fill, white), var(--editor-line, black) 4%));
		--pandoc-ctx-muted: var(--editor-line-offset-50, color-mix(in oklch, var(--editor-line, black), var(--editor-fill, white) 45%));
		--pandoc-ctx-border: var(--editor-fill-offset-20, color-mix(in oklch, var(--editor-fill, white), var(--editor-line, black) 12%));
		--pandoc-ctx-hover: color-mix(in oklch, var(--editor-fill, white), var(--editor-line, black) 6%);
		--pandoc-ctx-paper: var(--editor-fill, white);
		--pandoc-ctx-accent: var(--studio-primary, #4f46e5);
		--pandoc-ctx-accent-soft: color-mix(in oklch, var(--studio-primary, #4f46e5), var(--editor-fill, white) 82%);
		--pandoc-ctx-accent-line: color-mix(in oklch, var(--studio-primary, #4f46e5), var(--editor-fill, white) 55%);
		--pandoc-ctx-danger: var(--studio-danger, #dc2626);
		--pandoc-ctx-danger-soft: color-mix(in oklch, var(--studio-danger, #dc2626), var(--editor-fill, white) 88%);
		--pandoc-ctx-warning: var(--studio-warning, #92400e);
		--pandoc-ctx-warning-soft: color-mix(in oklch, var(--studio-warning, #d97706), var(--editor-fill, white) 84%);
		--pandoc-ctx-family: var(--editor-family-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
		--pandoc-ctx-family-code: var(--editor-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
	}
}

.pandoc-ctx {
	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	overflow: hidden;
	background: var(--pandoc-ctx-bg);
	color: var(--pandoc-ctx-fg);
	font-family: var(--pandoc-ctx-family);
	font-size: 13px;
}
.pandoc-ctx *, .pandoc-ctx *::before, .pandoc-ctx *::after { box-sizing: border-box; }

/* ─── composition ─── */
.pandoc-ctx .cluster {
	display: flex;
	align-items: center;
	gap: var(--studio-space-xs, 0.5rem);
}
.pandoc-ctx .flow > * + * { margin-top: var(--studio-space-sm, 0.6rem); }
.pandoc-ctx .spacer { flex: 1 1 auto; }

/* ─── header row: formats + draggable output + download, one line ─── */
.pandoc-ctx .header {
	flex-wrap: nowrap;
	gap: var(--studio-space-2xs, 0.375rem);
	padding: var(--studio-space-2xs, 0.375rem) var(--studio-space-sm, 0.75rem);
	background: var(--pandoc-ctx-panel);
	border-bottom: 1px solid var(--pandoc-ctx-border);
}
/* From → To grouped as one pill */
.pandoc-ctx .formats {
	gap: 0;
	flex: 0 1 auto;
	min-width: 0;
	height: 26px;
	padding: 0 2px;
	border: 1px solid var(--pandoc-ctx-border);
	border-radius: var(--studio-radius-sm, 6px);
	background: var(--pandoc-ctx-bg);
}
.pandoc-ctx .select {
	font: inherit;
	font-size: 11px;
	color: var(--pandoc-ctx-fg);
	height: 22px;
	padding: 0 4px;
	border: none;
	border-radius: var(--studio-radius-sm, 4px);
	background: none;
	min-width: 40px;
	max-width: 116px;
	flex: 0 1 auto;
	cursor: pointer;
	appearance: none;
	-webkit-appearance: none;
	text-overflow: ellipsis;
}
.pandoc-ctx .select:hover { background: var(--pandoc-ctx-hover); }
.pandoc-ctx .arrow { color: var(--pandoc-ctx-muted); flex: none; font-size: 11px; padding: 0 1px; }
.pandoc-ctx .link {
	font: inherit;
	font-size: 11px;
	border: none;
	background: none;
	color: var(--pandoc-ctx-accent);
	padding: 2px 4px;
	cursor: pointer;
	flex: none;
	white-space: nowrap;
}
.pandoc-ctx .link:hover { text-decoration: underline; }

/* ─── buttons ─── */
.pandoc-ctx .btn {
	font: inherit;
	font-size: 12px;
	padding: 4px 10px;
	border: 1px solid var(--pandoc-ctx-border);
	border-radius: var(--studio-radius-sm, 5px);
	background: var(--pandoc-ctx-bg);
	color: var(--pandoc-ctx-fg);
	cursor: pointer;
}
.pandoc-ctx .btn:hover { background: var(--pandoc-ctx-hover); }

/* ─── preview ─── */
.pandoc-ctx .viewer {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: var(--pandoc-ctx-bg);
}
.pandoc-ctx .toolbar {
	gap: var(--studio-space-2xs, 0.375rem);
	padding: var(--studio-space-2xs, 0.375rem) var(--studio-space-sm, 0.75rem);
	border-bottom: 1px solid var(--pandoc-ctx-border);
	background: var(--pandoc-ctx-panel);
}
/* rendered/source toggle — a segmented control */
.pandoc-ctx .tabs {
	gap: 0;
	padding: 2px;
	background: var(--pandoc-ctx-hover);
	border-radius: var(--studio-radius-sm, 6px);
}
.pandoc-ctx .tab {
	font: inherit;
	font-size: 11px;
	padding: 2px 10px;
	border: none;
	border-radius: var(--studio-radius-sm, 4px);
	background: none;
	color: var(--pandoc-ctx-muted);
	cursor: pointer;
}
.pandoc-ctx .tab[data-active] {
	background: var(--pandoc-ctx-bg);
	color: var(--pandoc-ctx-fg);
	font-weight: 600;
	box-shadow: var(--studio-shadow-sm, 0 1px 2px rgba(0,0,0,0.08));
}
.pandoc-ctx .filename {
	font-size: 11px;
	color: var(--pandoc-ctx-muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* the converted document, as a draggable handle (drag the "name.html" chip) */
.pandoc-ctx .doc-handle {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	max-width: 55%;
	height: 26px;
	padding: 0 10px;
	font-size: 11.5px;
	font-weight: 600;
	color: var(--pandoc-ctx-accent);
	background: var(--pandoc-ctx-accent-soft);
	border: 1px solid var(--pandoc-ctx-accent-line);
	border-radius: var(--studio-radius-round, 9999px);
	cursor: grab;
	user-select: none;
	flex: 0 1 auto;
	transition: background var(--studio-transition-fast, 0.1s ease);
}
.pandoc-ctx .doc-handle:hover { background: color-mix(in oklch, var(--pandoc-ctx-accent-soft), var(--pandoc-ctx-accent) 12%); }
.pandoc-ctx .doc-handle:active { cursor: grabbing; }
.pandoc-ctx .doc-handle .grip { font-size: 13px; letter-spacing: -2px; opacity: 0.7; flex: none; }
.pandoc-ctx .doc-handle .doc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pandoc-ctx .icon-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	font-size: 14px;
	border: 1px solid var(--pandoc-ctx-border);
	border-radius: var(--studio-radius-sm, 5px);
	background: var(--pandoc-ctx-bg);
	color: var(--pandoc-ctx-fg);
	cursor: pointer;
	flex: none;
}
.pandoc-ctx .icon-btn:hover:not(:disabled) { background: var(--pandoc-ctx-hover); }
.pandoc-ctx .icon-btn:disabled { opacity: 0.4; cursor: default; }

.pandoc-ctx .viewer-main {
	flex: 1;
	min-height: 0;
	position: relative;
	overflow: auto;
}
.pandoc-ctx .frame {
	width: 100%;
	height: 100%;
	border: none;
	background: var(--pandoc-ctx-paper);
	display: block;
}
.pandoc-ctx .source {
	margin: 0;
	padding: var(--studio-space-sm, 0.75rem);
	font-family: var(--pandoc-ctx-family-code);
	font-size: 11.5px;
	line-height: 1.5;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--pandoc-ctx-fg);
}
.pandoc-ctx .source[draggable="true"] { cursor: grab; }

.pandoc-ctx .placeholder,
.pandoc-ctx .binary-card {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: var(--studio-space-lg, 1.5rem);
	text-align: center;
	color: var(--pandoc-ctx-muted);
}
.pandoc-ctx .binary-card[draggable="true"] { cursor: grab; }
.pandoc-ctx .glyph { font-size: 34px; opacity: 0.5; }
.pandoc-ctx .binary-card .filename { font-size: 13px; font-weight: 600; color: var(--pandoc-ctx-fg); word-break: break-word; }
.pandoc-ctx .muted { font-size: 11px; color: var(--pandoc-ctx-muted); }

.pandoc-ctx .error {
	margin: var(--studio-space-sm, 0.75rem);
	padding: var(--studio-space-sm, 0.75rem);
	border: 1px solid var(--pandoc-ctx-danger);
	background: var(--pandoc-ctx-danger-soft);
	color: var(--pandoc-ctx-danger);
	border-radius: var(--studio-radius-md, 8px);
	font-family: var(--pandoc-ctx-family-code);
	font-size: 11.5px;
	white-space: pre-wrap;
	word-break: break-word;
}

.pandoc-ctx .reconvert {
	position: absolute;
	top: var(--studio-space-xs, 0.5rem);
	right: var(--studio-space-xs, 0.5rem);
	background: color-mix(in oklch, var(--pandoc-ctx-bg), transparent 12%);
	border: 1px solid var(--pandoc-ctx-border);
	border-radius: var(--studio-radius-round, 9999px);
	padding: 4px 6px;
	backdrop-filter: blur(2px);
}

.pandoc-ctx .warnings {
	border-top: 1px solid color-mix(in oklch, var(--pandoc-ctx-warning), transparent 60%);
	background: var(--pandoc-ctx-warning-soft);
	color: var(--pandoc-ctx-warning);
	padding: var(--studio-space-2xs, 0.375rem) var(--studio-space-sm, 0.75rem);
	font-size: 11px;
	max-height: 84px;
	overflow: auto;
}

.pandoc-ctx .progress {
	width: 160px;
	max-width: 70%;
	height: 5px;
	background: var(--pandoc-ctx-border);
	border-radius: var(--studio-radius-round, 9999px);
	overflow: hidden;
}
.pandoc-ctx .progress > div {
	height: 100%;
	background: var(--pandoc-ctx-accent);
	transition: width var(--studio-transition-normal, 0.15s ease);
}

/* ─── spinner ─── */
.pandoc-ctx .spinner {
	display: inline-block;
	width: 15px;
	height: 15px;
	border: 2px solid var(--pandoc-ctx-border);
	border-top-color: var(--pandoc-ctx-accent);
	border-radius: 50%;
	animation: pandoc-ctx-spin 0.7s linear infinite;
}
@keyframes pandoc-ctx-spin { to { transform: rotate(360deg); } }

/* ─── field picker (DocPicker) ─── */
.pandoc-ctx .pandoc-modal-backdrop {
	position: fixed;
	inset: 0;
	background: color-mix(in oklch, var(--pandoc-ctx-fg), transparent 65%);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 1000;
	padding: var(--studio-space-lg, 1.5rem);
}
.pandoc-ctx .pandoc-modal {
	background: var(--pandoc-ctx-bg);
	color: var(--pandoc-ctx-fg);
	border-radius: var(--studio-radius-lg, 10px);
	width: min(560px, 100%);
	max-height: 80vh;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-shadow: var(--studio-shadow-lg, 0 12px 40px rgba(0,0,0,0.25));
	font-family: var(--pandoc-ctx-family);
	font-size: 13px;
}
.pandoc-ctx .pandoc-modal-header { display: flex; gap: var(--studio-space-sm, 0.75rem); padding: var(--studio-space-sm, 0.75rem) var(--studio-space-md, 1rem); border-bottom: 1px solid var(--pandoc-ctx-border); }
.pandoc-ctx .pandoc-modal-header h3 { margin: 0 0 3px; font-size: 15px; }
.pandoc-ctx .pandoc-modal-header p { margin: 0; font-size: 12px; color: var(--pandoc-ctx-muted); }
.pandoc-ctx .pandoc-modal-close { margin-left: auto; border: none; background: none; font-size: 20px; line-height: 1; cursor: pointer; color: var(--pandoc-ctx-muted); }
.pandoc-ctx .pandoc-modal-body { padding: var(--studio-space-xs, 0.5rem) var(--studio-space-sm, 0.75rem); overflow: auto; }
.pandoc-ctx .pandoc-modal-footer { display: flex; gap: var(--studio-space-xs, 0.5rem); justify-content: flex-end; padding: var(--studio-space-sm, 0.75rem) var(--studio-space-md, 1rem); border-top: 1px solid var(--pandoc-ctx-border); }
.pandoc-ctx .pandoc-btn {
	font: inherit;
	font-size: 12px;
	padding: 4px 10px;
	border: 1px solid var(--pandoc-ctx-border);
	border-radius: var(--studio-radius-sm, 5px);
	background: var(--pandoc-ctx-bg);
	color: var(--pandoc-ctx-fg);
	cursor: pointer;
}
.pandoc-ctx .pandoc-btn:hover { background: var(--pandoc-ctx-hover); }
.pandoc-ctx .pandoc-btn.primary { background: var(--pandoc-ctx-accent); border-color: var(--pandoc-ctx-accent); color: var(--pandoc-ctx-bg); }

.pandoc-ctx .pandoc-tree { list-style: none; margin: 0; padding: 0 0 0 12px; }
.pandoc-ctx .pandoc-tree:first-child { padding-left: 0; }
.pandoc-ctx .pandoc-tree-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: var(--studio-radius-sm, 5px); cursor: default; }
.pandoc-ctx .pandoc-tree-row.pickable { cursor: pointer; }
.pandoc-ctx .pandoc-tree-row.pickable:hover { background: var(--pandoc-ctx-accent-soft); }
.pandoc-ctx .pandoc-tree-row .twisty { width: 12px; color: var(--pandoc-ctx-muted); }
.pandoc-ctx .pandoc-tree-row .key { font-weight: 600; }
.pandoc-ctx .pandoc-tree-row .preview { color: var(--pandoc-ctx-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.pandoc-ctx .pandoc-tree-row .use { color: var(--pandoc-ctx-accent); font-size: 11px; }
`
