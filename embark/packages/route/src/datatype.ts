import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One of the hard-coded "cards" (see ./index.ts). Like the weather card it is
// configuration-free: the doc just marks an embed as a routing-command
// contributor. It answers `/Drive`, `/Walk`, and `/Transit` commands by minting
// `card` documents (see @embark/core CardDoc) carrying the decoded route
// geometry (which the map then draws), each pinned to this package's bundled
// `view.js` renderer via `viewUrl`.
export type RouteProviderDoc = {
  "@patchwork": { type: "route-provider" };
};

export const RouteProviderDatatype: DatatypeImplementation<RouteProviderDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "route-provider" };
  },
  getTitle() {
    return "Routes";
  },
};
