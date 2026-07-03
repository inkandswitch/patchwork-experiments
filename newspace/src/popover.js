// POPOVER — portal a bare window's menu OUT of its item box, to the canvas root.
//
// A bare window's body (.ns-doc-body) clips (overflow: hidden) and its item div
// is its own stacking context, so a popover positioned inside the widget is cut
// off at the item's edge and can be buried under later siblings. The fix is the
// same shape as the canvas's own world-anchored popups (the chooser / node
// menu): render the popover as a child of `.ns-root` with a fixed backdrop, and
// position it from the anchor's rect — opening AWAY from whichever viewport
// edge the window is docked to, clamped so it never leaves the canvas.
//
// placePopover is the pure math (unit-tested); openPopover owns the DOM.

// anchor/size/viewport are rects in ROOT-LOCAL px. Prefer opening ABOVE the
// anchor (the palette's traditional direction); flip BELOW when the top edge is
// too close (a top-docked window); clamp horizontally within the viewport.
export function placePopover(anchor, size, viewport, margin = 6) {
  const up = anchor.y - margin - size.h >= 0;
  const y = up
    ? anchor.y - margin - size.h
    : Math.max(0, Math.min(anchor.y + anchor.h + margin, viewport.h - size.h - margin));
  const x = Math.max(margin, Math.min(anchor.x + anchor.w / 2 - size.w / 2, viewport.w - size.w - margin));
  return { x, y, up };
}

// Portal `menu` next to `anchor`. Returns close() — removes the popover WITHOUT
// firing onClose (the caller's programmatic dismiss). The backdrop's own
// pointerdown closes AND fires onClose (the user clicked away).
export function openPopover({ anchor, menu, onClose, margin = 6 }) {
  const root = (anchor.closest && anchor.closest(".ns-root")) || document.body;
  const backdrop = document.createElement("div");
  backdrop.className = "ns-menu-backdrop";
  const close = () => { backdrop.remove(); menu.remove(); };
  // pointerDOWN only (the house rule) — and stopped, so closing a menu never
  // starts a marquee/draw on the canvas underneath (the old in-widget backdrop
  // was behind the widget's own stopPropagation; portal'd, it must stop itself).
  backdrop.addEventListener("pointerdown", (e) => { e.stopPropagation(); close(); if (onClose) onClose(); });
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  // neutralize any in-widget positioning the menu's class carries (.ns-menu-grid's
  // bottom/left/transform, .ns-presence-menu's right) — the portal owns placement
  menu.style.position = "absolute";
  menu.style.bottom = "auto";
  menu.style.right = "auto";
  menu.style.transform = "none";
  root.append(backdrop, menu);
  const rr = root.getBoundingClientRect ? root.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const ar = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const p = placePopover(
    { x: ar.left - rr.left, y: ar.top - rr.top, w: ar.width, h: ar.height },
    { w: menu.offsetWidth || 0, h: menu.offsetHeight || 0 },
    { w: rr.width || window.innerWidth || 0, h: rr.height || window.innerHeight || 0 },
    margin,
  );
  menu.style.left = `${p.x}px`;
  menu.style.top = `${p.y}px`;
  return close;
}
