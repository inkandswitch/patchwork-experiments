import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One of the hard-coded "cards" (see ./index.ts). It is configuration-free: the
// doc just marks an embed as a weather-command contributor. It answers
// `/weather <place>` commands by minting `card` documents (see @embark/core
// CardDoc) carrying the day's forecast, each pinned to this package's bundled
// `view.js` renderer via `viewUrl`.
export type WeatherProviderDoc = {
  "@patchwork": { type: "weather-provider" };
};

export const WeatherProviderDatatype: DatatypeImplementation<WeatherProviderDoc> =
  {
    init(doc) {
      doc["@patchwork"] = { type: "weather-provider" };
    },
    getTitle() {
      return "Weather";
    },
  };
