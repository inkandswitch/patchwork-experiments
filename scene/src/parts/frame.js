// scene.frame: the editor's verbs for pointing the camera at things.
//   - "Frame all" (F): the whole scene.
//   - a double-click on an object frames it (or the selected group it's in).
//   - "Set home view" (menu): this camera as the doc's suggested start
//     (doc.view.home), which a viewer without a saved camera opens at.
// Following the content as it loads is scene.autoframe's.

import { groupChain, isGroup } from "../groups.js";

/** What a double-click on `hitId` frames: the selected group it's in, else the object itself. Pure. */
export function frameTarget(scene, hitId, selected) {
  if (hitId == null || !scene.objects[hitId]) return null;
  if (selected != null && selected !== hitId && isGroup(scene.objects[selected]) && groupChain(scene.groups, hitId).includes(selected)) return selected;
  return hitId;
}

export default {
  create(api) {
    const frameAll = () => api.camera.frame(api.sceneBox());

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
    };
  },
};
