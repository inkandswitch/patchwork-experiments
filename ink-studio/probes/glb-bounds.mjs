// Prints the bounds of GLB file docs' meshes (each node's translation applied; no rotations), by url.
//   node probes/glb-bounds.mjs <name=url>...
import { Repo, initSubduction } from "@automerge/automerge-repo";
import { parseGLB } from "../src/glb.js";
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: ["wss://subduction.sync.inkandswitch.com"] });
for (const arg of process.argv.slice(2)) {
  const [name, url] = arg.split("=");
  const d = (await repo.find(url)).doc();
  const { json } = parseGLB(new Uint8Array(d.content));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of json.nodes ?? []) {
    if (node.mesh == null) continue;
    const t = node.translation ?? [0, 0, 0], s = node.scale ?? [1, 1, 1];
    for (const p of json.meshes[node.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i] * s[i] + t[i]); max[i] = Math.max(max[i], a.max[i] * s[i] + t[i]); }
    }
  }
  console.log(name.padEnd(12), "min", min.map((v) => v.toFixed(2)).join(","), "max", max.map((v) => v.toFixed(2)).join(","), "| units", json.asset?.extras?.units ?? "?", "| nodes", json.nodes?.length);
}
process.exit(0);
