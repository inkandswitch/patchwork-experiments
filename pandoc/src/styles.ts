export const styles = `
.pandoc-tool {
	--bg: #fafafa;
	--panel: #ffffff;
	--border: #e4e4e7;
	--text: #18181b;
	--text-dim: #71717a;
	--accent: #4f46e5;
	--accent-soft: #eef2ff;
	--danger: #dc2626;
	--warning-bg: #fffbeb;
	--warning-border: #fde68a;
	--warning-text: #92400e;
	--radius: 8px;

	position: relative;
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	overflow: hidden;
	background: var(--bg);
	color: var(--text);
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	font-size: 13px;
}

.pandoc-tool *, .pandoc-tool *::before, .pandoc-tool *::after {
	box-sizing: border-box;
}

/* ─── header ─── */
.pandoc-header {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	background: var(--panel);
	border-bottom: 1px solid var(--border);
	flex-wrap: wrap;
}

.pandoc-field {
	display: flex;
	align-items: center;
	gap: 6px;
}

.pandoc-field label {
	color: var(--text-dim);
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.pandoc-select {
	appearance: none;
	-webkit-appearance: none;
	padding: 6px 26px 6px 10px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--panel) url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2371717a' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 9px center;
	font: inherit;
	color: var(--text);
	cursor: pointer;
	max-width: 200px;
}

.pandoc-select:hover { border-color: #c8c8cf; }
.pandoc-select:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }

.pandoc-arrow {
	color: var(--text-dim);
	font-size: 15px;
	user-select: none;
}

.pandoc-check {
	display: flex;
	align-items: center;
	gap: 5px;
	color: var(--text-dim);
	cursor: pointer;
	user-select: none;
}

.pandoc-check input { accent-color: var(--accent); margin: 0; }

.pandoc-header-spacer { flex: 1; }

.pandoc-resolved {
	color: var(--text-dim);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

/* ─── body ─── */
.pandoc-body {
	display: flex;
	flex: 1;
	min-height: 0;
}

.pandoc-inputs {
	width: 230px;
	min-width: 180px;
	display: flex;
	flex-direction: column;
	border-right: 1px solid var(--border);
	background: var(--panel);
}

.pandoc-inputs-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 12px 6px;
}

.pandoc-inputs-header h2 {
	margin: 0;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--text-dim);
}

.pandoc-icon-btns { display: flex; gap: 4px; }

.pandoc-btn {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 5px 10px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--panel);
	color: var(--text);
	font: inherit;
	cursor: pointer;
	white-space: nowrap;
}

.pandoc-btn:hover { background: #f4f4f5; }
.pandoc-btn:disabled { opacity: 0.5; cursor: default; }

.pandoc-btn.primary {
	background: var(--accent);
	border-color: var(--accent);
	color: #fff;
}

.pandoc-btn.primary:hover:not(:disabled) { background: #4338ca; }

.pandoc-btn.small { padding: 3px 8px; font-size: 12px; }

.pandoc-input-list {
	list-style: none;
	margin: 0;
	padding: 4px 8px 8px;
	overflow-y: auto;
	flex: 1;
}

.pandoc-input-item {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 6px 8px;
	border-radius: var(--radius);
	cursor: pointer;
	color: var(--text-dim);
}

.pandoc-input-item:hover { background: #f4f4f5; }

.pandoc-input-item.main {
	background: var(--accent-soft);
	color: var(--text);
}

.pandoc-input-item .marker {
	flex: none;
	width: 14px;
	text-align: center;
	font-size: 11px;
	color: var(--accent);
}

.pandoc-input-item .name {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	direction: rtl;
	text-align: left;
}

.pandoc-input-item .remove {
	flex: none;
	border: none;
	background: none;
	color: var(--text-dim);
	font-size: 14px;
	line-height: 1;
	cursor: pointer;
	padding: 2px 4px;
	border-radius: 4px;
	visibility: hidden;
}

.pandoc-input-item:hover .remove { visibility: visible; }
.pandoc-input-item .remove:hover { color: var(--danger); background: #fee2e2; }

.pandoc-empty {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	margin: 8px;
	padding: 20px;
	border: 1.5px dashed var(--border);
	border-radius: var(--radius);
	color: var(--text-dim);
	text-align: center;
}

.pandoc-empty .big { font-size: 26px; }

/* ─── preview ─── */
.pandoc-preview {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.pandoc-preview-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--border);
	background: var(--panel);
}

.pandoc-tabs {
	display: flex;
	background: #f4f4f5;
	border-radius: var(--radius);
	padding: 2px;
	gap: 2px;
}

.pandoc-tab {
	border: none;
	background: none;
	padding: 4px 12px;
	border-radius: 6px;
	font: inherit;
	color: var(--text-dim);
	cursor: pointer;
}

.pandoc-tab.active {
	background: var(--panel);
	color: var(--text);
	box-shadow: 0 1px 2px rgba(0,0,0,0.07);
}

.pandoc-preview-spacer { flex: 1; }

.pandoc-preview-main {
	flex: 1;
	min-height: 0;
	position: relative;
	overflow: auto;
}

.pandoc-preview-frame {
	width: 100%;
	height: 100%;
	border: none;
	background: #fff;
	display: block;
}

.pandoc-source {
	margin: 0;
	padding: 16px;
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12px;
	line-height: 1.55;
	white-space: pre-wrap;
	word-break: break-word;
	color: var(--text);
}

.pandoc-placeholder {
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	color: var(--text-dim);
}

.pandoc-binary-card {
	margin: auto;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 28px 36px;
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 12px;
	box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.pandoc-binary-card .icon { font-size: 30px; }
.pandoc-binary-card .filename { font-weight: 600; }
.pandoc-binary-card .size { color: var(--text-dim); }

.pandoc-error {
	margin: 12px;
	padding: 10px 12px;
	background: #fef2f2;
	border: 1px solid #fecaca;
	border-radius: var(--radius);
	color: var(--danger);
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12px;
	white-space: pre-wrap;
}

.pandoc-warnings {
	max-height: 90px;
	overflow-y: auto;
	border-top: 1px solid var(--warning-border);
	background: var(--warning-bg);
	color: var(--warning-text);
	padding: 6px 12px;
	font-size: 12px;
}

.pandoc-warnings div { padding: 1px 0; }

/* ─── outputs ─── */
.pandoc-outputs {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
	padding: 6px 12px;
	border-top: 1px solid var(--border);
	background: var(--panel);
}

.pandoc-outputs .label {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--text-dim);
}

.pandoc-chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 3px 9px;
	background: var(--accent-soft);
	border: 1px solid #c7d2fe;
	border-radius: 999px;
	color: var(--accent);
	cursor: grab;
	font-size: 12px;
	user-select: none;
}

.pandoc-chip .chip-remove {
	border: none;
	background: none;
	cursor: pointer;
	color: inherit;
	padding: 0;
	font-size: 13px;
	line-height: 1;
}

/* ─── status bar ─── */
.pandoc-status {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 12px;
	border-top: 1px solid var(--border);
	background: var(--panel);
	color: var(--text-dim);
	font-size: 11.5px;
}

.pandoc-status .dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: #d4d4d8;
}

.pandoc-status .dot.ready { background: #22c55e; }
.pandoc-status .dot.loading { background: #f59e0b; }
.pandoc-status .dot.error { background: var(--danger); }

.pandoc-status .spacer { flex: 1; }

.pandoc-progress {
	width: 120px;
	height: 4px;
	background: #e4e4e7;
	border-radius: 999px;
	overflow: hidden;
}

.pandoc-progress > div {
	height: 100%;
	background: var(--accent);
	border-radius: 999px;
	transition: width 0.15s ease;
}

/* ─── drop overlay ─── */
.pandoc-drop-overlay {
	position: absolute;
	inset: 0;
	z-index: 10;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(79, 70, 229, 0.08);
	backdrop-filter: blur(1px);
	border: 2px dashed var(--accent);
	border-radius: 4px;
	pointer-events: none;
}

.pandoc-drop-overlay span {
	padding: 10px 18px;
	background: var(--accent);
	color: #fff;
	border-radius: 999px;
	font-weight: 600;
	box-shadow: 0 4px 16px rgba(79, 70, 229, 0.35);
}

.pandoc-spinner {
	width: 13px;
	height: 13px;
	border: 2px solid rgba(255,255,255,0.4);
	border-top-color: #fff;
	border-radius: 50%;
	animation: pandoc-spin 0.7s linear infinite;
}

.pandoc-spinner.dark {
	border-color: #d4d4d8;
	border-top-color: var(--accent);
}

@keyframes pandoc-spin { to { transform: rotate(360deg); } }

/* ─── converting badge (overlays preview while re-converting) ─── */
.pandoc-converting-badge {
	position: absolute;
	top: 10px;
	right: 12px;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 5px 11px;
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 999px;
	color: var(--text-dim);
	font-size: 12px;
	box-shadow: 0 2px 8px rgba(0,0,0,0.08);
	pointer-events: none;
}

/* ─── doc value picker modal ─── */
.pandoc-modal-backdrop {
	position: absolute;
	inset: 0;
	z-index: 20;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(24, 24, 27, 0.35);
	backdrop-filter: blur(1.5px);
}

.pandoc-modal {
	display: flex;
	flex-direction: column;
	width: min(480px, calc(100% - 40px));
	max-height: min(520px, calc(100% - 40px));
	background: var(--panel);
	border-radius: 12px;
	box-shadow: 0 16px 48px rgba(0,0,0,0.22);
	overflow: hidden;
}

.pandoc-modal-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 10px;
	padding: 14px 16px 10px;
	border-bottom: 1px solid var(--border);
}

.pandoc-modal-header h3 {
	margin: 0 0 3px;
	font-size: 14px;
	font-weight: 600;
}

.pandoc-modal-header p {
	margin: 0;
	color: var(--text-dim);
	font-size: 12px;
}

.pandoc-modal-close {
	border: none;
	background: none;
	color: var(--text-dim);
	font-size: 18px;
	line-height: 1;
	cursor: pointer;
	padding: 2px 6px;
	border-radius: 6px;
}

.pandoc-modal-close:hover { background: #f4f4f5; color: var(--text); }

.pandoc-modal-body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 8px 10px;
}

.pandoc-modal-footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 10px 16px;
	border-top: 1px solid var(--border);
	background: var(--bg);
}

/* doc structure tree */
.pandoc-tree {
	list-style: none;
	margin: 0;
	padding: 0 0 0 14px;
}

.pandoc-modal-body > .pandoc-tree { padding-left: 0; }

.pandoc-tree-row {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 8px;
	border-radius: 6px;
	cursor: default;
	font-size: 12.5px;
}

.pandoc-tree-row .twisty {
	flex: none;
	width: 12px;
	color: var(--text-dim);
	font-size: 10px;
}

.pandoc-tree-row .key {
	flex: none;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 12px;
	color: var(--text);
}

.pandoc-tree-row .preview {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--text-dim);
}

.pandoc-tree-row .use {
	flex: none;
	visibility: hidden;
	padding: 1px 9px;
	background: var(--accent);
	color: #fff;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
}

.pandoc-tree-row.pickable { cursor: pointer; }
.pandoc-tree-row.pickable:hover { background: var(--accent-soft); }
.pandoc-tree-row.pickable:hover .use { visibility: visible; }
.pandoc-tree-row:not(.pickable):hover { background: #f4f4f5; }

/* ─── paste text modal ─── */
.pandoc-paste-modal { width: min(620px, calc(100% - 40px)); }

.pandoc-paste-body { padding: 12px 16px; }

.pandoc-paste-area {
	width: 100%;
	min-height: 240px;
	resize: vertical;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--bg);
	color: var(--text);
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12.5px;
	line-height: 1.55;
}

.pandoc-paste-area:focus {
	outline: 2px solid var(--accent-soft);
	border-color: var(--accent);
}

.pandoc-paste-footer { align-items: center; }

.pandoc-paste-name {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--text-dim);
}

.pandoc-paste-name span {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.pandoc-paste-name input {
	width: 160px;
	padding: 5px 9px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--panel);
	color: var(--text);
	font: inherit;
}

.pandoc-paste-name input:focus {
	outline: 2px solid var(--accent-soft);
	border-color: var(--accent);
}
`
