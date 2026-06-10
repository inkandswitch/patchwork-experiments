import type { Repo } from "@automerge/automerge-repo";
import type { PaperDoc } from "./types";
import type { PaperMapDoc } from "../map/types";
import type { EmbedShape } from "../embed/EmbedLayerTool";
import { ShapeLayerDoc } from "../surface/types";

export const PaperDatatype = {
  init(doc: PaperDoc, repo: Repo) {
    doc.title = "Paper";

    // Seed an empty nested paper and a map so a fresh paper shows off
    // recursive surfaces — including one whose local space is geographic.
    // Both are created with explicit fields (so their datatype `init` is not
    // re-run); the paper gets no layers, leaving it a blank canvas rather
    // than recursing forever. Other layers (rect/line) are created on demand
    // the first time they draw.
    const childPaper = repo.create<PaperDoc>({
      "@patchwork": { type: "paper" },
      title: "Paper",
      layers: {},
    });
    const paperEmbed: EmbedShape = {
      id: crypto.randomUUID(),
      x: 80,
      y: 80,
      z: 1,
      outline: { type: "rectangle", width: 640, height: 420 },
      docUrl: childPaper.url,
      toolId: "paper",
    };

    const childMap = repo.create<PaperMapDoc>({
      "@patchwork": { type: "paper-map" },
      title: "Map",
      layers: {},
    });
    const mapEmbed: EmbedShape = {
      id: crypto.randomUUID(),
      x: 760,
      y: 80,
      z: 2,
      outline: { type: "rectangle", width: 640, height: 420 },
      docUrl: childMap.url,
      toolId: "paper-map",
    };

    const embedLayer = repo.create<ShapeLayerDoc>({
      "@patchwork": { type: "shape-layer" },
      title: "Embed",
      shapes: { [paperEmbed.id]: paperEmbed, [mapEmbed.id]: mapEmbed },
    });

    doc.layers = { ["embed-shape-layer"]: embedLayer.url };
  },
  getTitle(doc: PaperDoc) {
    return doc.title || "Paper";
  },
  setTitle(doc: PaperDoc, title: string) {
    doc.title = title;
  },
};
