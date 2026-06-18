import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// Configuration-free: the document just marks an embed as a color-styler
// contributor, like the POI provider. It answers nothing on its own — the tool
// scans markdown documents and publishes style stickers.
export type ColorStylerDoc = {
  "@patchwork": { type: "color-styler" };
};

export const ColorStylerDatatype: DatatypeImplementation<ColorStylerDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "color-styler" };
  },
  getTitle() {
    return "Color Styler";
  },
};
