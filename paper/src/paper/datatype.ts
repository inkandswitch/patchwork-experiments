import type { Repo } from "@automerge/automerge-repo";
import type { PaperDoc, PaperLayerDoc } from "./types";
import type { PaperMapDoc } from "../map/types";
import type { EmbedShape } from "../embed/EmbedLayerTool";

export const PaperDatatype = {
  init(doc: PaperDoc, repo: Repo) {
    doc.title = "Paper";

    // Seed a single embedded map so a fresh paper has something on it. Other
    // layers (rect/line) are still created on demand the first time they draw.
    const map = repo.create<PaperMapDoc>({
      "@patchwork": { type: "paper-map" },
      title: "Map",
    });
    const mapEmbed: EmbedShape = {
      x: 80,
      y: 80,
      z: 1,
      outline: { type: "rectangle", width: 640, height: 420 },
      docUrl: map.url,
      toolId: "paper-map",
    };
    const embedLayer = repo.create<PaperLayerDoc>({
      "@patchwork": { type: "paper-layer" },
      title: "Embeds",
      shapes: [mapEmbed],
    });

    doc.layers = { embed: embedLayer.url };
  },
  getTitle(doc: PaperDoc) {
    return doc.title || "Paper";
  },
  setTitle(doc: PaperDoc, title: string) {
    doc.title = title;
  },
};

export const PaperLayerDatatype = {
  init(doc: PaperLayerDoc) {
    doc.title = "Layer";
    doc.shapes = [];
  },
  getTitle(doc: PaperLayerDoc) {
    return doc.title || "Layer";
  },
  setTitle(doc: PaperLayerDoc, title: string) {
    doc.title = title;
  },
};
