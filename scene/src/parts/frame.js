// scene.frame: pointing the camera at things.
//   - "Frame all" (F): the whole scene.
//   - a double-click on an object frames it (or the selected group it's in).
//   - auto-framing (the old tool.js autoFrame): an untouched camera frames
//     the scene as its content arrives, once from hint bounds when there are
//     any (before anything has loaded), else each time the scene's box grows,
//     until everything shown has loaded or the person moves the camera. It
//     starts again when objects arrive in an empty scene.
//   - "Set home view" (menu): this camera as the doc's suggested start
//     (doc.view.home), which a viewer without a saved camera opens at.

import { groupChain, inheritedDisplay, isGroup, outlineParents } from "../groups.js";

/** Do two cameras ({ position, target }) sit in the same place, within a hair of their distance? Pure. */
export function sameCamera(a, b) {
  if (!a || !b) return false;
  const d = Math.hypot(...[0, 1, 2].map((i) => (a.position[i] ?? 0) - (a.target?.[i] ?? 0))) || 1;
  const eps = Math.max(1e-6, d * 1e-4);
  const close = (p, q) => Array.isArray(p) && Array.isArray(q) && p.every((v, i) => Math.abs(v - q[i]) <= eps);
  return close(a.position, b.position) && (!a.target || !b.target || close(a.target, b.target));
}

/** The shown objects (not groups), by their own flag and every group above them. Pure. */
export function shownObjects(scene) {
  const inherited = inheritedDisplay(scene.objects, outlineParents(scene.objects, scene.parents, scene.groups));
  return scene.ids.filter((id) => {
    const o = scene.objects[id];
    return o && !isGroup(o) && o.visible !== false && (inherited.get(id)?.visible ?? true);
  });
}

/** What a double-click on `hitId` frames: the selected group it's in, else the object itself. Pure. */
export function frameTarget(scene, hitId, selected) {
  if (hitId == null || !scene.objects[hitId]) return null;
  if (selected != null && selected !== hitId && isGroup(scene.objects[selected]) && groupChain(scene.groups, hitId).includes(selected)) return selected;
  return hitId;
}

const boxKey = (b) => (b ? [...b.min, ...b.max].map((v) => v.toPrecision(6)).join(",") : "");

export default {
  create(api) {
    // auto-framing: on while the camera is untouched; `left` is where it last put the camera
    let auto = !api.camera.touched();
    let left = null;
    let lastBox = "";
    let lastLoad = null;
    let count = null;

    const frameAll = () => api.camera.frame(api.sceneBox());

    // What has loaded (or failed) of what's shown: content arriving changes it, a pose doesn't.
    const loadKey = (scene, local) =>
      shownObjects(scene)
        .map((id) => (api.content(id)?.loaded ? "1" : (local.status?.[id]?.state ?? "0")))
        .join(",");

    // Has the person taken the camera since we last put it somewhere?
    const taken = () => (left ? !sameCamera(api.camera.get(), left) : api.camera.touched());

    function autoFrame(scene, local) {
      const shown = shownObjects(scene);
      const box = api.sceneBox();
      if (!box) return;
      const k = boxKey(box);
      if (k === lastBox) return;
      lastBox = k;
      api.camera.frame(box);
      left = api.camera.get();
      // From hints the view is already where things will be; otherwise keep
      // following the content until all of it has loaded (or failed).
      const hinted = shown.some((id) => scene.objects[id]?.hint?.bounds);
      const settled = shown.every((id) => api.content(id)?.loaded || ["error", "warn"].includes(local.status?.[id]?.state));
      if (hinted || settled) auto = false;
    }

    return {
      commands: [
        {
          id: "frame-all",
          name: "Frame all",
          key: "f",
          state: (target) => (target == null ? { title: "Frame all (F)" } : null),
          run: () => frameAll(),
        },
        {
          id: "set-home",
          name: "Set home view",
          show: ["menu"],
          state: (target) => (target == null ? { title: "Open this scene here for anyone without a saved view", disabled: !api.camera.get() } : null),
          run: () => {
            const cam = api.camera.get();
            if (!cam?.position) return;
            const home = { position: [...cam.position].map(Number) };
            if (Array.isArray(cam.target)) home.target = [...cam.target].map(Number);
            if (Number.isFinite(cam.fov)) home.fov = cam.fov;
            api.change((d) => {
              if (!d.view) d.view = {};
              d.view.home = home;
            });
          },
        },
      ],
      input: {
        dblclick(ev) {
          const target = frameTarget(api.scene(), ev.hit?.id ?? null, api.local.get().selected ?? null);
          const box = target ? api.box(target) : null;
          if (!box) return false;
          api.camera.frame(box);
          return true;
        },
      },
      update(scene, local, prev) {
        if (scene !== prev.scene || count == null) {
          const n = scene.ids.reduce((k, id) => k + (scene.objects[id] && !isGroup(scene.objects[id]) ? 1 : 0), 0);
          // objects arriving in an empty scene: frame them, wherever the camera was
          if (count === 0 && n > 0) {
            auto = true;
            left = api.camera.get();
            lastBox = "";
          }
          count = n;
        }
        if (!auto) return;
        if (taken()) {
          auto = false;
          return;
        }
        // Only the doc, or content arriving, moves the box we follow: not hover,
        // and not a pose held mid-drag (the stage updates for those too, with
        // the same scene and local), or the camera would jump under the drag.
        const load = loadKey(scene, local);
        if (prev.local && scene === prev.scene && load === lastLoad) return;
        lastLoad = load;
        autoFrame(scene, local);
      },
    };
  },
};
