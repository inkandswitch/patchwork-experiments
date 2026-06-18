import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// Configuration-free contributor marker (see color-styler/datatype.ts).
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
