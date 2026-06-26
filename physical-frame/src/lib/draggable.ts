/**
 * Minimal pointer-drag helper for a floating panel. Returns props to spread on
 * the drag-handle element. Position is reported in CSS pixels relative to the
 * offset parent (the host root). Persistence is up to the caller via onChange.
 *
 * Never stops propagation on click (Solid delegates clicks to document); we only
 * use pointer events.
 */

export type Position = { left: number; top: number };

export function makeDraggable(opts: {
  getPosition: () => Position | null | undefined;
  onChange: (pos: Position) => void;
}) {
  const onPointerDown = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    const panel = handle.closest(".sph-panel") as HTMLElement | null;
    if (!panel) return;
    const parent = (panel.offsetParent as HTMLElement) ?? document.body;
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    // Pointer offset within the panel.
    const offsetX = event.clientX - panelRect.left;
    const offsetY = event.clientY - panelRect.top;

    const onMove = (move: PointerEvent) => {
      let left = move.clientX - parentRect.left - offsetX;
      let top = move.clientY - parentRect.top - offsetY;
      left = Math.max(0, Math.min(left, parentRect.width - panelRect.width));
      top = Math.max(0, Math.min(top, parentRect.height - panelRect.height));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = "auto";
      panel.dataset.dragLeft = String(left);
      panel.dataset.dragTop = String(top);
    };

    const onUp = (up: PointerEvent) => {
      handle.releasePointerCapture(up.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      const left = Number(panel.dataset.dragLeft);
      const top = Number(panel.dataset.dragTop);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        opts.onChange({ left, top });
      }
    };

    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  };

  return { onPointerDown };
}
