// scene.halo: Move, a tool (STAGE.md, "Hands"), and the selection's handles
// while it is held (STAGE.md, "The input chain"), after Morphic's halo.
//
// Move (V) is picked up and put down like Measure; nothing else shows the
// handles, so selecting is only selecting, and a tool that edits a thing its
// own way (a CAD model's editor) has no handles in its way. Its input passes
// everything: the handles are widgets, so a press on one is still the halo's
// (the chain's widget step), and a press elsewhere goes on as before.
// Round what's selected, while editing (./editing.js: the halo is
// the editor's) with Move held, where its doc may be written and no other
// pointing tool is held:
// a move arrow along each axis, a rotate ring about each, and a scale handle
// at each corner, all outside its box (./halo-math.js says where), sized for
// the screen. There are no modes and no keys: each handle is its own verb,
// so a press on the thing itself still reaches whatever holds it (a card's
// verbs, a carry) and only a press on a handle is the halo's.
//
// It is drawn, picked and dragged in the frame of what the object is
// attached to, as drawn this frame (the world for a group, or at the root):
// the conversions are the carry's (../transform.js frameConversions). So a
// winch's handles heel with the hull, and dragging its arrow while she sails
// moves it along her deck. The handles are found in screen space (within
// GRAB_PX of the pointer) and offered as a widget at their distance from the
// eye, so one behind the thing loses to the thing.
//
// A drag holds the pose as it goes (peers see it move) and writes the local
// transform once, on release. A group moves its movable members together
// (halo-math.js groupRoots) about its box's centre.
//
// It is the focus stage's (what's selected is there): made in the focus's
// facet, and made again there wherever the focus goes; a drag under way
// when the focus moves finishes where it started (the facet lingers while it
// holds the pose).

import { HANDLE_SIZE, MOVE, dragDelta, haloHandles, haloTarget, handleAt, handlePoints, localFrom, moved, moving, groupRoots, usable } from "./halo-math.js";
import { frameConversions } from "../transform.js";
import { worldBox } from "../native/carry-math.js";
import { editor } from "./editor.js";
import { perFocus } from "../per-focus.js";
import { resolveCssColor } from "../stage/public.js";

/** How many frames the halo keeps drawing every frame after what it's on last moved. */
const STILL_FRAMES = 30;

