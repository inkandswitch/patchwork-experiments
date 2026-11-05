// scene.gizmo: the move / rotate transform gizmo on the selected object, or on
// a pivot at a selected group's centre that moves the group's members (ported
// from the old viewport.js updateGizmo / startGroupDrag / dragGroup /
// endGroupDrag and tool.js onTransformEnd / onGroupTransformEnd).
//
// three's TransformControls is made without a DOM element: the stage's router
// drives it. widgetAt tells the stage when the pointer is over a handle (so
// the press comes here first, over any object), and the press opens a session
// that feeds it moves. The controls hold a proxy node in this part's onTop
// world group, put at the object's displayed world pose; what the proxy does
// is turned back into the object's local transform under its doc parent,
// held as a pose while dragging (peers see it move) and written on release.
//
// Shown for the move and rotate tools only, while nothing is armed, on a
// selected object that isn't locked, or a group with an unlocked member.

import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { effectiveTool, gizmoTarget, groupMove, groupRoots, localFrom } from "./gizmo-math.js";

const TOOLS = [
  { id: "move", name: "Move", key: "g", tool: "move" },
  { id: "rotate", name: "Rotate", key: "r", tool: "rotate" },
  { id: "select", name: "No gizmo", tool: "select", show: ["toolbar"] },
];

