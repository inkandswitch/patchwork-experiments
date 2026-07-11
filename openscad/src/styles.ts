export const styles = `
@layer package {
  :root,
  :host,
  [theme] {
    --openscad-bg: var(--editor-fill, #fff);
    --openscad-fg: var(--editor-line, #000);
    --openscad-muted: var(--editor-line-offset-50, #888);
    --openscad-border: var(--editor-fill-offset-20, #ddd);
    --openscad-panel: color-mix(in oklch, var(--editor-fill), var(--editor-line) 3%);
    --openscad-accent: var(--studio-primary, #35f7ca);
    --openscad-accent-fill: var(--studio-primary-fill, var(--studio-primary, #35f7ca));
    --openscad-accent-line: var(--studio-primary-line, #04211c);
    --openscad-danger: var(--studio-danger, #e5484d);
    --openscad-danger-bg: color-mix(in oklch, var(--studio-danger, #e5484d), var(--editor-fill) 88%);
    --openscad-family-sans: var(--editor-family-sans, system-ui, sans-serif);
    --openscad-family-code: var(--editor-family-code, ui-monospace, monospace);
  }
}

.openscad-tool {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--openscad-bg);
  color: var(--openscad-fg);
  font-family: var(--openscad-family-sans);
  font-size: 13px;
}

.openscad-tool *,
.openscad-tool *::before,
.openscad-tool *::after {
  box-sizing: border-box;
}

.openscad-toolbar {
  display: flex;
  align-items: center;
  gap: var(--studio-space-sm, 0.5rem);
  padding: var(--studio-space-xs, 0.375rem) var(--studio-space-sm, 0.5rem);
  border-bottom: 1px solid var(--openscad-border);
  flex-shrink: 0;
}

.openscad-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border: 1px solid var(--openscad-border);
  background: var(--openscad-panel);
  color: var(--openscad-fg);
  border-radius: var(--studio-radius-sm, 4px);
  padding: 0.35em 0.75em;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: var(--studio-transition-fast, 0.1s ease);
}

.openscad-btn:hover {
  background: color-mix(in oklch, var(--openscad-panel), var(--openscad-fg) 6%);
}

.openscad-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.openscad-btn.primary {
  background: var(--openscad-accent-fill);
  color: var(--openscad-accent-line);
  border-color: var(--openscad-accent-fill);
}

.openscad-btn.primary:hover {
  background: color-mix(in oklch, var(--openscad-accent-fill), var(--openscad-fg) 10%);
}

.openscad-toolbar-spacer {
  flex: 1;
}

.openscad-imports-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--studio-space-xs, 0.375rem);
  padding: var(--studio-space-xs, 0.375rem) var(--studio-space-sm, 0.5rem);
  border-bottom: 1px dashed var(--openscad-border);
  flex-shrink: 0;
  transition: var(--studio-transition-fast, 0.1s ease);
}

.openscad-imports-bar[data-drop-active] {
  background: color-mix(in oklch, var(--openscad-accent-fill), var(--openscad-bg) 85%);
  border-bottom-color: var(--openscad-accent);
}

.openscad-imports-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--openscad-muted);
  flex-shrink: 0;
}

.openscad-imports-placeholder {
  font-size: 11.5px;
  color: var(--openscad-muted);
}

.openscad-imports-placeholder code {
  font-family: var(--openscad-family-code);
  background: var(--openscad-panel);
  border-radius: 3px;
  padding: 0.1em 0.3em;
}

.openscad-import-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  background: var(--openscad-panel);
  border: 1px solid var(--openscad-border);
  border-radius: var(--studio-radius-sm, 4px);
  padding: 0.15em 0.3em 0.15em 0.55em;
  font-size: 12px;
}

.openscad-import-name {
  border: none;
  background: none;
  color: var(--openscad-accent-line, inherit);
  font-family: var(--openscad-family-code);
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.openscad-import-rename {
  font-family: var(--openscad-family-code);
  font-size: 12px;
  border: 1px solid var(--openscad-accent);
  border-radius: 3px;
  padding: 0 0.25em;
  width: 8em;
  background: var(--openscad-bg);
  color: var(--openscad-fg);
}

.openscad-import-source {
  color: var(--openscad-muted);
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.openscad-import-remove {
  border: none;
  background: none;
  color: var(--openscad-muted);
  cursor: pointer;
  padding: 0 0.15em;
  font-size: 13px;
  line-height: 1;
}

.openscad-import-remove:hover {
  color: var(--openscad-danger);
}

.openscad-status {
  color: var(--openscad-muted);
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 0.4em;
  white-space: nowrap;
}

.openscad-status.error {
  color: var(--openscad-danger);
}

.openscad-spinner {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid color-mix(in oklch, var(--openscad-muted), transparent 60%);
  border-top-color: var(--openscad-accent);
  animation: openscad-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes openscad-spin {
  to { transform: rotate(360deg); }
}

.openscad-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.openscad-pane-editor {
  width: 45%;
  min-width: 220px;
  border-right: 1px solid var(--openscad-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.openscad-editor-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.openscad-pane-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.openscad-view-stage {
  flex: 1;
  min-height: 0;
  position: relative;
}

.openscad-viewer-canvas {
  position: absolute;
  inset: 0;
  background: var(--openscad-panel);
}

.openscad-viewer-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.openscad-viewer-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--openscad-muted);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
  padding: 1rem;
}

.openscad-console {
  flex-shrink: 0;
  max-height: 30%;
  overflow: auto;
  border-top: 1px solid var(--openscad-border);
  background: var(--openscad-panel);
}

.openscad-console[data-empty] {
  display: none;
}

.openscad-console pre {
  margin: 0;
  padding: var(--studio-space-sm, 0.5rem);
  font-family: var(--openscad-family-code);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.openscad-console[data-state="error"] pre {
  color: var(--openscad-danger);
}
`
