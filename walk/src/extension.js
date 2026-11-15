// walk: the walk body (body.js), a general part, so it runs at the focus
// and offers its body there. Everyone else who walks is walk.people's
// (people.js), a part of every doc.

import { walkBody } from "./body.js";

function create(api) {
  return { bodies: [walkBody(api)] };
}

export default { create };
