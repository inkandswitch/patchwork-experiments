// Applies publish-gallery.mjs's walkable() to an already-published gallery, in one change:
// the Floor a walk.support, the room's own objects under it (positions unchanged: the Floor is at the origin).
//   node probes/gallery-walkable.mjs <gallery url>
import { Repo, initSubduction } from "@automerge/automerge-repo";
await initSubduction();
const repo = new Repo({ network: [], subductionWebsocketEndpoints: ["wss://subduction.sync.inkandswitch.com"] });
const h = await repo.find(process.argv[2]);
const d0 = h.doc();
const floor = Object.keys(d0.objects).find((id) => d0.objects[id].name === "Floor");
const f = d0.objects[floor].transform;
if (f.position.some((v) => v !== 0) || f.rotation.some((v) => v !== 0) || f.scale !== 1) throw new Error("the Floor isn't at the origin, unturned: reparenting would move things");
const moved = [];
h.change((d) => {
  if (!d.objects[floor].traits) d.objects[floor].traits = {};
  if (!d.objects[floor].traits["walk.support"]) d.objects[floor].traits["walk.support"] = {};
  for (const [id, o] of Object.entries(d.objects))
    if (id !== floor && o.kind !== "group" && o.parent == null && o.name !== "Garden") { o.parent = floor; moved.push(o.name); }
  const garden = Object.keys(d.objects).find((id) => d.objects[id].name === "Garden");
  if (garden) {
    if (!d.objects[garden].traits) d.objects[garden].traits = {};
    if (!d.objects[garden].traits["walk.moves"]) d.objects[garden].traits["walk.moves"] = {};
  }
});
await new Promise((r) => setTimeout(r, 5000));
const fresh = new Repo({ network: [], subductionWebsocketEndpoints: ["wss://subduction.sync.inkandswitch.com"] });
const got = (await fresh.find(process.argv[2])).doc();
console.log("support:", Object.keys(got.objects[floor].traits ?? {}).join(","), "| now under the Floor:", moved.join(", "));
console.log("garden:", JSON.stringify(Object.values(got.objects).find((o) => o.name === "Garden")?.traits));
console.log("left on the ground:", Object.values(got.objects).filter((o) => o.kind !== "group" && o.parent == null).map((o) => o.name).join(", "));
process.exit(0);
