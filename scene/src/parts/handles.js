// scene.handles: a provider's build params, dragged in place.
//
// A `scene:source` plugin can declare handles beside its params
// (`handles: [{ param, axis, label? }]`, see ../handles.js). For the selected
// object, when its provider declares some, this part draws each as a knob on
// a track along its axis through the middle of the object, with a
// "label: value" tag. Dragging a knob moves it along the track (the pointer
// ray's closest point on the line, held to the param's range and step); letting
// go writes the param to the object's render doc, and the stage rebuilds the
// object from it. A tap on a knob is consumed (it selects nothing).
//
// Hidden while the effective tool is the hand and while any extension is armed
// (measuring, say). Ported from the old viewport.js (setHandles … wireHandles)
// and tool.js (updateHandles, onHandleEnd).
//
// Reads local.selected, local.tool (via the doc's view defaults), local.armed
// and local.theme. Writes only the render doc's params.

import css from "./handles.css?inline";
import { handleSpecs, handleBase, closestOnLine, clampValue } from "../handles.js";
import { applyMatrix } from "../transform.js";
import { roundForDisplay } from "../units.js";
import { effectiveTool } from "../current-tool.js";

export { effectiveTool };

/** How close (port px) the pointer must be to a knob to grab it. */
export const GRAB_PX = 12;

// ─── pure helpers (exported for tests) ──────────────────────────────────────

/** The provider (scene:source metadata) an object was built by, or null. */
export function providerOf(sources, providerId) {
  if (!sources || !providerId) return null;
  try {
    return sources.filter?.((p) => p?.id === providerId)?.[0] ?? null;
  } catch {
    return null;
  }
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const along = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];

/**
 * A handle's line in world space: where its param is 0 (`base`) and one unit
 * of it (`unit`), plus the object's size in the world (its box's diagonal,
 * scaled). null without a box or matrix.
 * @param {{ axis: number[] }} spec
 * @param {number[]} matrix  the object's world matrix (16, column-major)
 * @param {{ min: number[], max: number[] }} box  its content's box in its own frame
 */
export function handleLine(spec, matrix, box) {
  if (!Array.isArray(matrix) || matrix.length < 16 || !box?.min || !box?.max) return null;
  const center = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  const local = handleBase(center, spec.axis);
  const base = applyMatrix(matrix, local);
  const unit = sub3(applyMatrix(matrix, along(local, spec.axis, 1)), base);
  const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const scale = Math.hypot(matrix[0], matrix[1], matrix[2]);
  return { base, unit, size: diag * scale };
}

/**
 * Where to draw a handle at `value`: the knob, its track (the param's range,
 * or the object's extent along the axis, around the knob) and the knob's
 * radius. Matches the old viewport's drawHandles.
 */
export function handlePlacement(spec, line, value) {
  const at = along(line.base, line.unit, value);
  const span = line.size / Math.max(1e-9, Math.hypot(...line.unit));
  const lo = spec.min ?? value - span / 2;
  const hi = spec.max ?? value + span / 2;
  const track = [along(line.base, line.unit, Math.max(lo, value - span)), along(line.base, line.unit, Math.min(hi, value + span))];
  return { at, track, radius: Math.max(1e-4, line.size * 0.015) };
}

/** The value a pointer ray `{ origin, dir }` drags a handle to, or null when it runs along the line. */
export function dragValue(spec, line, ray) {
  if (!ray?.origin || !ray?.dir) return null;
  const s = closestOnLine(line.base, line.unit, ray.origin, ray.dir);
  return s == null || !Number.isFinite(s) ? null : clampValue(spec, s);
}

const rgbKey = (c) => (Array.isArray(c) ? c.join(",") : "");

// ─── the part ───────────────────────────────────────────────────────────────

