import type { Repo } from "@automerge/automerge-repo";
import type { PaperDoc } from "./types";
import type { EmbedShape } from "../embed/EmbedLayerTool";
import { ShapeLayerDoc } from "../surface/types";

export const PaperDatatype = {
  init(doc: PaperDoc, repo: Repo) {
    doc.title = "Paper";

    // Seed an empty nested paper so a fresh paper shows off recursive
    // surfaces. Created with explicit fields (so this `init` is not re-run)
    // and no layers, leaving it a blank canvas rather than recursing forever.
    // Other layers (rect/line) are created on demand the first time they draw.
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

    const embedLayer = repo.create<ShapeLayerDoc>({
      "@patchwork": { type: "shape-layer" },
      title: "Embed",
      shapes: { [paperEmbed.id]: paperEmbed },
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
