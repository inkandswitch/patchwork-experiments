let injected = false;

const CSS = /* css */ `
.pw-udnd-layers-root,
.pw-udnd-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.pw-udnd-layers-root {
  z-index: 2147483000;
}

/* Whole-view "grabbable" affordance: a soft accent ring that fades in. */
.pw-udnd-overlay {
  position: absolute;
  inset: 0;
  border-radius: 10px;
  background: transparent;
  box-shadow: inset 0 0 0 0 rgb(99 102 241 / 0);
  transition: box-shadow 0.14s ease, background-color 0.14s ease;
}
html.pw-udnd-active .pw-udnd-overlay {
  background: rgb(99 102 241 / 0.05);
  box-shadow: inset 0 0 0 1.5px rgb(99 102 241 / 0.5);
}

/* The grip. */
.pw-udnd-handle {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: #fff;
  border-radius: 7px;
  background: rgb(79 70 229 / 0.92);
  border: 1px solid rgb(255 255 255 / 0.18);
  box-shadow: 0 2px 6px rgb(15 23 42 / 0.35), 0 0 0 1px rgb(79 70 229 / 0.25);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  cursor: grab;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  opacity: 0;
  transform: translateY(-2px) scale(0.85);
  transition: opacity 0.14s ease, transform 0.14s ease, background-color 0.1s ease;
}
html.pw-udnd-active .pw-udnd-handle {
  opacity: 1;
  transform: none;
}
.pw-udnd-handle:hover {
  background: rgb(67 56 202 / 0.96);
}
.pw-udnd-handle:active,
.pw-udnd-handle--dragging {
  cursor: grabbing;
  transform: scale(0.94);
}
.pw-udnd-handle svg {
  width: 12px;
  height: 12px;
  display: block;
  opacity: 0.95;
}

/* Floating status badge (frame-agnostic affordance). */
.pw-udnd-badge {
  position: fixed;
  bottom: 14px;
  right: 14px;
  z-index: 2147483600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 9px;
  border-radius: 999px;
  font: 500 12px/1 system-ui, -apple-system, sans-serif;
  color: rgb(226 232 240);
  background: rgb(15 23 42 / 0.72);
  border: 1px solid rgb(148 163 184 / 0.22);
  box-shadow: 0 4px 16px rgb(2 6 23 / 0.28);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  backdrop-filter: blur(10px) saturate(1.2);
  cursor: pointer;
  user-select: none;
  opacity: 0.5;
  transition: opacity 0.14s ease, border-color 0.14s ease;
}
.pw-udnd-badge:hover {
  opacity: 1;
}
.pw-udnd-badge[data-active="true"] {
  opacity: 1;
  border-color: rgb(129 140 248 / 0.5);
}
.pw-udnd-badge__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(100 116 139 / 0.85);
  transition: background-color 0.14s ease, box-shadow 0.2s ease;
}
.pw-udnd-badge[data-active="true"] .pw-udnd-badge__dot {
  background: rgb(129 140 248);
  box-shadow: 0 0 0 3px rgb(129 140 248 / 0.25);
}
.pw-udnd-badge__keys {
  display: inline-flex;
  gap: 3px;
}
.pw-udnd-badge kbd {
  font: 600 10px/1 ui-monospace, "SF Mono", Menlo, monospace;
  color: rgb(203 213 225);
  background: rgb(51 65 85 / 0.7);
  border: 1px solid rgb(148 163 184 / 0.25);
  border-radius: 4px;
  padding: 3px 4px;
  min-width: 14px;
  text-align: center;
}
.pw-udnd-badge__pinned {
  display: none;
  opacity: 0.8;
}
.pw-udnd-badge[data-pinned="true"] .pw-udnd-badge__pinned {
  display: inline;
}

/* Toolbar button (when the frame surfaces the tool). */
.pw-udnd-toolbar-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 8px;
  border: 0;
  background: transparent;
  font: 500 12px/1 system-ui, sans-serif;
  color: var(--color-text-secondary, #667085);
  border-radius: 6px;
  cursor: pointer;
}
.pw-udnd-toolbar-button:hover {
  background: rgb(99 102 241 / 0.1);
}
.pw-udnd-toolbar-button[aria-pressed="true"] {
  color: rgb(79 70 229);
}

@media (prefers-reduced-motion: reduce) {
  .pw-udnd-overlay,
  .pw-udnd-handle,
  .pw-udnd-badge,
  .pw-udnd-badge__dot {
    transition: none;
  }
}
`;

export function injectStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.setAttribute("data-pw-universal-dnd", "");
  style.textContent = CSS;
  document.head.appendChild(style);
}
