// walk: the walk body (body.js), a part of every doc, so every stage offers
// it and a body entered from a stage walks there, in its frame (a boat linked
// into a harbour is boarded in her own stage; the body chip, a general part,
// enters it in the focus stage), over the input adapter (supports.js) of
// that stage: told when the doc or what's shown changed, so it looks at its
// bake keys again. It contributes `avatar`: this viewer's walker in this
// stage, as its presence says it, or null (body.js walkBody.avatar), for
// whoever laid the supports out to read. Everyone else who walks is
// walk.people's (people.js), a part of every doc too.

import { walkBody } from "./body.js";
import { createSupports } from "./supports.js";

function create(api) {
  const supports = createSupports(api);
  const body = walkBody(api, supports);
  return { bodies: [body], avatar: () => body.avatar(), update: () => supports.changed(), dispose: () => supports.dispose() };
}

export default { create };
