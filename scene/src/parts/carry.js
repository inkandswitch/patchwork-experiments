// scene.carry: carrying objects like pieces on a table (README, "Carry").
//
// "Can be carried" is data: the `scene.carry` trait on an object (TOOLS.md
// §1). This part declares that trait, so it runs, with object scope, in any
// stage whose doc has something carryable, and the input chain offers it a
// press when the nearest link of the hit's chain that carries the trait is
// its holder: press a card, or anything attached to a card, and the card is
// what's carried. There is no tool to pick first: a press that moves a few
// pixels lifts it; a press that doesn't move is still a click (the session's
// tap says no, so the click goes on: a holder's verb, or the selection).
// While carried it follows the pointer over whatever is under it, floating a
// little above where it would land, and a ring on the table shows the spot:
// accent when it will go to a connector (another object's, that takes its
// tags), muted when it will go down where it is. Alt, or the Snap pref off,
// places freely. Q / E turn it 45°, F turns it over (in the air: it rises
// and turns, rather than snapping); Escape puts it back. Every running
// extension's `landing` may ask for it face up where it's going (a card
// carried into your own hand). Put down, it rests on the highest surface
// under its footprint, and only that final pose is written.
//
// Flip (F over a piece, or the menu) is carry's verb: it turns one over where
// it lies: it rises, turns over in the air and comes back down on whatever is
// under it, peers seeing it turn through the pose hold, and only where it
// lands is written.
//
// Other extensions can start a carry too: `carry(id, ev, opts)` (collect
// "carry") returns the session to give back from their press. It carries
// only what has the trait, like a press.
//
// The maths is ./carry-math.js (plain arrays): this file is the stage side —
// rays and raycasts, the pose hold peers see, the ring, the doc write.
//
// It all happens in the frame of what the object is attached to (its doc
// parent; the world at the root): a card on a table aboard a ship is carried,
// snapped, turned over and put down on that table as it moves, heels and
// swings, not left behind in the world. The pointer's ray and every raycast
// go through that frame as drawn this frame, "down" is the parent's −Y, the
// snap points are in it, and the ring is drawn from it each frame.
//
// What can be carried is the trait's; a passing state is any running
// extension's to veto: `carryable(id)` returning false (collected each time)
// means it is neither picked up nor flipped just now (a die under a cup).

import { isGroup } from "../groups.js";
import { createCarry, flipAt, flipInPlace, localTransform, snapCandidates, turnRadius, turning, worldBox } from "./carry-math.js";
import { decomposeMatrix, frameConversions } from "../transform.js";
import { CARRY, carryable } from "../carry-rules.js";

export { CARRY, carryable };

const TURN = Math.PI / 4;
const TURN_OVER = 0.3; // seconds to turn something over
/** The keys a carry takes while it's open: Q and E turn it, F turns it over, Alt places it freely. */
export const CARRY_KEYS = Object.freeze([
  { code: "KeyQ", label: "Turn left" },
  { code: "KeyE", label: "Turn right" },
  { code: "KeyF", label: "Turn over" },
  { code: "AltLeft", label: "Place freely" },
  { code: "AltRight", label: "Place freely" },
]);
const RING_SEGMENTS = 48;

export default {
  create(api) {
    const THREE = api.THREE;
    let open = null; // the open carry's session (one at a time)
    const flipping = new Map(); // id → stop: pieces turning over where they lie
    let layer = null;
    let ring = null;

    const doc = () => api.doc() ?? {};
    /** Does a running extension say this may not be carried just now (carryable(id) → false)? */
    function vetoed(id) {
      for (const { value } of api.collect("carryable")) {
        if (typeof value !== "function") continue;
        try {
          if (value(id) === false) return true;
        } catch (err) {
          console.warn("[scene.carry] a carryable rule failed", err);
        }
      }
      return false;
    }
    /** H11: it says it can be carried (the trait), nobody holds it, it isn't turning over, and nothing vetoes it now. */
    const canCarry = (id) => id != null && carryable(doc().objects?.[id]) && api.heldBy(id) == null && !flipping.has(id) && !vetoed(id);

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
      const theme = api.view.get().theme ?? {};
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
          console.warn("[scene.carry] a landing rule failed", err);
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
      if (api.signal.aborted || !canCarry(id)) return null;
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
          if (!api.pose.hold(id, frame.pose(held()))) refused();
        });
      }

      // after the carry moved it: hold it there (peers see it) and show the ring
      function shown(l) {
        if (!l || done) return;
        land = l;
        spinning();
        if (!api.pose.hold(id, frame.pose(held()))) return refused();
        showRing(l, frame);
      }

      // Something here holds it ahead of the carry (another extension's act,
      // a roll or a glide: not a process, which gives way): the hold is
      // refused, so it was never in our hands. It goes back, nothing written.
      function refused() {
        if (done) return;
        session.cancel();
        api.notify("Something else is moving that.", "info");
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
        // the gesture's keys, declared, so the key order knows them before they're pressed (keymap.js)
        keys: CARRY_KEYS,
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
          // something here holds it ahead of the flip: theirs, nothing written
          if (!api.pose.hold(id, frame.pose(flipAt(W0, to, t, lift)))) end(null);
        }),
      );
      if (api.pose.hold(id, frame.pose(W0))) return true;
      end(null);
      return false;
    }

    // ─── commands ───────────────────────────────────────────────────────────

    const commands = [
      {
        id: "flip",
        name: "Flip",
        key: "f",
        show: ["menu", "use"],
        state(target) {
          if (target == null || !canCarry(target)) return null;
          return { title: "Turn it over (F)" };
        },
        run: (id) => flip(id),
      },
      {
        id: "snap",
        edit: true,
        name: "Snap",
        show: ["toolbar"],
        state(target, { scene, view }) {
          if (target != null) return null;
          return {
            checked: (view?.prefs?.snap ?? scene?.d?.view?.snap ?? true) !== false,
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
      // ev.holder: the nearest link of the hit's chain with the trait (the
      // stage's holdersFor), so a press on what's attached to a piece carries
      // the piece
      input: {
        press(ev) {
          if (ev.button != null && ev.button !== 0) return null;
          if (api.view.get().held != null) return null;
          return carry(ev.holder, ev);
        },
        cursor(ev) {
          if (open || api.view.get().held != null) return null;
          return canCarry(ev.holder) ? "grab" : null;
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
