import type { Repo } from "@automerge/automerge-repo";
import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { EmbarkCanvasDoc, EmbarkEmbed } from "./canvas";
import { seedExampleItems } from "./parts-bin/datatype";
import type { PartsBinDoc } from "./parts-bin/types";

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

// The context canvas: the same canvas shape and UI, but a distinct datatype so
// its sidebar face (ContextCanvasComponent) can host it as a per-browser
// singleton.
// Like every canvas its cards land on the page-global body store and apply
// everywhere. Starts empty (no parts bin): it is a surface for context-providing
// cards, not a document workspace.
export const ContextCanvasDatatype: DatatypeImplementation<EmbarkCanvasDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "context-canvas" };
    doc.title = "Context";
    doc.embeds = {};
  },
  getTitle(doc: EmbarkCanvasDoc) {
    return doc.title || "Context";
  },
  setTitle(doc: EmbarkCanvasDoc, title: string) {
    doc.title = title;
  },
};

// A fresh canvas mints its own parts bin (rather than sharing one global doc) so
// every canvas starts from the same pristine set of examples and edits to a
// bin's contents stay local to that canvas. The bin previews example documents
// and components and hands out copies/references on drag. It sits near the
// top-left and reads as a drawer that pulls out from the edge.
function seedDefaultEmbeds(repo: Repo): EmbarkCanvasDoc["embeds"] {
  // Fit the open drawer to the viewport at creation time, leaving some headroom.
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 620;

  const partsBin = repo.create<PartsBinDoc>({
    "@patchwork": { type: "parts-bin" },
    title: "Parts bin",
    items: seedExampleItems(repo),
  });

  const partsBinEmbed: EmbarkEmbed = {
    id: crypto.randomUUID(),
    docUrl: partsBin.url,
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
