// Pointer capture and pressure sampling for host-provided 3D and surface picking.
export function createDrawingInput(element, { brush, project, commit, preview } = {}) {
  if (typeof brush !== 'function' || typeof project !== 'function' || typeof commit !== 'function')
    throw new TypeError('Drawing input needs brush, project and commit callbacks');
  let active;
  const pointCount = mark => mark.kind === 'fill' ? 3 : 1;
  function draft({ mark, points, pressure }) {
    const copy = points.map(p => p.slice());
    return mark.kind === 'fill' ? { ...mark, rings: [copy] } : { ...mark, points: copy, pressure: pressure.slice() };
  }

  function collect(event, ending = false) {
    const { points, pressure, mark } = active;
    const point = project(event, mark);
    if (point == null) return;
    const n = mark.surface || mark.kind === 'fill' ? 2 : 3;
    if (!Array.isArray(point) || point.length !== n || !point.every(Number.isFinite))
      throw new TypeError('Drawing projection must return a finite ' + n + 'D point or null');
    const force = event.pointerType === 'pen' ?
      (ending ? pressure.at(-1) : Math.min(1, Math.max(0, event.pressure))) : 1;
    if (points.at(-1)?.every((v, i) => v === point[i])) {
      if (!ending && mark.kind === 'stroke') pressure[pressure.length - 1] = Math.max(force, pressure.at(-1));
      return;
    }
    points.push(point.slice());
    pressure.push(force);
  }

  function down(event) {
    if (active || event.button !== 0) return;
    const mark = brush(event);
    if (mark == null) return;
    if (mark.kind !== 'stroke' && mark.kind !== 'fill') throw new TypeError('Drawing brush needs kind stroke or fill');
    active = { id: event.pointerId, mark: { ...mark }, points: [], pressure: [] };
    try {
      collect(event);
      if (!active.points.length) {
        active = undefined;
        return;
      }
      element.setPointerCapture(event.pointerId);
    } catch (error) {
      active = undefined;
      throw error;
    }
    event.preventDefault();
    preview?.(draft(active));
  }

  function move(event) {
    if (active?.id !== event.pointerId) return;
    for (const sample of event.getCoalescedEvents?.() || []) collect(sample);
    collect(event);
    event.preventDefault();
    preview?.(draft(active));
  }

  function finish(event, keep) {
    if (!active || event && event.pointerId !== active.id) return;
    const drawing = active;
    try {
      if (keep) collect(event, true);
    } finally {
      active = undefined;
      if (element.hasPointerCapture(drawing.id)) element.releasePointerCapture(drawing.id);
      preview?.(null);
    }
    if (keep && drawing.points.length >= pointCount(drawing.mark)) commit(draft(drawing));
  }

  const up = event => finish(event, true);
  const cancel = event => finish(event, false);
  const handlers = {
    pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel
  };
  for (const [type, handler] of Object.entries(handlers)) element.addEventListener(type, handler);
  return {
    cancel: () => finish(undefined, false),
    dispose() {
      for (const [type, handler] of Object.entries(handlers)) element.removeEventListener(type, handler);
      finish(undefined, false);
    }
  };
}
