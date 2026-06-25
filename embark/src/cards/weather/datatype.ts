import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One of the hard-coded "cards" (see ../). It is configuration-free apart from a
// `folderUrl` that points at the folder doc holding its inline weather renderer
// (view.js), so the service worker can serve it (see WeatherProvider). The doc
// marks an embed as a weather-command contributor: it answers `/weather <place>`
// commands by minting `card` documents (see ../../card/datatype) carrying the
// day's forecast.
export type WeatherProviderDoc = {
  "@patchwork": { type: "weather-provider" };
  folderUrl?: AutomergeUrl;
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
