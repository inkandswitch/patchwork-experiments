// The arena's parts (scene:part, STAGE.md "Parts"): a target, a crate and a
// spawn point, for the editor's parts bin. Each is one block of its kind,
// put where the bin says (under the object it was dropped on, if any), from
// the scene's own GLB for that kind (layout.js). They aren't locked as the
// laid-out arena's blocks are: a part is placed by hand, so the gizmo may
// move it.
//
// A target or a spawn point is a piece of the game, so it makes the scene a
// level if it isn't one yet: a scene trait gives play the whole scene's
// input (scene scope), where object traits alone offer it only what reaches
// their objects. A crate is only something to stand on or hide behind, and
// asks for nothing.

import { KINDS } from "./level.js";
import { kindFile, levelObject, makeLevel } from "./layout.js";

const TRAITS = {
  target: { "arena.target": {} },
  crate: null,
  spawn: { "arena.spawn": {} },
};

const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/**
 * The part that puts one block of `kind`: the object, its traits and the
 * level, in one change, so no one sees a block that isn't yet what it is.
 * If what it was put on went while its file was made, it puts nothing.
 */
export function part(kind) {
  const traits = TRAITS[kind];
  return {
    async create(ctx, at) {
      const file = await kindFile(ctx, kind);
      const id = ctx.newId("o");
      const parent = at?.parent ?? null;
      let put = false;
      ctx.change((d) => {
        if (parent && !d.objects?.[parent]) return;
        if (traits) makeLevel(d);
        // under what it was put on, in that one's group (as addObject files it)
        const group = parent ? (d.objects[parent].group ?? null) : null;
        d.objects[id] = { ...levelObject({ name: KINDS[kind].name, transform: at?.transform ?? IDENTITY, traits }, file, group), parent, locked: false };
        d.order.push(id);
        put = true;
      });
      if (!put) ctx.notify?.("What that was put on has gone.");
      return put ? id : null;
    },
  };
}

export const target = part("target");
export const crate = part("crate");
export const spawn = part("spawn");
