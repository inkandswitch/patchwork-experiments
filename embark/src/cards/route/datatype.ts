import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One of the hard-coded "cards" (see ../). Like the weather card it is
// configuration-free apart from a `folderUrl` pointing at the folder doc that
// holds its inline route renderer (view.js), so the service worker can serve it
// (see RouteProvider). The doc marks an embed as a routing-command contributor:
// it answers `/Drive`, `/Walk`, and `/Transit` commands by minting `card`
// documents carrying the decoded route geometry (which the map then draws).
export type RouteProviderDoc = {
  "@patchwork": { type: "route-provider" };
  folderUrl?: AutomergeUrl;
};

export const RouteProviderDatatype: DatatypeImplementation<RouteProviderDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "route-provider" };
  },
  getTitle() {
    return "Routes";
  },
};
