// walk: the walk body (body.js), a part of every doc, so every stage offers
// it and a body entered from a stage walks there, in its frame (a support in
// a doc linked into another is walked in its own doc's stage; the body chip,
// a general part, enters it in the focus stage), over the input adapter
// (supports.js) of that stage: told when the doc or what's shown changed, so
// it looks at its bake keys again. It contributes, for whoever laid the
// supports out:
// - `avatar`: this viewer's walker in this stage, as its presence says it,
//   or null (body.js walkBody.avatar);
// - `stand(id)`: stand that walker at a stand spot, for a body of theirs
//   about to go over walk there; its eye() is where that body looks from
//   (body.js, the live session's stand), or null when not walking here.
// Everyone else who walks is walk.people's (people.js), a part of every doc
// too.

import { walkBody } from "./body.js";
import { createSupports } from "./supports.js";

function create(api) {
  const supports = createSupports(api);
  const body = walkBody(api, supports);
  return { bodies: [body], avatar: () => body.avatar(), stand: (id) => body.stand(id), update: () => supports.changed(), dispose: () => supports.dispose() };
}

export default { create };
