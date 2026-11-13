// scene.frame: the editor's verbs for pointing the camera at things.
//   - "Frame" (.): the selection, or with nothing selected the whole scene
//     ("Frame all"). Not F: F is carry's Flip, on every surface (TOOLS.md §4).
//   - a double-click on an object frames it (or the selected group it's in).
//   - "Set home view" (menu): this camera as the doc's suggested start
//     (doc.view.start.home, TOOLS.md §2), which a viewer without a saved
//     camera opens at. An edit: undo takes it back.
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
    /** What Frame frames: the selection's box, if it has one, else the whole scene's. */
    const selectedBox = (local) => (local?.selected != null ? api.box(local.selected) : null);

    return {
      commands: [
        {
          id: "frame",
          name: "Frame all",
          key: ".",
          state: (target, { local } = {}) => {
            if (target != null) return null;
            return selectedBox(local) ? { label: "Frame selection", title: "Frame the selection (.)" } : { title: "Frame everything (.)" };
          },
          run: () => api.camera.frame(selectedBox(api.local.get()) ?? api.sceneBox()),
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
            api.edit(
              (d) => {
                if (!d.view || typeof d.view !== "object") d.view = {};
                if (!d.view.start || typeof d.view.start !== "object") d.view.start = {};
                d.view.start.home = home;
              },
              { label: "Set home view" },
            );
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
