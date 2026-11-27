import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { PatchDoc } from "./layers/index.js";

type Titled = PatchDoc & { title?: string };

export const PatchDatatype: DatatypeImplementation<Titled> = {
  init() {
    throw new Error("Patches are made from the Patches panel, on a document");
  },
  getTitle(doc) {
    return doc.title || "Patch";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
