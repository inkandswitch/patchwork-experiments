import type { Repo } from "@automerge/automerge-repo";
import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { EmbarkCanvasDoc, EmbarkEmbed } from "./canvas";
import { createPartsBin } from "./parts-bin/datatype";

export const EmbarkCanvasDatatype: DatatypeImplementation<EmbarkCanvasDoc> = {
  init(doc, repo) {
    doc["@patchwork"] = { type: "embark-canvas" };
    doc.title = "Canvas";
    doc.embeds = seedDefaultEmbeds(repo);
  },
  getTitle(doc: EmbarkCanvasDoc) {
    return doc.title || "Canvas";
  },
  setTitle(doc: EmbarkCanvasDoc, title: string) {
    doc.title = title;
  },
};

// A fresh canvas comes pre-wired with a parts bin so there's something to drag
// onto it out of the box: the bin previews example documents (a search box and
// a POI provider) and hands out clones on drag. `repo.create` doesn't run a
// datatype's `init`, so the parts bin is seeded via its shared helper.
function seedDefaultEmbeds(repo: Repo): EmbarkCanvasDoc["embeds"] {
  const partsBin = createPartsBin(repo);

  const partsBinEmbed: EmbarkEmbed = {
    id: crypto.randomUUID(),
    docUrl: partsBin.url,
    toolId: "parts-bin",
    x: 40,
    y: 40,
    width: 280,
    height: 360,
    z: 1,
  };

  return {
    [partsBinEmbed.id]: partsBinEmbed,
  };
}