export default {
  create(api) {
    const THREE = api.THREE;
    api.style(css);
    const layer = api.world({ onTop: true });
    layer.name = "handles";
    const labels = api.labels();

    let sources = null; // the scene:source registry
    let offSources = null;
    let sub = null; // { id, url, handle, off }: the selected object's render doc
    let wanted = null; // "id|renderUrl|providerId" being subscribed to
    let token = 0;
    let specs = []; // handleSpecs at the render doc's params
    // A value let go of, shown until the render doc says something new about it
    // (our own write echoing back, or a peer's): key → { value, was }.
    const pending = new Map();
    let drag = null; // { key, value } while dragging
    let drawn = null; // the key of what's drawn, so a redraw happens only when it changes
    let placed = []; // [{ spec, line, at }] as drawn, for widgetAt and the drag

    const dead = () => api.signal.aborted;

    api
      .registry("scene:source")
      .then((reg) => {
        if (dead() || !reg) return;
        sources = reg;
        const off = reg.on?.("changed", () => {
          wanted = null; // the provider (and its handles) may have changed
          refresh();
        });
        if (typeof off === "function") offSources = off;
        refresh();
      })
      .catch(() => {});

    const valueOf = (spec) => (drag?.key === spec.key ? drag.value : pending.has(spec.key) ? pending.get(spec.key).value : spec.value);

    // ─── which object, which render doc ───────────────────────────────────

    /** The selected object, if it's one with a provider that declares handles: { id, o, provider }. */
    function target() {
      const local = api.local.get();
      const id = local.selected ?? null;
      const o = id ? api.doc()?.objects?.[id] : null;
      if (!o || o.kind === "group" || !o.renderUrl || !o.providerId) return null;
      const provider = providerOf(sources, o.providerId);
      if (!provider?.handles?.length) return null;
      return { id, o, provider };
    }

    function unsubscribe() {
      sub?.off();
      sub = null;
      specs = [];
      pending.clear();
      drag = null;
    }

    /** Follow the selected object's render doc (async: repo.find). */
    function resubscribe(t) {
      const want = t ? `${t.id}|${t.o.renderUrl}|${t.o.providerId}` : null;
      if (want === wanted) return;
      wanted = want;
      const mine = ++token;
      if (sub && (!t || sub.id !== t.id || sub.url !== t.o.renderUrl)) unsubscribe();
      if (!t) return;
      if (sub) return void push(); // same doc, new provider metadata
      Promise.resolve()
        .then(() => api.repo.find(t.o.renderUrl))
        .then((handle) => {
          if (dead() || mine !== token || !handle) return;
          const on = () => {
            push();
            draw();
          };
          handle.on("change", on);
          sub = { id: t.id, url: t.o.renderUrl, handle, off: () => handle.off("change", on) };
          push();
          draw();
        })
        .catch(() => {
          if (mine === token) wanted = null; // try again on the next update
        });
    }

    /** Specs from the provider and the render doc's params; pending values the doc has moved on from go. */
    function push() {
      const t = target();
      if (!sub || !t || t.id !== sub.id) {
        specs = [];
        return;
      }
      const params = sub.handle.doc?.()?.params ?? {};
      specs = handleSpecs(t.provider, params);
      for (const [key, p] of [...pending]) {
        const spec = specs.find((s) => s.key === key);
        if (!spec || spec.value !== p.was) pending.delete(key);
      }
    }

    // ─── drawing ──────────────────────────────────────────────────────────

    /** Is anything else in charge of the pointer (the hand, an armed tool)? */
    function standingDown() {
      const local = api.local.get();
      if (local.armed != null && local.armed !== api.id) return true;
      return effectiveTool(local, api.doc()) === "hand";
    }

    /** Each spec's world line, while the object is shown and has its content. */
    function lines() {
      if (!sub || !specs.length || standingDown()) return [];
      const c = api.content(sub.id);
      if (!c?.loaded || !c.box || !api.box(sub.id)) return [];
      const m = api.worldOf(sub.id);
      const out = [];
      for (const spec of specs) {
        const line = handleLine(spec, m, c.box);
        if (line) out.push({ spec, line });
      }
      return out;
    }

    function clearDrawing() {
      for (const c of [...layer.children]) {
        c.removeFromParent();
        c.traverse?.((o) => {
          o.geometry?.dispose?.();
          o.material?.dispose?.();
        });
      }
    }

    /** Redraw when what would be drawn changed (cheap otherwise). */
    function draw() {
      if (dead()) return;
      const ls = lines();
      const accent = api.local.get().theme?.accent ?? [0.2, 0.97, 0.79];
      const key = ls.length ? JSON.stringify([rgbKey(accent), ls.map(({ spec, line }) => [spec.key, spec.label, valueOf(spec), line])]) : "";
      if (key === drawn) return;
      drawn = key;
      clearDrawing();
      placed = [];
      const items = [];
      if (ls.length) {
        const color = new THREE.Color().setRGB(accent[0], accent[1], accent[2], THREE.SRGBColorSpace);
        for (const { spec, line } of ls) {
          const value = valueOf(spec);
          const { at, track, radius } = handlePlacement(spec, line, value);
          const g = new THREE.Group();
          g.name = `handle:${spec.key}`;
          g.userData.key = spec.key;
          const trackLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(track.map((p) => new THREE.Vector3(...p))),
            new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.5 }),
          );
          trackLine.userData.noPick = true;
          const knob = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
          knob.position.set(...at);
          for (const o of [trackLine, knob]) {
            o.renderOrder = 13;
            g.add(o);
          }
          layer.add(g);
          placed.push({ spec, line, at });
          items.push({ key: spec.key, position: at, text: `${spec.label}: ${roundForDisplay(value, 4)}`, className: "handle-label" });
        }
      }
      labels.set(items);
      api.invalidate();
    }

    // an object moved by a held pose (a gizmo or hand drag) moves its handles
    // too: nothing else tells us, so look after each frame (cheap when nothing moved)
    api.afterRender(() => {
      if (sub && specs.length) draw();
    });

    function refresh() {
      if (dead()) return;
      resubscribe(target());
      push();
      draw();
    }

    // ─── input ────────────────────────────────────────────────────────────

    /** The knob within GRAB_PX of the pointer (the nearest), or null. */
    function knobAt(ev) {
      if (ev?.x == null || ev?.y == null || !placed.length || standingDown()) return null;
      let best = null;
      for (const p of placed) {
        const s = api.project(p.at);
        if (!s || s.visible === false) continue;
        const d = Math.hypot(s.x - ev.x, s.y - ev.y);
        if (d <= GRAB_PX && (!best || d < best.d)) best = { p, d };
      }
      return best?.p ?? null;
    }

    /** The spec of the knob this event is on, if the widget under it is ours. */
    function grabbed(ev) {
      const w = ev.widget;
      if (!w || w.owner !== api.id) return null;
      const key = w.key ?? w.userData?.key;
      return placed.find((p) => p.spec.key === key)?.spec ?? null;
    }

    function commit(spec, value) {
      const s = sub;
      if (!s || value == null) return;
      pending.set(spec.key, { value, was: spec.value });
      s.handle.change((d) => {
        if (!d.params) d.params = {};
        d.params[spec.key] = value;
      });
    }

    const input = {
      // a knob within reach of the pointer: ours, on top of everything (the
      // meshes are widgets too, but a 12 px reach is kinder than a tiny sphere)
      widgetAt(ev) {
        const p = knobAt(ev);
        return p ? { onTop: true, key: p.spec.key } : null;
      },
      cursor(ev) {
        return grabbed(ev) ? "grab" : null;
      },
      press(ev) {
        if (ev.button !== 0) return null;
        const spec = grabbed(ev);
        if (!spec) return null;
        drag = { key: spec.key, value: valueOf(spec) };
        const end = () => {
          drag = null;
          draw();
        };
        return {
          cursor: "grabbing",
          move(e) {
            const line = lines().find((l) => l.spec.key === spec.key)?.line;
            const v = line ? dragValue(spec, line, e.ray) : null;
            if (v == null || !drag) return;
            drag = { key: spec.key, value: v };
            draw();
          },
          end() {
            const value = drag?.value;
            const cur = specs.find((s) => s.key === spec.key) ?? spec;
            const shown = pending.get(cur.key)?.value ?? cur.value;
            if (value != null && value !== shown) commit(cur, value);
            end();
          },
          tap() {
            end();
            return true; // a knob tapped is ours: nothing else hears it
          },
          cancel: end,
        };
      },
    };

    return {
      input,
      update(scene, local, prev) {
        const pl = prev?.local;
        // only the hover (or something else we don't read) changed: nothing to do.
        // (status: an object's content arriving moves where its handles go)
        if (pl && pl !== local && prev.scene === scene && ["selected", "tool", "armed", "theme", "status"].every((k) => pl[k] === local[k])) return;
        // the selection, its object, the provider, the tool, arming, theme, a move or content arriving
        refresh();
      },
      /** The selected object's handles, at the values shown (for probes and tests). */
      handles: () => specs.map((s) => ({ ...s, value: valueOf(s) })),
      dispose() {
        token++;
        sub?.off();
        sub = null;
        offSources?.();
        offSources = null;
      },
    };
  },
};
