// Action to view the entire document content
import { DocHandle, Repo } from "@automerge/automerge-repo";
import { type Plugin } from "@inkandswitch/patchwork-plugins";

export const viewAction: Plugin<any> = {
  type: "patchwork:action",
  id: "view",
  name: "View",
  icon: "Eye",
  supportedDatatypes: ["*"],
  module: {
    isApplicable: () => true,
    default: async (handle: DocHandle<unknown>, _repo: Repo) => {
      // Get the current document state
      const doc = handle.doc();

      // Return the entire document content as a string
      return JSON.stringify(doc, null, 2);
    },
  },
};
