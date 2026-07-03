// DORMANT 2026-07-02 — nothing registers a sketchy:flap and the canvas no
// longer mounts the FlapDock (its edge-tab CSS is gone too). Flaps return as
// "a named STICKY container window a user places" once the container + sticky
// work matures (see TODO.md); the source stays on disk like grid-tool.jsx.
//
// FLAPS — Squeak-style named tabs docked to the screen edges (bottom/left/right).
// A tab sticks out of its edge; a CLICK (or a pull on its own edge) opens the
// flap as a drawer; DRAG the tab to another edge to re-dock it. Flap definitions
// are a REGISTRY (`sketchy:flap`, same shape as sketchy:layout / sketchy:brush):
//
//   { type: "sketchy:flap", id, name, icon?, edge?,          // default edge
//     async load() -> mount }                                // mount({ element, host }) => cleanup
//
// The mount gets a plain DOM element + the canvas chrome host (registry
// accessors, place commands, context) — flap CONTENT is raw DOM (no Solid);
// only this container (canvas-shell chrome) is a Solid component. Per-VIEWER
// state (edge + open, per flap) lives in the top-layer user-state doc
// (`flaps[id]`), the same place brushCfg/chrome overrides live — it persists +
// syncs across your devices without touching the shared sketch.
import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { log } from "./log.js";

export const FLAP_EDGES = ["bottom", "left", "right"]; // no top flaps (the layer tabs live there)

// registered flap descriptors (defensive: no host registry ⇒ [])
export function listFlaps() {
  try {
    const r = getRegistry("sketchy:flap");
    if (!r) return [];
    if (typeof r.filter === "function") return r.filter(() => true);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// resolve a flap's per-viewer state (top-layer `flaps[id]`) over its descriptor
// default. Pure: { edge, open }.
export function resolveFlapState(state, descriptor) {
  const want = state && state.edge;
  const def = descriptor && descriptor.edge;
  const edge = FLAP_EDGES.includes(want) ? want : FLAP_EDGES.includes(def) ? def : "bottom";
  return { edge, open: !!(state && state.open) };
}

// which edge a dragged tab lands on — the nearest of left/right/bottom. Pure.
export function nearestEdge(x, y, w, h) {
  const d = { left: x, right: w - x, bottom: h - y };
  return Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
}

// The flap container — mounted from the canvas's chrome area (gated + slottable
// like toolbar/properties). Props (don't destructure):
//   host      — the chrome host (handed on to each flap's mount)
//   state(id) — the flap's persisted per-viewer state (reactive: top-layer doc)
//   setState(id, patch) — write per-viewer state (edge/open)
//   viewport() — the canvas viewport element (for edge maths on re-dock)
export function FlapDock(props) {
  const flaps = listFlaps();
  const st = (f) => resolveFlapState(props.state(f.id), f);
  const [dragging, setDragging] = createSignal(null);
  const byEdge = (edge) => flaps.filter((f) => st(f).edge === edge);
  const viewportSize = () => {
    const vp = props.viewport && props.viewport();
    return {
      w: (vp && vp.offsetWidth) || window.innerWidth || 0,
      h: (vp && vp.offsetHeight) || window.innerHeight || 0,
    };
  };
  const onTabDown = (f) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // pointerdown only — never a click (Solid delegates those)
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const mv = (ev) => { if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { moved = true; setDragging(f.id); } };
    const up = (ev) => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      setDragging(null);
      const s = st(f);
      if (moved) {
        const { w, h } = viewportSize();
        const edge = nearestEdge(ev.clientX, ev.clientY, w, h);
        if (edge !== s.edge) props.setState(f.id, { edge }); // re-dock (open state rides along)
        else props.setState(f.id, { open: !s.open });        // a pull on its own edge = open/close
      } else props.setState(f.id, { open: !s.open });        // click toggles the drawer
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  return (
    <Show when={flaps.length}>
      <For each={FLAP_EDGES}>{(edge) => (
        <Show when={byEdge(edge).length}>
          <div class={"ns-flaps ns-flaps-" + edge} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <For each={byEdge(edge)}>{(f) => (
              <div class="ns-flap" classList={{ open: st(f).open, dragging: dragging() === f.id }}>
                <Show when={st(f).open}>
                  <FlapBody f={f} host={props.host} />
                </Show>
                <button
                  class="ns-flap-tab"
                  title={`${f.name || f.id} — click to open · drag to another edge`}
                  onPointerDown={onTabDown(f)}
                >{f.name || f.id}</button>
              </div>
            )}</For>
          </div>
        </Show>
      )}</For>
    </Show>
  );
}

// the drawer body: load the flap's mount lazily on first open, clean up on close
function FlapBody(props) {
  let ref;
  onMount(() => {
    let cleanup, gone = false;
    Promise.resolve(props.f.load ? props.f.load() : props.f.mount)
      .then((m) => {
        if (gone || typeof m !== "function") return;
        cleanup = m({ element: ref, host: props.host });
      })
      .catch((e) => log.warn("flap", props.f.id, e));
    onCleanup(() => { gone = true; if (typeof cleanup === "function") cleanup(); });
  });
  return <div class="ns-flap-drawer" ref={ref} />;
}
