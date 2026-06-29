import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "currency-converter",
    name: "Currency Converter",
    icon: "DollarSign",
    supportedDatatypes: ["currency-converter"],
    async load() {
      const { CurrencyConverterTool } = await import("./tool");
      return CurrencyConverterTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "currency-converter",
    name: "Currency Converter",
    icon: "DollarSign",
    async load() {
      const { CurrencyConverterDatatype } = await import("./datatype");
      return CurrencyConverterDatatype;
    },
  },
];
