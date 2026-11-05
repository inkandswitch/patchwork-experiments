// Editing a level (the "arena.edit" extension): commands that put a target,
// a crate or a spawn point where you're looking, and stand knocked-over
// targets back up. It runs only while editing a scene that already has an
// arena trait; the first one comes from the "Arena level" template or the
// inspector's "Add behaviour…" (index.js describes the traits).

import { KINDS, anyDown, standTargetsUp } from "./level.js";
import { addBlock } from "./layout.js";

const ADDABLE = [
  ["target", "Add target", { "arena.target": {} }],
  ["crate", "Add crate", null],
  ["spawn", "Add spawn point", { "arena.spawn": {} }],
];

export default {
  create(api) {
    /** Where you're looking, on whatever is there (a boat's deck as well as a floor). */
    function spotAhead() {
      const cam = api.camera.get();
      const target = cam.target ?? [0, 0, 0];
      const hit = api.raycast([target[0], target[1] + 50, target[2]], [0, -1, 0], { far: 200 });
      const y = hit ? hit.point[1] : 0;
      const yaw = Math.atan2(cam.position[0] - target[0], cam.position[2] - target[2]);
      return { position: [target[0], y, target[2]], rotation: [0, yaw, 0], scale: 1 };
    }

    async function addOne(kind, traits) {
      const id = await addBlock(api, kind, { name: KINDS[kind].name, transform: spotAhead(), traits });
      api.local.swap((l) => ({ ...l, selected: id }));
    }

    const fail = (err) => api.notify(`Couldn't add it: ${err?.message ?? err}`, "error");
    return {
      commands: [
        ...ADDABLE.map(([kind, name, traits]) => ({
          id: `add-${kind}`,
          name,
          show: ["toolbar", "menu"],
          state: () => ({ title: `${name.replace("Add", "Put")} where you're looking` }),
          run: () => addOne(kind, traits).catch(fail),
        })),
        {
          id: "reset",
          name: "Stand targets up",
          show: ["menu"],
          state: (target, { scene }) => (anyDown(scene?.objects) ? { title: "Stand every knocked-over target back where it stood" } : null),
          run: () => api.change((d) => standTargetsUp(d)),
        },
      ],
    };
  },
};
