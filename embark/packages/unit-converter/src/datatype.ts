import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// Configuration-free contributor marker: the card carries no settings, so the
// document is just its `@patchwork.type` tag.
export type UnitConverterDoc = {
  "@patchwork": { type: "unit-converter" };
};

export const UnitConverterDatatype: DatatypeImplementation<UnitConverterDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "unit-converter" };
  },
  getTitle() {
    return "Unit Converter";
  },
};