/** The halo in one focus stage: `api` is its facet, `view` the view plugin's api. */
function haloAt(api, view) {
  const THREE = api.THREE;
  const held = api.use("poses");
  // drawn in the main pass (so the thing hides the parts of its halo behind
  // it), and never picked as meshes: widgetAt finds handles on screen
  const layer = api.world();
  layer.name = "halo";
  layer.userData.noPick = true;
  // the handles, in their frame: in the layer only while there are some
  const node = new THREE.Group();
  node.matrixAutoUpdate = false;

  let target = null; // { kind, id } the handles are on
  let frame = null; // its frame's conversions
  let shown = null; // haloHandles(…) as drawn, in the frame
  let drawnKey = "";
  let movedKey = ""; // where the frame and the thing were, to tell a move from a camera change
  let drag = null; // the gesture under way
  let stopLoop = null;
  let still = 0;

  const doc = () => api.scene();

  /** The frame `t` is drawn and dragged in: its doc parent's, as drawn (null: the world). */
  function frameFor(t) {
    const parentId = t.kind === "object" ? (doc().parents.get(t.id) ?? null) : null;
    const P = () => (parentId ? (api.worldOf(parentId) ?? doc().world(parentId)) : null);
    return { ...frameConversions(P), P, parentId };
  }

  /** What the handles move: the object, or the group's movable members. */
  const roots = () => (target.kind === "object" ? [target.id] : groupRoots(doc(), target.id));

  /** Its box in the frame, or null while there's nothing to box. */
  function boxInFrame() {
    if (target.kind === "group") return api.box(target.id);
    const W = api.worldOf(target.id);
    const box = api.content(target.id)?.box;
    if (W && box) return worldBox(box, frame.matrixIn(W));
    const b = api.box(target.id);
    if (!b) return null;
    // no content box (still loading): the world box's corners, boxed in the frame
    return worldBox(b, frame.matrixIn([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  }

  /** The eye, in the frame (null without a camera). */
  function eyeIn() {
    const p = api.camera.get()?.position;
    return Array.isArray(p) ? frame.pointIn(p) : null;
  }

  /** Where the handles are now, in the frame (null: none to show). */
  function placement() {
    if (!target) return null;
    const box = boxInFrame();
    if (!box) return null;
    const c = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2);
    const eye = eyeIn();
    const r = Math.hypot(...[0, 1, 2].map((k) => box.max[k] - box.min[k])) / 2;
    const size = eye ? HANDLE_SIZE * Math.hypot(eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]) : Math.max(r, 0.01) * 0.1;
    return haloHandles(box, Math.max(size, 1e-6));
  }

  // ─── drawing ──────────────────────────────────────────────────────────────

  function colours() {
    const theme = api.view.get().theme ?? {};
    const rgb = (c, f) => new THREE.Color().setRGB(...(Array.isArray(c) ? c : f), THREE.SRGBColorSpace);
    return {
      // the axes' colour tokens (axes.css), as the view's CSS has them now
      axis: ["x", "y", "z"].map((k) => rgb(resolveCssColor(view.root, `--scene-axis-${k}`))),
      accent: rgb(theme.accent, [0.2, 0.9, 0.75]),
    };
  }

  function clear() {
    for (const c of [...node.children]) {
      c.removeFromParent();
      c.traverse?.((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
  }

  function meshFor(h, size, col) {
    const mat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    if (h.kind === "scale") {
      const m = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, size * 0.5, size * 0.5), mat(col.accent));
      m.position.set(...h.at);
      return m;
    }
    if (h.kind === "rotate") {
      const m = new THREE.Mesh(new THREE.TorusGeometry(h.radius, size * 0.06, 6, 64), mat(col.axis[h.axis]));
      // a torus lies in its XY plane: turn it so its axis is the frame's
      if (h.axis === 0) m.rotation.y = Math.PI / 2;
      else if (h.axis === 1) m.rotation.x = Math.PI / 2;
      m.position.set(...h.center);
      return m;
    }
    // a move arrow: a shaft and a head, along +Y of a group turned onto the axis
    const g = new THREE.Group();
    const length = Math.hypot(...[0, 1, 2].map((k) => h.to[k] - h.from[k]));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.06, size * 0.06, length * 0.7, 8), mat(col.axis[h.axis]));
    shaft.position.y = length * 0.35;
    const head = new THREE.Mesh(new THREE.ConeGeometry(size * 0.25, length * 0.3, 16), mat(col.axis[h.axis]));
    head.position.y = length * 0.85;
    g.add(shaft, head);
    if (h.axis === 0) g.rotation.z = -Math.PI / 2;
    else if (h.axis === 2) g.rotation.x = Math.PI / 2;
    g.position.set(...h.from);
    return g;
  }

  /** Bring the drawing up to date: only when where it goes, or its colours, changed. */
  function draw() {
    const p = placement();
    const P = frame?.P?.() ?? null;
    const theme = api.view.get().theme;
    const eye = p ? eyeIn() : null;
    const live = p ? p.handles.filter((h) => usable(h, eye)) : [];
    const key = p ? JSON.stringify([P, live.map(handlePoints).map((ps) => [ps[0], ps[ps.length - 1]]), p.radius, theme]) : "";
    shown = p;
    if (key === drawnKey) return false;
    drawnKey = key;
    clear();
    if (!p) node.removeFromParent();
    if (p) {
      if (!node.parent) layer.add(node);
      const col = colours();
      for (const h of live) node.add(meshFor(h, p.size, col));
      node.matrix.fromArray(P ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      node.matrixWorldNeedsUpdate = true;
    }
    api.invalidate();
    return true;
  }

  // What it's on can move without a doc change (a held pose, a parent under
  // sail): after each frame drawn, look; once something moved, look before
  // every frame instead (so the handles go with it, not a frame behind),
  // until it has been still a while.
  function where() {
    if (!target) return "";
    const ids = target.kind === "object" ? [target.id, frame?.parentId] : roots();
    return JSON.stringify(ids.map((id) => (id ? api.worldOf(id) : null)));
  }
  function look() {
    if (!target) return;
    const w = where();
    const movedNow = w !== movedKey;
    movedKey = w;
    draw();
    if (movedNow) {
      still = 0;
      stopLoop ??= api.loop(() => {
        if (!target) return;
        const w2 = where();
        still = w2 === movedKey ? still + 1 : 0;
        movedKey = w2;
        draw();
        if (still > STILL_FRAMES) {
          stopLoop?.();
          stopLoop = null;
        }
      });
    }
  }
  api.afterRender(() => {
    if (!stopLoop) look();
  });

  /** Put the halo on what's selected now (never mid-drag). */
  function reconcile() {
    if (drag) return;
    const next = haloTarget(doc(), api.view.get(), api.writable());
    const same = next && target && next.id === target.id && next.kind === target.kind;
    if (!same) {
      target = next;
      frame = next ? frameFor(next) : null;
      movedKey = "";
    } else if (target.kind === "object" && (doc().parents.get(target.id) ?? null) !== frame.parentId) frame = frameFor(target); // re-attached
    if (!target) {
      stopLoop?.();
      stopLoop = null;
      shown = null;
      if (drawnKey) {
        drawnKey = "";
        clear();
        node.removeFromParent();
        api.invalidate();
      }
      return;
    }
    draw();
  }

  // ─── the drag ─────────────────────────────────────────────────────────────

  const rayOf = (ev) => ev?.ray ?? null;
  const project = (p) => api.project(frame.pointOut(p));

  /** The handle under the pointer, if any. */
  function grabbed(ev) {
    if (!shown || ev?.x == null || ev?.y == null) return null;
    return handleAt(shown.handles, project, ev, { eye: eyeIn() });
  }

  /** A root's local transform for a matrix in the frame: under its doc parent now, as drawn. */
  function poseOf(id, M) {
    const s = doc();
    const p = s.parents.get(id) ?? null;
    return localFrom(p ? (api.worldOf(p) ?? s.world(p)) : null, frame.matrixOut(M));
  }

  function release(d, landed) {
    if (d?.poses) for (const id of d.poses.keys()) held.release(id, landed ? { landed: true } : undefined);
  }

  const session = {
    cursor: "grabbing",
    move(ev) {
      if (!drag) return;
      const delta = dragDelta(drag.grab, drag.ray0, frame.rayIn(rayOf(ev)));
      if (!delta) return;
      const poses = new Map(drag.starts.map(({ id, M }) => [id, poseOf(id, moved(delta, M))]));
      // a peer took hold of something here before we did: theirs, so ours goes back
      if ([...poses.keys()].some((id) => held.heldBy(id) != null)) {
        session.cancel();
        view.use("notices")?.notify("Someone else is moving that.", "info");
        return;
      }
      drag.poses = poses;
      // something here holds one ahead of us (another extension's act, not a process giving way): it goes back
      let refused = false;
      for (const [id, t] of poses) if (!held.hold(id, t)) refused = true;
      if (refused) {
        session.cancel();
        view.use("notices")?.notify("Something else is moving that.", "info");
        return;
      }
      api.invalidate();
    },
    end() {
      const d = drag;
      drag = null;
      if (d?.poses?.size) {
        // each moved object's put-down, as one change (a group's members
        // together): an edit, so undo puts it back (HISTORY.md, TOOLS Decisions 2)
        editor(api).edit(api.ops.setTransform(api.scene(), d.poses), { label: { rotate: "Rotate", scale: "Scale" }[d.grab?.handle?.kind] ?? "Move" });
        release(d, true);
      }
      reconcile();
    },
    // a press on a handle that didn't move: still the halo's (nothing under it is clicked)
    tap() {
      drag = null;
      reconcile();
      return true;
    },
    cancel() {
      const d = drag;
      drag = null;
      release(d, false);
      api.invalidate();
      reconcile();
    },
  };

  const input = {
    widgetAt(ev) {
      if (drag) return { onTop: true, part: drag.grab.handle.kind };
      const g = grabbed(ev);
      if (!g) return null;
      const eye = api.camera.get()?.position;
      const w = frame.pointOut(g.point);
      const distance = Array.isArray(eye) ? Math.hypot(w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]) : 0;
      return { distance, part: g.handle.kind, axis: g.handle.axis ?? null };
    },
    cursor(ev) {
      return ev?.widget?.owner === api.id ? "grab" : null;
    },
    press(ev) {
      if (drag || !target || (ev.button != null && ev.button !== 0)) return null;
      if (ev.widget && ev.widget.owner !== api.id) return null;
      const g = grabbed(ev);
      if (!g) return null;
      // something here is in a peer's hands: the handle is still ours (nothing
      // under it is pressed), but it doesn't move
      const ids = roots();
      if (ids.some((id) => held.heldBy(id) != null)) {
        view.use("notices")?.notify("Someone else is moving that.", "info");
        return { tap: () => true, move() {}, end() {}, cancel() {} };
      }
      const ray0 = frame.rayIn(rayOf(ev));
      if (!ray0) return null;
      const starts = ids.map((id) => ({ id, W: api.worldOf(id) })).filter((r) => r.W).map(({ id, W }) => ({ id, M: frame.matrixIn(W) }));
      if (!starts.length) return null;
      drag = { grab: { handle: g.handle, point: g.point, center: shown.center }, ray0, starts, poses: null };
      return session;
    },
  };

  return {
    input,
    update(scene, local, prev, view) {
      const p = prev?.view;
      if (p && scene === prev.scene && view.selected === p.selected && view.held === p.held && view.hands === p.hands && view.theme === p.theme && local.status === prev.local?.status) return;
      reconcile();
    },
    /** for tests and probes: what it's on, its handles in the frame, and the frame's conversions */
    get debug() {
      return { target, handles: shown?.handles ?? [], center: shown?.center ?? null, frame, dragging: !!drag };
    },
  };
}

/** Move's input: it passes everything (the handles are widgets, offered to the halo by the chain). */
const PASS = Object.freeze({});

function create(api) {
  const at = perFocus(api, (f) => haloAt(f, api));
  const held = () => moving(api.view.get());
  return {
    commands: [
      {
        id: MOVE.command,
        name: "Move",
        key: "v",
        group: "tools",
        icon: "move",
        hand: "edit",
        show: ["toolbar"],
        // a tool: on top of the hands while held; V again (or Escape at the top) puts it down
        tool: {},
        state: (target) => (target == null ? { checked: held(), title: "Move, rotate and scale the selection" } : null),
        run: () => PASS,
      },
    ],
    // (its focus's: what the view offers is read as it offers it)
    get input() {
      return at()?.input ?? null;
    },
    update: (...args) => at()?.update(...args),
    /** for tests and probes: the focus's halo's (see haloAt) */
    get debug() {
      return at()?.debug ?? { target: null, handles: [], center: null, frame: null, dragging: false };
    },
  };
}

export default { create };