function create(api) {
  const THREE = api.THREE;
  const layer = api.world({ onTop: true });
  layer.name = "gizmo";
  // what the controls move: put where the object (or the group's centre) is shown
  const proxy = new THREE.Object3D();
  proxy.name = "gizmo-proxy";
  layer.add(proxy);

  let tc = null; // made once there's a camera
  let target = null; // { kind: "object" | "group", id, mode } the gizmo is on
  let drag = null; // the gesture under way (see start)
  let placed = ""; // the world matrix the proxy was last put at (an object's)
  let offFollow = null; // the afterRender hook that keeps up with a moving object

  /** The controls, made on first need (they want a camera), with this view's camera. */
  function controls() {
    const cam = api.camera.object;
    if (!cam) return null;
    if (!tc) {
      tc = new TransformControls(cam); // no element: the router drives it
      tc.setSpace("world");
      const helper = tc.getHelper();
      helper.userData.noPick = true; // its pickers are found through widgetAt, not the stage
      layer.add(helper);
    } else if (tc.camera !== cam) tc.camera = cam;
    return tc;
  }

  // the helper and its pickers placed for the current camera and proxy
  const fresh = () => layer.updateMatrixWorld(true);
  const pointer = (ev, button) => ({ x: ev.ndc[0], y: ev.ndc[1], button });
  const attached = () => !!tc && tc.object === proxy;

  /** Put the proxy where the target is shown. @returns {boolean} whether there's a place */
  function place(force = false) {
    if (!target) return false;
    if (target.kind === "object") {
      const w = api.worldOf(target.id);
      if (!w) return false;
      const key = w.join(",");
      if (!force && key === placed) return true;
      placed = key;
      proxy.matrix.fromArray(w).decompose(proxy.position, proxy.quaternion, proxy.scale);
    } else {
      const box = api.groupBox(target.id);
      if (!box) return false;
      placed = "";
      proxy.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
      proxy.quaternion.identity();
      proxy.scale.set(1, 1, 1);
    }
    proxy.updateMatrixWorld(true);
    api.invalidate();
    return true;
  }

  // An object can move without a doc change (a peer's held pose, a parent
  // being carried): after each frame, the proxy catches up with it.
  function follow(on) {
    if (on && !offFollow)
      offFollow = api.afterRender(() => {
        if (!drag && target?.kind === "object") place();
      });
    else if (!on && offFollow) {
      offFollow();
      offFollow = null;
    }
  }

  function detach() {
    target = null;
    placed = "";
    follow(false);
    if (tc?.object) {
      tc.detach();
      api.invalidate();
    }
  }

  /** Attach, move or take away the gizmo for what's selected now (never mid-drag). */
  function reconcile(scene = api.scene(), local = api.local.get()) {
    if (drag) return;
    const next = gizmoTarget(scene, local);
    const c = next ? controls() : null;
    if (!next || !c) return detach();
    const same = target && target.id === next.id && target.kind === next.kind;
    target = next;
    if (!place(!same)) return detach();
    if (c.mode !== next.mode) c.setMode(next.mode);
    if (c.object !== proxy) c.attach(proxy);
    follow(next.kind === "object");
    api.invalidate();
  }

  // ─── the drag ─────────────────────────────────────────────────────────────

  /** What a drag starts from: the proxy's pose (for a cancel), and what it moves. */
  function start() {
    const scene = api.scene();
    const parentWorld = (id) => {
      const p = scene.parents.get(id);
      return p != null ? api.worldOf(p) : null;
    };
    proxy.updateMatrix();
    drag = {
      kind: target.kind,
      id: target.id,
      from: { position: proxy.position.clone(), quaternion: proxy.quaternion.clone(), scale: proxy.scale.clone() },
      pivot: proxy.matrix.toArray(),
      parentWorld: target.kind === "object" ? parentWorld(target.id) : null,
      roots:
        target.kind === "group"
          ? groupRoots(scene, target.id)
              .map((id) => ({ id, world: api.worldOf(id), parentWorld: parentWorld(id) }))
              .filter((r) => r.world)
          : [],
      moved: null, // Map id → local transform, once it has moved
    };
  }

  /** The proxy moved: where everything it carries is now, held so peers see it. */
  function carried() {
    proxy.updateMatrix();
    const now = proxy.matrix.toArray();
    drag.moved = drag.kind === "object" ? new Map([[drag.id, localFrom(drag.parentWorld, now)]]) : groupMove(drag.pivot, now, drag.roots);
    for (const [id, t] of drag.moved) api.pose.hold(id, t);
    api.invalidate();
  }

  function finish() {
    const d = drag;
    drag = null;
    tc?.pointerUp({ x: 0, y: 0, button: 0 });
    return d;
  }

  const session = {
    move(ev) {
      if (!drag || !ev?.ndc) return;
      fresh();
      tc.pointerMove(pointer(ev, -1));
      carried();
    },
    end() {
      const d = finish();
      if (d?.moved?.size) {
        // each moved object's put-down, as one change (a group's members together)
        api.change(api.ops.setTransform(api.scene(), d.moved));
        for (const id of d.moved.keys()) api.pose.release(id, { landed: true });
      }
      reconcile();
    },
    // a press on a handle that didn't move: still the gizmo's (nothing under it is clicked)
    tap() {
      finish();
      reconcile();
      return true;
    },
    cancel() {
      const d = finish();
      if (!d) return;
      proxy.position.copy(d.from.position);
      proxy.quaternion.copy(d.from.quaternion);
      proxy.scale.copy(d.from.scale);
      proxy.updateMatrixWorld(true);
      if (d.moved) for (const id of d.moved.keys()) api.pose.release(id);
      api.invalidate();
      reconcile();
    },
  };

  const input = {
    widgetAt(ev) {
      if (!attached() || !ev?.ndc) return null;
      if (drag) return { onTop: true, axis: tc.axis };
      fresh();
      const was = tc.axis;
      tc.pointerHover(pointer(ev, -1));
      if (tc.axis !== was) api.invalidate(); // the hovered handle lights up
      return tc.axis ? { onTop: true, axis: tc.axis } : null;
    },
    press(ev) {
      if (!attached() || drag || !ev?.ndc || (ev.button != null && ev.button !== 0)) return null;
      fresh();
      tc.pointerHover(pointer(ev, -1));
      if (!tc.axis) return null;
      fresh(); // the drag plane faces the camera along this handle's axis
      tc.pointerDown(pointer(ev, 0));
      if (!tc.dragging) return null;
      start();
      return session;
    },
  };

  const setTool = (tool) => api.local.swap((m) => (m.tool === tool ? m : { ...m, tool }));
  const commands = TOOLS.map((t) => ({
    id: t.id,
    name: t.name,
    ...(t.key ? { key: t.key } : {}),
    ...(t.show ? { show: t.show } : {}),
    state: (targetId, { scene, local }) =>
      targetId != null ? null : { checked: effectiveTool(local, scene?.d ?? api.doc()) === t.tool, title: t.key ? `${t.name} (${t.key.toUpperCase()})` : t.name },
    run: () => setTool(t.tool),
  }));

  // the controls draw for whichever camera is this view's now
  api.camera.watch(() => {
    const cam = api.camera.object;
    if (tc && cam && tc.camera !== cam) tc.camera = cam;
    else if (!tc && cam && !drag) reconcile();
  });

  return {
    input,
    commands,
    update(scene, local, prev) {
      const p = prev?.local;
      if (p && scene === prev.scene && local.selected === p.selected && local.tool === p.tool && local.armed === p.armed && local.status === p.status) return;
      reconcile(scene, local);
    },
    dispose() {
      follow(false);
      // not tc.dispose(): it would take listeners off the element it never had
      if (tc) {
        tc.detach();
        tc.getHelper().removeFromParent();
      }
      drag = null;
      target = null;
    },
    /** for tests and probes */
    get debug() {
      return { tc, proxy, target, dragging: !!drag };
    },
  };
}

export default { create };
