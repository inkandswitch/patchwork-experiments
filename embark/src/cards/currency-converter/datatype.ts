import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// Configuration-free contributor marker: the card carries no settings, so the
// document is just its `@patchwork.type` tag.
export type CurrencyConverterDoc = {
  "@patchwork": { type: "currency-converter" };
};

export const CurrencyConverterDatatype: DatatypeImplementation<CurrencyConverterDoc> =
  {
    init(doc) {
      doc["@patchwork"] = { type: "currency-converter" };
    },
    getTitle() {
      return "Currency Converter";
    },
  };
