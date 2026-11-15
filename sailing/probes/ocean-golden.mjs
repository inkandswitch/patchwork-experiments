// The golden file water/'s evaluator and sailing's test copy of it are both
// pinned to (WATER.md, W1): for each template sea, its components (sailing's
// spectrum) and every query on a fixed grid. Recorded on 2026-11-14 from
// sailing's own evaluator, before it moved to the water package; running
// this again records what the copy in src/test/ answers, so do it only to
// change the spectrum or the evaluator on purpose, in both packages. Writes
// src/test/ocean-golden.json; copy it verbatim to water/src/test/golden.json
// (packages don't import each other, so each keeps its own copy, and each
// test checks its own evaluator against it).
//
//   node probes/ocean-golden.mjs
import { writeFileSync } from "node:fs";
import { createOcean } from "../src/test/ocean.js";

export const SEAS = [
  { name: "Ship at sea", wind: { speed: 7, from: 45 }, seed: 1, scale: 1 },
  { name: "Ship at anchor", wind: { speed: 6.5, from: 45 }, seed: 2, scale: 1 },
  { name: "Cadboro Bay", wind: { speed: 4, from: 235 }, seed: 3, scale: 0.5 },
  { name: "calm", wind: { speed: 0, from: 0 }, seed: 1, scale: 1 },
  { name: "Harbour", wind: { speed: 5, from: 250 }, seed: 7, scale: 0.5 },
];
export const XS = [-100, 0, 37.5, 1000];
export const TS = [0, 0.5, 13.37, 1e4];
export const YS = [-1, 0.5];

const out = { seas: [] };
for (const sea of SEAS) {
  const o = createOcean(sea);
  const samples = [];
  for (const x of XS)
    for (const z of XS)
      for (const t of TS)
        samples.push({
          x, z, t,
          height: o.heightAt(x, z, t),
          sample: o.sampleAt(x, z, t, [0, 0, 0, 0]),
          normal: o.normalAt(x, z, t, [0, 0, 0]),
          velocity: YS.map((y) => o.velocityAt(x, y, z, t, [0, 0, 0])),
          displaced: o.displaced(x, z, t, [0, 0, 0, 0]),
        });
  out.seas.push({ ...sea, components: o.components, samples });
}
writeFileSync(new URL("../src/test/ocean-golden.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`wrote ${out.seas.length} seas × ${out.seas[0].samples.length} samples`);
