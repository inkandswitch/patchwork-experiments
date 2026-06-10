import { DocWithLayers } from "../surface/types";

// The map document an embed points at by default. It is a surface: like a
// paper it maps each layer tool id to the layer document that tool draws into,
// so the standard rect/line/select tools work on it. Its local coordinate
// space is geographic (Web Mercator world units), so shapes stay georeferenced
// as the map pans and zooms.
export type PaperMapDoc = DocWithLayers & {
  "@patchwork": { type: "paper-map" };
  title: string;
};
