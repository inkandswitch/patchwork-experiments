// The dice in the editor's parts bin (scene:part, scene/STAGE.md "Parts"),
// under "Dice". Each makes a new die doc from a preset (die.js PRESETS) and
// adds it to the scene, built by this package's scene:source: a die in a
// scene is its own document, so it can be opened and changed on its own, in
// its 2D panel, without touching any other die.
//
// A die goes where the bin says, under what it was dropped on, squared to
// it: upright in that frame and turned only about its +Y, since a die lies
// on its parent (roll.js). It carries the trait `dice.die`, which is what
// starts the dice extension; everything else about it is in its doc.
//
// Two parts put down several dice at once, filed in one group so they can be
// thrown together (extension.js): a percentile pair (a d10 and its tens), and
// four plus/minus dice.

import { presetDoc, dieOf } from "./die.js";
import { DIE, PROVIDER } from "./ids.js";
import { eulerMatrix } from "./m3.js";
import { diePatchwork, ownImportUrl } from "./own-package.js";
import { scaleOf } from "./roll.js";
import { solid, standingBounds } from "./solids.js";


const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** A die doc, whole, from a preset. */
export function newDieDoc(preset, importUrl = null) {
  return { "@patchwork": diePatchwork(importUrl), ...presetDoc(preset) };
}

/** The box a die's doc will be built to (a placeholder until its GLB arrives): { min, max }, metres. */
export function hintBounds(doc) {
  const d = dieOf(doc);
  const b = standingBounds(solid(d.shape));
  const r = (v) => +(v * d.size).toFixed(6) + 0;
  return { min: b.min.map(r), max: b.max.map(r) };
}

/**
 * A transform in a parent's frame, made upright in it: the same place and
 * scale, turned only about the parent's +Y (the way it faced, seen from above).
 */
export function squared(t) {
  const m = eulerMatrix(t?.rotation ?? [0, 0, 0]);
  const yaw = Math.atan2(m[0][2], m[2][2]);
  return {
    position: [0, 1, 2].map((i) => +(Number(t?.position?.[i]) || 0).toFixed(6) + 0),
    rotation: [0, Math.abs(yaw) < 1e-9 ? 0 : +yaw.toFixed(6), 0],
    scale: Number(t?.scale) || 1,
  };
}

/** Make a die doc and add it to the scene at `transform`; its object id. */
async function addDie(ctx, preset, { parent, transform, group }) {
  const doc = newDieDoc(preset, await ownImportUrl());
  const handle = await ctx.repo.create2(doc);
  return ctx.addObject(handle.url, {
    providerId: PROVIDER,
    name: doc.title,
    parent,
    ...(group === undefined ? {} : { group }),
    transform,
    hint: { bounds: hintBounds(doc) },
    fields: { traits: { [DIE]: {} } },
  });
}

/**
 * The part that puts down the dice of `presets`: one alone, or several side
 * by side (1.6 of the widest apart, along the way they face) in a new group
 * named `name`. Returns what to select: the die, or the group.
 */
export function part(presets, name = null) {
  return {
    async create(ctx, at) {
      const parent = at?.parent ?? null;
      const base = parent ? squared(at?.transform) : { ...IDENTITY, ...(at?.transform ?? {}) };
      if (presets.length === 1) return addDie(ctx, presets[0], { parent, transform: base });
      // several: a group of their own, set out in a row across the way they face
      const group = ctx.newId("g");
      let made = false;
      ctx.change((d) => {
        if (parent && !d.objects?.[parent]) return;
        const into = parent ? (d.objects[parent].group ?? null) : null;
        d.objects[group] = { kind: "group", name, group: into, visible: true, opacity: 1 };
        d.order.push(group);
        made = true;
      });
      if (!made) {
        ctx.notify?.("What that was put on has gone.");
        return null;
      }
      // metres, in the parent's units
      const k = scaleOf(parent ? ctx.worldOf?.(parent) : null);
      const widest = Math.max(...presets.map((p) => presetDoc(p).size));
      const step = (1.6 * widest) / k;
      const m = eulerMatrix(base.rotation);
      const across = [m[0][0], m[1][0], m[2][0]]; // its own +X, in the parent's frame
      for (let i = 0; i < presets.length; i++) {
        const off = (i - (presets.length - 1) / 2) * step;
        const position = base.position.map((v, a) => +(v + across[a] * off).toFixed(6) + 0);
        await addDie(ctx, presets[i], { parent, group, transform: { ...base, position } });
      }
      return group;
    },
  };
}

export const d6 = part(["d6"]);
export const d4 = part(["d4"]);
export const d8 = part(["d8"]);
export const d10 = part(["d10"]);
export const d12 = part(["d12"]);
export const d20 = part(["d20"]);
export const coin = part(["coin"]);
export const doubling = part(["doubling"]);
export const percentile = part(["d10-tens", "d10"], "Percentile dice");
export const plusMinus = part(["plus-minus", "plus-minus", "plus-minus", "plus-minus"], "Plus/minus dice");
