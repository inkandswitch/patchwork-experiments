// scene.hand: carrying objects like pieces on a table (README, "Hand").
//
// With the hand as the tool, a press on an object that can be carried (not
// locked, not a group, not in a peer's hand) picks it up once the pointer
// has moved a few pixels; a press that doesn't move is still a click (the
// session's tap says no, so the click goes on to selection). While carried
// it follows the pointer over whatever is under it, floating a little above
// where it would land, and a ring on the table shows the spot: accent when
// it will go to a connector (another object's, that takes its tags), muted
// when it will go down where it is. Alt, or the Snap pref off, places
// freely. Q / E turn it 45°, F turns it over (in the air: it rises and
// turns, rather than snapping); Escape puts it back. Every
// running extension's `landing` may ask for it face up where it's going (a
// card carried into your own hand). Put down, it rests on the highest
// surface under its footprint, and only that final pose is written.
//
// Flip (F over a piece, or the menu) turns one over where it lies: it rises,
// turns over in the air and comes back down on whatever is under it, peers
// seeing it turn through the pose hold, and only where it lands is written.
//
// Other extensions can start a carry too: `carry(id, ev, opts)` (collect
// "carry") returns the session to give back from their press.
//
// The maths is ./hand-carry.js (plain arrays): this file is the stage side —
// rays and raycasts, the pose hold peers see, the ring, the doc write.
//
// It all happens in the frame of what the object is attached to (its doc
// parent; the world at the root): a card on a table aboard a ship is carried,
// snapped, turned over and put down on that table as it moves, heels and
// swings, not left behind in the world. The pointer's ray and every raycast
// go through that frame as drawn this frame, "down" is the parent's −Y, the
// snap points are in it, and the ring is drawn from it each frame.
//
// Any running extension may veto a carry: `carryable(id)` returning false
// (collected each time) means the hand neither picks it up nor flips it (a
// ship that's sailing; the things aboard her a game shouldn't move).

import { isGroup } from "../groups.js";
import { createCarry, flipAt, flipInPlace, localTransform, snapCandidates, turnRadius, turning, worldBox } from "./hand-carry.js";
import { applyMatrix, decomposeMatrix, invertMatrix, multiplyMatrices } from "../transform.js";
import { effectiveTool } from "../current-tool.js";

export { effectiveTool };

const TURN = Math.PI / 4;
const TURN_OVER = 0.3; // seconds to turn something over
const RING_SEGMENTS = 48;

/** Can the hand pick this up: there, not a group, not locked? (A peer's hold is checked separately.) */
export function carryableObject(o) {
  return !!o && !isGroup(o) && !o.locked;
}

// ─── a frame: the parent's, as drawn now (null: the world) ─────────────────

