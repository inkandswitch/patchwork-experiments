import type { AutomergeUrl } from "@automerge/automerge-repo";
import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { EmbarkCanvasDoc, EmbarkEmbed } from "./canvas";

// Every fresh canvas embeds this one shared parts bin rather than minting its
// own, so edits to the bin (its example documents) are seen across all
// canvases.
const SHARED_PARTS_BIN_URL =
  "automerge:4HhjmqmrcMEtCd63vGeQFmB1heW7" as AutomergeUrl;

export const EmbarkCanvasDatatype: DatatypeImplementation<EmbarkCanvasDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "embark-canvas" };
    doc.title = "Canvas";
    doc.embeds = seedDefaultEmbeds();
  },
  getTitle(doc: EmbarkCanvasDoc) {
    return doc.title || "Canvas";
  },
  setTitle(doc: EmbarkCanvasDoc, title: string) {
    doc.title = title;
  },
};

// A fresh canvas comes pre-wired with the shared parts bin so there's something
// to drag onto it out of the box: the bin previews example documents (a search
// box and a POI provider) and hands out clones on drag. It sits near the
// top-left and reads as a drawer that pulls out from the edge.
function seedDefaultEmbeds(): EmbarkCanvasDoc["embeds"] {
  // Fit the open drawer to the viewport at creation time, leaving some headroom.
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 620;
  const partsBinEmbed: EmbarkEmbed = {
    id: crypto.randomUUID(),
    docUrl: SHARED_PARTS_BIN_URL,
    toolId: "parts-bin",
    x: 0,
    y: 50,
    width: 290,
    height: viewportHeight - 200,
    z: 1,
  };

  return {
    [partsBinEmbed.id]: partsBinEmbed,
  };
}
