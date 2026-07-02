import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Weather package ships four plugins: the handle-less `weather` component
// (the feature card + `/weather` command contributor the canvas embeds by url),
// the `weather-card` datatype it mints for each forecast, a board tool that
// renders a weather-card full-size, and a `"token"`-tagged tool that paints the
// compact inline chip used wherever a weather-card is embedded in text.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "weather",
    name: "Weather",
    icon: "CloudSun",
    async load() {
      const { default: component } = await import("./component");
      return component;
    },
  },
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
