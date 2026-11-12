// `scene:extension` "tabletop.rule": the table's policy and nothing else
// (visibility.js): hands show what's in them to their seat and screen it
// from the rest; a card lying face up elsewhere shows to everyone.
//
// Its own extension, with no `activities`, so it holds whatever a viewer is
// doing: a policy that stopped when someone switched activity would take its
// `only` with it, and enlarge the audience (scene/STAGE.md, "Audience").
// Who sits where comes from the `roster` convention (whoever owns seats).

import { audienceOf, seatsFrom } from "./visibility.js";

export default {
  create(api) {
    return {
      audience: (scene) => audienceOf(scene, seatsFrom(api, scene)),
    };
  },
};