const rotateDir = (m, d) => {
  const v = [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

/**
 * Conversions between the world and a frame whose world matrix is `P()`
 * (asked each time: it moves). With no frame (P() null) every one is the
 * identity, so a carry at the root is exactly what it always was.
 */
export function frameConversions(P) {
  const inv = () => {
    const m = P();
    return m ? invertMatrix(m) : null;
  };
  return {
    /** a world matrix in the frame */
    matrixIn: (W) => {
      const i = inv();
      return i ? multiplyMatrices(i, W) : W;
    },
    /** a frame matrix in the world */
    matrixOut: (L) => {
      const m = P();
      return m ? multiplyMatrices(m, L) : L;
    },
    pointIn: (p) => {
      const i = inv();
      return i ? applyMatrix(i, p) : p;
    },
    pointOut: (p) => {
      const m = P();
      return m ? applyMatrix(m, p) : p;
    },
    /** a world ray { origin, dir } in the frame (dir unit) */
    rayIn: (ray) => {
      const i = ray ? inv() : null;
      return i ? { origin: applyMatrix(i, ray.origin), dir: rotateDir(i, ray.dir) } : ray;
    },
    /** a world raycast, asked in the frame: its hit's point comes back in the frame */
    raycastIn: (raycast) => (origin, dir) => {
      const m = P();
      if (!m) return raycast(origin, dir);
      const hit = raycast(applyMatrix(m, origin), rotateDir(m, dir));
      return hit?.point ? { ...hit, point: applyMatrix(invertMatrix(m), hit.point) } : hit;
    },
  };
}

export default {
  create(api) {
    const THREE = api.THREE;
    let open = null; // the open carry's session (one at a time)
    const flipping = new Map(); // id → stop: pieces turning over where they lie
    let layer = null;
    let ring = null;

    const doc = () => api.doc() ?? {};
    const toolNow = () => effectiveTool(api.local.get(), doc());
    /** Does a running extension say this may not be carried (carryable(id) → false)? */
    function vetoed(id) {
      for (const { value } of api.collect("carryable")) {
        if (typeof value !== "function") continue;
        try {
          if (value(id) === false) return true;
        } catch (err) {
          console.warn("[scene.hand] a carryable rule failed", err);
        }
      }
      return false;
    }
    const canCarry = (id) => id != null && carryableObject(doc().objects?.[id]) && api.heldBy(id) == null && !flipping.has(id) && !vetoed(id);

    /** The frame `id` is carried in: its doc parent now, as drawn (null at the root). */
    function frameFor(id) {
      const parentId = api.scene().parents.get(id) ?? null;
      const P = () => (parentId ? (api.worldOf(parentId) ?? api.scene().world(parentId)) : null);
      const f = frameConversions(P);
      // the local transform to hold or write for a matrix in this frame: under its
      // doc parent now (a peer may have re-attached it meanwhile)
      f.pose = (L) => ((api.scene().parents.get(id) ?? null) === parentId ? decomposeMatrix(L) : localNow(id, f.matrixOut(L)));
      f.parentId = parentId;
      f.P = P;
      return f;
    }

    // ─── the ring ───────────────────────────────────────────────────────────

    function showRing(land, frame = null) {
      if (!layer) layer = api.world({ onTop: true });
      if (!ring) {
        const pts = [];
        for (let i = 0; i <= RING_SEGMENTS; i++) {
          const a = (i / RING_SEGMENTS) * Math.PI * 2;
          pts.push(Math.cos(a), 0, Math.sin(a));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        ring = new THREE.Line(g, new THREE.LineBasicMaterial({ depthTest: false, transparent: true }));
        ring.renderOrder = 12;
        ring.userData.noPick = true;
        ring.raycast = () => {};
        layer.add(ring);
      }
      const theme = api.local.get().theme ?? {};
      const rgb = (land.snapped ? theme.accent : theme.muted) ?? (land.snapped ? [0.2, 0.9, 0.75] : [0.5, 0.5, 0.5]);
      ring.material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      ring.position.set(land.spot[0], land.spot[1] + 0.0005, land.spot[2]);
      ring.quaternion.identity();
      ring.scale.setScalar(Math.max(land.radius * 1.1, 1e-4));
      // its spot is in the carried object's frame: lying on that, wherever it is now
      const P = frame?.P?.();
      if (P) {
        ring.updateMatrix();
        ring.matrix.premultiply(new THREE.Matrix4().fromArray(P)).decompose(ring.position, ring.quaternion, ring.scale);
      }
      ring.visible = true;
      api.invalidate();
    }

    function hideRing() {
      if (ring?.visible) {
        ring.visible = false;
        api.invalidate();
      }
    }

    // ─── carrying ───────────────────────────────────────────────────────────

    /** The pointer's ray: the event's, else the stage's at its port point. */
    const rayOf = (ev) => ev?.ray ?? (ev?.x != null && ev?.y != null ? api.ray(ev.x, ev.y) : null);

    /** What it would be put down for: every running extension's landing, the last word winning per field. */
    function landingAt(id, point, hitId) {
      let out = null;
      for (const { value } of api.collect("landing")) {
        if (typeof value !== "function") continue;
        try {
          const l = value(id, point, hitId);
          if (l && typeof l === "object") out = { ...out, ...l };
        } catch (err) {
          console.warn("[scene.hand] a landing rule failed", err);
        }
      }
      return out;
    }

    /** Is `oid` the carried object, or attached under it? (It can't land on itself.) */
    function carriedBy(id) {
      const parents = api.scene().parents;
      return (oid) => {
        for (let p = oid, n = 0; p != null && n < 1000; p = parents.get(p), n++) if (p === id) return true;
        return false;
      };
    }

    // Its pose is local to its doc parent as the doc has it now (a peer may
    // re-attach it while it's carried), by that parent's world as drawn: a
    // ship under sail is held where the sim has it, far from where the doc
    // last saved it, and the piece goes down where it's seen.
    function localNow(id, W) {
      const s = api.scene();
      const parentId = s.parents.get(id) ?? null;
      return localTransform(parentId ? (api.worldOf(parentId) ?? s.world(parentId)) : null, W);
    }

    /** Every other shown object's connectors that take these tags, in the carry's frame (`matrixIn`: world → it). */
    function snapsFor(id, skip, matrixIn = (m) => m) {
      const s = api.scene();
      const tags = Array.isArray(s.objects[id]?.tags) ? s.objects[id].tags : [];
      const others = [];
      for (const oid of Object.keys(s.objects)) {
        if (skip(oid) || isGroup(s.objects[oid])) continue;
        const extras = api.content(oid)?.extras;
        if (!extras?.connectors?.length) continue;
        if (!api.box(oid, { hints: false })) continue; // hidden: nothing to put it on
        const matrix = api.worldOf(oid);
        if (matrix) others.push({ id: oid, matrix: matrixIn(matrix), connectors: extras.connectors, snapRadius: extras.snapRadius });
      }
      return snapCandidates(others, tags);
    }

    /**
     * Carry `id` from this press (ev: where it was grabbed; its hit, if on
     * this object, keeps that offset so it doesn't jump). The session lifts
     * it on its first move (opts.now: at once, from ev).
     * @param {string} id  @param {object} [ev]  @param {{ now?: boolean, offset?: number[] }} [opts]
     * @returns {object | null} the session, or null if it can't be carried
     */
    function carry(id, ev = null, opts = {}) {
      if (api.signal.aborted) return null;
      const o = doc().objects?.[id];
      if (!o || isGroup(o)) return null;
      const Ww = api.worldOf(id);
      const box = api.content(id)?.box ?? null;
      if (!Ww || !box) return null;
      // everything from here is in its parent's frame (the world at the root)
      const frame = frameFor(id);
      const W0 = frame.matrixIn(Ww);
      const b0 = worldBox(box, W0);
      const grab = ev?.hit?.id === id && Array.isArray(ev.hit.point) ? frame.pointIn(ev.hit.point) : null;
      const offset = Array.isArray(opts.offset)
        ? [Number(opts.offset[0]) || 0, Number(opts.offset[1]) || 0]
        : grab
          ? [(b0.min[0] + b0.max[0]) / 2 - grab[0], (b0.min[2] + b0.max[2]) / 2 - grab[2]]
          : [0, 0];

      // one carry at a time: a newer one puts an unfinished one back
      open?.cancel();
      let c = null; // the carry, once lifted
      let skip = null;
      let done = false;
      let land = null; // the last landing shown
      let stopRing = null;
      const raycast = frame.raycastIn((origin, dir) => api.raycast(origin, dir, { skip }));

      function lift() {
        skip = carriedBy(id);
        c = createCarry({
          id,
          W: W0,
          box,
          offset,
          snaps: api.pref("snap", true) === false ? [] : snapsFor(id, skip, frame.matrixIn),
          raycast,
          // the rules ask about the world
          landing: (oid, point, hitId) => landingAt(oid, frame.pointOut(point), hitId),
        });
        // on something that moves: the ring goes with it, every frame
        if (frame.parentId) stopRing = api.loop(() => !done && land && showRing(land, frame));
      }

      // Turning over shows as a turn in the air (`spin`: how far through),
      // though the carry has already turned: where it lands never waits on it.
      let spin = null;
      let flips = 0;
      let stopSpin = null;
      const held = () => (spin ? turning(c.state.W, spin.t, turnRadius(box, c.state.W)) : c.state.W);
      function spinning() {
        if (c.state.flips === flips) return;
        flips = c.state.flips;
        spin = { t: 0 };
        stopSpin ??= api.loop((dt) => {
          if (done || !spin) return;
          spin.t += dt / TURN_OVER;
          if (spin.t >= 1) {
            spin = null;
            stopSpin?.();
            stopSpin = null;
          }
          api.pose.hold(id, frame.pose(held()));
        });
      }

      // after the carry moved it: hold it there (peers see it) and show the ring
      function shown(l) {
        if (!l || done) return;
        land = l;
        spinning();
        api.pose.hold(id, frame.pose(held()));
        showRing(l, frame);
      }

      // A peer picked it up before we did (both grabbed it at once): theirs
      // it is, so ours goes back.
      function yieldIfTaken() {
        if (!c || api.heldBy(id) == null) return false;
        session.cancel();
        api.notify("Someone else picked that up first.", "info");
        return true;
      }

      function finish() {
        done = true;
        stopSpin?.();
        stopSpin = null;
        stopRing?.();
        stopRing = null;
        if (open === session) open = null;
        hideRing();
      }

      const session = {
        cursor: "grabbing",
        move(ev) {
          if (done) return;
          if (!doc().objects?.[id]) return; // removed meanwhile: nothing to carry
          if (!c) lift();
          else if (yieldIfTaken()) return;
          const ray = frame.rayIn(rayOf(ev));
          if (ray) shown(c.move(ray, !!ev?.alt));
        },
        end(ev) {
          if (done) return;
          if (yieldIfTaken()) return;
          const W = c && doc().objects?.[id] ? c.put(frame.rayIn(rayOf(ev)), ev ? !!ev.alt : null) : null;
          finish();
          if (!W) {
            if (c) api.pose.release(id);
            return;
          }
          api.change(api.ops.setTransform(api.scene(), id, frame.pose(W)));
          api.pose.release(id, { landed: true });
        },
        // a press that didn't move: not a carry, so the click goes on (to selection)
        tap: () => false,
        cancel() {
          if (done) return;
          const lifted = !!c;
          finish();
          if (lifted) api.pose.release(id);
        },
        key(ev) {
          if (done || !c) return false;
          const k = String(ev.key ?? "");
          const lower = k.toLowerCase();
          if (lower === "q" || lower === "e") shown(c.turn(lower === "q" ? TURN : -TURN));
          else if (lower === "f") shown(c.flip());
          else if (k === "Alt") shown(c.alt(true));
          // Escape is left to the router, which cancels the gesture (put back)
          else return false;
          return true;
        },
        keyup(ev) {
          if (done || !c) return false;
          if (ev?.key !== "Alt") return false;
          shown(c.alt(false));
          return true;
        },
      };
      open = session;
      if (opts.now && ev) session.move(ev);
      return session;
    }

    // ─── turning over where it lies ─────────────────────────────────────────

    /** Turn `id` over where it lies: up, over and down again, then written. @returns whether it started */
    function flip(id) {
      if (api.signal.aborted || !canCarry(id)) return false;
      const Ww = api.worldOf(id);
      const box = api.content(id)?.box ?? null;
      if (!Ww || !box) return false;
      // in its parent's frame: it turns over on the table it lies on, wherever that is going
      const frame = frameFor(id);
      const W0 = frame.matrixIn(Ww);
      const skip = carriedBy(id);
      const { to, lift } = flipInPlace({ W: W0, box, raycast: frame.raycastIn((origin, dir) => api.raycast(origin, dir, { skip })) });
      let t = 0;
      const end = (W) => {
        flipping.get(id)?.();
        flipping.delete(id);
        if (!W) return api.pose.release(id);
        api.change(api.ops.setTransform(api.scene(), id, frame.pose(W)));
        api.pose.release(id, { landed: true });
      };
      flipping.set(
        id,
        api.loop((dt) => {
          // removed meanwhile, or a peer picked it up first: it's theirs
          if (!doc().objects?.[id] || api.heldBy(id) != null) return end(null);
          t += dt / TURN_OVER;
          if (t >= 1) return end(to);
          api.pose.hold(id, frame.pose(flipAt(W0, to, t, lift)));
        }),
      );
      api.pose.hold(id, frame.pose(W0));
      return true;
    }

    // ─── commands ───────────────────────────────────────────────────────────

    const commands = [
      {
        id: "hand",
        name: "Hand",
        key: "h",
        state(target, { scene, local }) {
          if (target != null) return null;
          return { checked: effectiveTool(local, scene?.d) === "hand", title: "Hand: pick objects up and put them down (H)" };
        },
        run() {
          api.local.swap((m) => (m.tool === "hand" ? m : { ...m, tool: "hand" }));
        },
      },
      {
        id: "flip",
        name: "Flip",
        key: "f",
        show: ["menu", "use"],
        // the hand's verb, so only while the hand is the tool (in the editor F is Frame all)
        state(target, { scene, local }) {
          if (target == null || effectiveTool(local, scene?.d) !== "hand" || !canCarry(target)) return null;
          return { title: "Turn it over (F)" };
        },
        run: (id) => flip(id),
      },
      {
        id: "snap",
        name: "Snap",
        show: ["toolbar"],
        state(target, { scene, local }) {
          if (target != null || effectiveTool(local, scene?.d) !== "hand") return null;
          return {
            checked: (local?.prefs?.snap ?? scene?.d?.view?.snap ?? true) !== false,
            title: "Put pieces down on the nearest snap point (hold Alt to place freely)",
          };
        },
        run(target, value) {
          api.setPref("snap", typeof value === "boolean" ? value : api.pref("snap", true) === false);
        },
      },
    ];

    return {
      commands,
      carry,
      input: {
        press(ev) {
          if (ev.button != null && ev.button !== 0) return null;
          if (toolNow() !== "hand" || api.local.get().armed != null) return null;
          const id = ev.hit?.id;
          if (!canCarry(id)) return null;
          return carry(id, ev);
        },
        cursor(ev) {
          if (open || toolNow() !== "hand" || api.local.get().armed != null) return null;
          return canCarry(ev.hit?.id) ? "grab" : null;
        },
      },
      dispose() {
        for (const stop of flipping.values()) stop();
        flipping.clear();
        open = null;
        ring = null;
        layer = null;
      },
    };
  },
};
