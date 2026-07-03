// A constraint sketch item (nodes + rigid bars), drawn with rough.js. Drag a node
// to articulate (relax the rest); drop a node on another to merge them. Extracted
// from tool.jsx; prop-driven (`it`, `ctx`, `b`, `surface`, `baseStyle`, `down`).
import { createSignal, Show, For } from "solid-js";
import { colorVar, windowDrag } from "../constants.js";
import { shapePaths, seedFromId } from "../../draw.js";
import { relax, nodeCopies, barCopies, mergeNodes as mergeSketchNodes } from "../../sketch.js";

export function SketchItem(props) {
  const it = props.it; // already an accessor (Item passes its own `it`)
  const ctx = props.ctx;
  const b = props.b;
  const selectMode = () => ctx.tool() === "select";
  const hittable = () => selectMode() || ctx.tool() === "eraser";
  const nodeOf = (id) => (it().nodes || []).find((n) => n.id === id);
  const [mergeTarget, setMergeTarget] = createSignal(null); // node we'd snap onto on release
  const change = (fn) => props.surface.handle.change((d) => { const s = d.items.find((x) => x.id === it().id); if (s) fn(s); });

  // a bar drawn with rough.js (sketchy), deterministic per bar id
  const barShape = (bar, a, c) => ({
    type: "line", x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y,
    color: ctx.resolveColor(colorVar(it().color)), fill: "none",
    strokeWidth: it().strokeWidth || 2, roughness: it().roughness ?? 1.1, bowing: it().bowing ?? 0.6,
    seed: seedFromId(bar.id || bar.a + bar.b),
  });

  function startNodeDrag(nodeId, e) {
    if (!selectMode()) return;
    e.stopPropagation(); // pointerdown only — safe to stop (tldraw/host marquee); never on click
    ctx.select([it().id]);
    const surface = props.surface;
    const move = (ev) => {
      const w = ctx.toWorld(ev.clientX, ev.clientY);
      // snap radius: ~14 screen px in world units (so it feels constant on screen)
      const tol = Math.abs(ctx.toWorld(ev.clientX + 14, ev.clientY).x - w.x) || 14;
      let target = null, bd = tol;
      for (const n of it().nodes || []) { if (n.id === nodeId) continue; const dd = Math.hypot(n.x - w.x, n.y - w.y); if (dd < bd) { bd = dd; target = n; } }
      setMergeTarget(target ? target.id : null);
      surface.handle.change((d) => {
        const s = d.items.find((x) => x.id === it().id);
        if (!s) return;
        const nodes = nodeCopies(s);
        const dn = nodes.find((n) => n.id === nodeId);
        if (!dn) return;
        // hovering a merge target snaps exactly onto it (clear "they'll coincide")
        dn.x = target ? target.x : w.x; dn.y = target ? target.y : w.y;
        relax(nodes, barCopies(s), new Set([nodeId]));
        for (let i = 0; i < s.nodes.length; i++) { s.nodes[i].x = nodes[i].x; s.nodes[i].y = nodes[i].y; }
      });
    };
    // windowDrag also settles on pointercancel (a cancelled pen/touch must not
    // leave the drag listeners live); a cancelled drop never merges.
    windowDrag(move, (cancelled) => {
      const tgt = mergeTarget();
      setMergeTarget(null);
      if (!cancelled && tgt) mergeNodes(tgt, nodeId); // Crosscut-style: drop one point on another → they coincide
    });
  }
  // SNAP lives in sketch.js (pure, tested); we run it inside a doc change when a
  // node is dropped onto another. Pivots come from auto-welded crossings (the
  // brush) — there are no double-click gestures.
  function mergeNodes(keepId, dropId) { change((s) => mergeSketchNodes(s, keepId, dropId)); }

  return (
    <div class="ns-mark ns-sketch" data-item-id={it().id} style={props.baseStyle()}>
      <svg class="ns-mark-svg" style={{ overflow: "visible" }}>
        <g transform={`translate(${-b().x}, ${-b().y})`}>
          <Show when={selectMode() && ctx.isSelected(it().id)}>
            <rect class="ns-sel-sketch" x={b().x} y={b().y} width={b().w} height={b().h} vector-effect="non-scaling-stroke" />
          </Show>
          <For each={(ctx.themeTick(), it().bars || [])}>{(bar) => {
            const a = nodeOf(bar.a), c = nodeOf(bar.b);
            return (
              <Show when={a && c}>
                {/* the rough.js bar (visual only) */}
                <For each={shapePaths(barShape(bar, a, c))}>
                  {(p) => <path d={p.d} stroke={p.stroke} fill="none" stroke-width={p.strokeWidth} stroke-linecap="round" stroke-linejoin="round" style={{ "pointer-events": "none" }} />}
                </For>
                {/* an invisible fat line for hit-testing (select/move; dbl-click = pivot) */}
                <Show when={hittable()}>
                  <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="transparent" stroke-width={Math.max(14, (it().strokeWidth || 2) + 10)} stroke-linecap="round" style={{ "pointer-events": "stroke", cursor: "move" }} onPointerDown={props.down} />
                </Show>
              </Show>
            );
          }}</For>
          {/* a little circle on every joint — so these read as constraint lines,
              not plain lines. Visible dot + a larger invisible grab target. */}
          <For each={it().nodes || []}>{(n) => (
            <>
              <circle cx={n.x} cy={n.y} r={(it().strokeWidth || 2) + (n.fixed ? 4 : 2.5)}
                class="ns-sketch-node" classList={{ fixed: !!n.fixed, merge: mergeTarget() === n.id }}
                style={{ "pointer-events": "none" }} />
              <Show when={hittable()}>
                <circle cx={n.x} cy={n.y} r={Math.max(9, (it().strokeWidth || 2) + 6)} fill="transparent"
                  style={{ "pointer-events": "auto", cursor: "grab" }}
                  onPointerDown={(e) => startNodeDrag(n.id, e)} />
              </Show>
            </>
          )}</For>
        </g>
      </svg>
    </div>
  );
}
