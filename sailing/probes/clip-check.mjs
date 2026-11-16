// What a publisher checks of a boat doc's Sea clip (water/WATER.md, "Clipped
// open water"; WATER Decision 102): one Sea, open water with a sea on it and
// a valid clip, its box covering, in its own frame, her swing circle at
// anchor (the anchor under her bow at the start, ± the rode's horizontal
// reach to the bottom and her length) or a circle of her length about her
// under way, and every landmark (the islet ISLET_REACH about its middle, a
// buoy BUOY_REACH), with CLIP_MARGIN to spare. Worked out from the doc's own
// objects, apart from the template's seaClip. Pure.

import { BUOY_REACH, CLIP_MARGIN, ISLET_REACH } from "../src/layout.js";
import { SLOOP } from "../src/hull-model.js";
import { DEPTH } from "../src/sim.js";
import { RODE } from "../src/traits.js";

/** The problems with doc `d`'s Sea clip (none: []). `anchored`: she lies at anchor (else under way). */
export function clipProblems(d, { anchored }) {
  const objects = Object.values(d?.objects ?? {});
  const seas = objects.filter((o) => o.traits?.water && o.traits["sailing.sea"]);
  if (seas.length !== 1) return [`want one Sea, have ${seas.length}`];
  const sea = seas[0];
  const clip = sea.traits.water.clip;
  if (sea.traits.water.size != null) return ["the Sea has a size: it is a box, not open water"];
  if (!Array.isArray(clip) || clip.length !== 3 || !clip.every((v) => Number.isFinite(v) && v > 0)) return [`the Sea's clip is ${JSON.stringify(clip)}, not three positive numbers`];
  const [w, depth, l] = clip;
  const out = [];
  if (!(depth > SLOOP.draft)) out.push(`the clip is ${depth} m deep, no deeper than her draft (${SLOOP.draft} m)`);
  const t = sea.transform ?? {};
  const yaw = t.rotation?.[1] ?? 0;
  if ((t.rotation?.[0] ?? 0) !== 0 || (t.rotation?.[2] ?? 0) !== 0) out.push("the Sea is tilted: its clip would be no water");
  const local = (p) => {
    const dx = p[0] - (t.position?.[0] ?? 0), dz = p[2] - (t.position?.[2] ?? 0);
    return [dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)];
  };
  const by = (name) => objects.find((o) => o.name === name && o.parent == null);
  const hull = by("Sloop");
  if (!hull) return [...out, "no Sloop at the root"];
  const h = hull.transform.rotation[1];
  const circles = anchored
    ? [["her swing circle", [hull.transform.position[0] - Math.sin(h) * (SLOOP.length / 2), 0, hull.transform.position[2] - Math.cos(h) * (SLOOP.length / 2)], Math.sqrt(RODE ** 2 - DEPTH ** 2) + SLOOP.length]]
    : [["her start", hull.transform.position, SLOOP.length]];
  for (const [name, r] of [["Red buoy", BUOY_REACH], ["Green buoy", BUOY_REACH], ["Islet", ISLET_REACH]]) {
    const o = objects.find((x) => x.name === name);
    if (o) circles.push([name, o.transform.position, r]);
    else out.push(`no ${name}`);
  }
  for (const [name, at, r] of circles) {
    const [x, z] = local(at);
    if (Math.abs(x) + r + CLIP_MARGIN > w / 2 + 1e-6 || Math.abs(z) + r + CLIP_MARGIN > l / 2 + 1e-6) out.push(`the clip ${JSON.stringify(clip)} doesn't cover ${name} (${r} m about ${JSON.stringify(at)}) with ${CLIP_MARGIN} m to spare`);
  }
  return out;
}
