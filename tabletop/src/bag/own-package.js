// Where this package comes from, for the bag docs it makes: each carries it
// as `@patchwork.suggestedImportUrl`, so a viewer with nothing installed is
// offered the bag's tool. Read at runtime from the plugin registry (the
// registered "bag" datatype's importUrl), by the same rule the scene docs
// use (scene-package.js shareableImportUrl).

import { BAG } from "./contents.js";
import { shareableImportUrl } from "./scene-package.js";

/** A new bag doc's `@patchwork`. */
export async function bagPatchwork() {
  let importUrl = null;
  try {
    const { getRegistry } = await import("@inkandswitch/patchwork-plugins");
    for (const type of ["patchwork:datatype", "patchwork:tool"]) {
      const p = getRegistry(type)?.filter?.((x) => x?.id === BAG)?.[0];
      if (typeof p?.importUrl === "string") {
        importUrl = p.importUrl;
        break;
      }
    }
  } catch {
    // no registry: nothing to say
  }
  const url = shareableImportUrl(importUrl);
  return url ? { type: BAG, suggestedImportUrl: url } : { type: BAG };
}
