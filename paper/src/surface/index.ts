import { PaperLayerDatatype } from "./datatype";

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "shape-layer",
    name: "Shape Layer",
    icon: "Layers",
    async load() {
      return PaperLayerDatatype;
    },
    unlisted: true,
  },
];
