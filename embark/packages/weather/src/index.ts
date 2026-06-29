import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "weather-provider",
    name: "Weather",
    icon: "CloudSun",
    supportedDatatypes: ["weather-provider"],
    async load() {
      const { WeatherProviderTool } = await import("./WeatherProvider");
      return WeatherProviderTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "weather-provider",
    name: "Weather",
    icon: "CloudSun",
    async load() {
      const { WeatherProviderDatatype } = await import("./datatype");
      return WeatherProviderDatatype;
    },
  },
];
