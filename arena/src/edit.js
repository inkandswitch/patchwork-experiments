// Editing a level (the "arena.edit" extension): standing knocked-over targets
// back up. It runs only while editing a scene that already has an arena
// trait. Putting a target, crate or spawn point is the parts bin's (parts.js);
// a whole level comes from the "Arena level" template, and a level trait on
// its own from the inspector's "Add behaviour…" (index.js describes them).

import { anyDown, standTargetsUp } from "./level.js";

export default {
  create(api) {
    return {
      commands: [
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
