// The traversal scene extension (scene:extension "traversal"): exits,
// whatever anyone is doing. Built only from the scene's extension contract (scene/STAGE.md);
// exit.js is the trait and its rules, go.js the leaving. The verb is one
// command, F, on every surface (the prompt, the menu, the inspector, the key
// map), within the body's reach: it says `reach: true`, and the stage
// measures from the body's eye against its reach (scene/STAGE.md, "Bodies").
//
// Nothing is written, claimed or held: using an exit opens another document.

import { exitVerb } from "./exit.js";
import { go } from "./go.js";

function create(api) {
  const here = () => api.url ?? null;
  return {
    commands: [
      {
        id: "go",
        name: "Go",
        key: "f",
        reach: true,
        show: ["use", "menu"],
        state: (target) => {
          const v = exitVerb(api.scene(), target, { here: here() });
          return v && { label: v.label };
        },
        // leave by `target`, if it leads somewhere now (read again: the doc may have changed since the verb was shown)
        run(target) {
          const v = exitVerb(api.scene(), target, { here: here() });
          if (v) go(api, v.to);
        },
      },
    ],
  };
}

export default { create };
