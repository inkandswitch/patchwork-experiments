import { getUniversalDnd } from "./app.js";
import { injectStyles } from "./styles.js";

let badge: HTMLElement | null = null;

/**
 * A frame-agnostic, always-visible affordance so the prototype is obviously
 * "installed" regardless of whether the host frame surfaces toolbar tools.
 * Click to pin/unpin the reveal; it also mirrors the transient Shift+Alt state.
 */
export function mountBadge(): void {
  if (badge || typeof document === "undefined") return;
  injectStyles();
  const app = getUniversalDnd();

  badge = document.createElement("div");
  badge.className = "pw-udnd-badge";
  badge.title = "Hold Shift+Alt to reveal drag handles. Click to pin.";
  badge.innerHTML = /* html */ `
    <span class="pw-udnd-badge__dot"></span>
    <span>Drag views</span>
    <span class="pw-udnd-badge__keys"><kbd>\u21e7</kbd><kbd>\u2325</kbd></span>
    <span class="pw-udnd-badge__pinned">\u00b7 pinned</span>
  `;
  badge.addEventListener("click", () => app.togglePinned());

  const render = () => {
    if (!badge) return;
    badge.dataset.active = String(app.active);
    badge.dataset.pinned = String(app.pinned);
  };
  app.onChange(render);
  render();

  const attach = () => document.body.appendChild(badge!);
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
}
