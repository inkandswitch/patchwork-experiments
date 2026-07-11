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

/* Indicator: a dashed outline marks every augmentable view ("here's a tool").
   Drawn inside the box via a negative outline-offset so it never shifts layout. */
.pw-udnd-overlay {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  outline: 0 dashed rgb(99 102 241 / 0);
  outline-offset: -2px;
  transition: outline-color 0.14s ease, background-color 0.14s ease;
}
html.pw-udnd-active .pw-udnd-overlay {
  outline-width: 1.5px;
  outline-color: rgb(99 102 241 / 0.55);
}
/* Firm the indicator up while the view is hovered. */
html.pw-udnd-active .pw-udnd-hover .pw-udnd-overlay {
  outline-color: rgb(79 70 229 / 0.9);
  background: rgb(99 102 241 / 0.04);
}

/* Corner control cluster: holds the drag handle + copy button. Hidden until
   the view is hovered — the dashed outline is the resting-state indicator. */
.pw-udnd-corner {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 9px;
  background: rgb(255 255 255 / 0.9);
  border: 1px solid rgb(15 23 42 / 0.08);
  box-shadow: 0 4px 12px rgb(15 23 42 / 0.14), 0 1px 2px rgb(15 23 42 / 0.1);
  -webkit-backdrop-filter: blur(8px) saturate(1.4);
  backdrop-filter: blur(8px) saturate(1.4);
  pointer-events: none;
  opacity: 0;
  transform: translateY(-3px) scale(0.94);
  transform-origin: top left;
  transition: opacity 0.12s ease, transform 0.12s ease;
}
html.pw-udnd-active .pw-udnd-hover .pw-udnd-corner {
  pointer-events: auto;
  opacity: 1;
  transform: none;
}

/* Individual control buttons. */
.pw-udnd-btn {
  appearance: none;
  -webkit-appearance: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgb(51 65 85);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: background-color 0.1s ease, color 0.1s ease, transform 0.08s ease;
}
.pw-udnd-btn:hover {
  background: rgb(99 102 241 / 0.12);
  color: rgb(67 56 202);
}
.pw-udnd-btn:active {
  transform: scale(0.9);
}
.pw-udnd-btn svg {
  width: 15px;
  height: 15px;
  display: block;
}
.pw-udnd-btn--drag {
  cursor: grab;
}
.pw-udnd-btn--drag:active,
.pw-udnd-btn--dragging {
  cursor: grabbing;
}
.pw-udnd-btn--copied,
.pw-udnd-btn--copied:hover {
  color: rgb(22 163 74);
  background: rgb(22 163 74 / 0.14);
}

/* Toolbar button (the mounted tray / doctitle control). */
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
  .pw-udnd-corner,
  .pw-udnd-btn {
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
