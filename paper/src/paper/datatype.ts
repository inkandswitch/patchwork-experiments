import type { Repo } from "@automerge/automerge-repo";
import type { PaperDoc } from "./types";
import type { EmbedShape } from "../embed/EmbedLayerTool";
import { ShapeLayerDoc } from "../surface/types";
import { createPartsBin } from "../parts-bin/datatype";

export const PaperDatatype = {
  init(doc: PaperDoc, repo: Repo) {
    doc.title = "Paper";

    // A fresh paper isn't blank: it embeds a parts bin on the left holding a
    // couple of example documents. Drag a part out of the bin and a clone of
    // it lands on the canvas as its own embed. The bin doc is seeded here (not
    // via its datatype `init`, which raw `repo.create` doesn't run).
    const partsBin = createPartsBin(repo);
    const partsBinEmbed: EmbedShape = {
      id: crypto.randomUUID(),
      x: 24,
      y: 24,
      z: 1,
      scale: 1,
      outline: { type: "rectangle", width: 300, height: 560 },
      docUrl: partsBin.url,
      toolId: "parts-bin",
    };

    const embedLayer = repo.create<ShapeLayerDoc>({
      "@patchwork": { type: "shape-layer" },
      title: "Embed",
      shapes: {
        [partsBinEmbed.id]: partsBinEmbed,
      },
    });

    doc.layers = {
      ["embed-shape-layer"]: embedLayer.url,
    };
  },
  getTitle(doc: PaperDoc) {
    return doc.title || "Paper";
  },
  setTitle(doc: PaperDoc, title: string) {
    doc.title = title;
  },
};
