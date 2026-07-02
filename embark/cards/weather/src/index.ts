import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Weather package ships the `weather-card` datatype it mints for each
// forecast, a board tool that renders a weather-card full-size, and a
// `"token"`-tagged tool that paints the compact inline chip used wherever a
// weather-card is embedded in text. The Weather card itself (the `/weather`
// command contributor) is no longer a component: it is a `card` document whose
// behavior module (./card) the shared card shell loads.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "weather-card",
    name: "Weather",
    icon: "CloudSun",
    async load() {
      const { WeatherCardDatatype } = await import("./datatype");
      return WeatherCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "weather-card",
    name: "Weather",
    icon: "CloudSun",
    supportedDatatypes: ["weather-card"],
    async load() {
      const { WeatherCardView } = await import("./WeatherCardView");
      return WeatherCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "weather-card-token",
    name: "Weather token",
    icon: "CloudSun",
    supportedDatatypes: ["weather-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { WeatherCardToken } = await import("./token");
      return WeatherCardToken;
    },
  },
];
