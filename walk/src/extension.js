// walk: the walk body (body.js), a general part, so it runs at the focus
// and offers its body there, over the input adapter (supports.js) of the
// stage it runs in: told when the doc or what's shown changed, so it looks
// at its bake keys again. Everyone else who walks is walk.people's
// (people.js), a part of every doc.

import { walkBody } from "./body.js";
import { createSupports } from "./supports.js";

function create(api) {
  const supports = createSupports(api);
  return { bodies: [walkBody(api, supports)], update: () => supports.changed(), dispose: () => supports.dispose() };
}

export default { create };
