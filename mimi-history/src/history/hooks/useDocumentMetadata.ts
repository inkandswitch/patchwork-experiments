import { createMemo, Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import {
  getType,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import { useDatatypes } from "../lib/solid-plugins";
import { isLoadedPlugin } from "@inkandswitch/patchwork-plugins/dist/registry/guards";

/**
 * Hook to compute document metadata (title and ref)
 */
export function useDocumentMetadata(
  doc: Accessor<HasPatchworkMetadata | undefined>,
  handle: Accessor<DocHandle<HasPatchworkMetadata> | undefined>
) {
  const datatypes = useDatatypes();

  const title = createMemo(() => {
    const currentDoc = doc();
    console.log("[useDocumentMetadata] doc:", currentDoc);
    if (!currentDoc) {
      console.log("[useDocumentMetadata] doc is undefined/null, returning empty title");
      return "";
    }
    const type = getType(currentDoc);
    console.log("[useDocumentMetadata] doc type:", type);
    console.log("[useDocumentMetadata] available datatypes:", datatypes.map((dt) => ({ id: dt.id, isLoaded: "module" in dt, hasModule: !!(dt as any).module })));
    const datatype = datatypes.find((dt) => dt.id === type);
    console.log("[useDocumentMetadata] matched datatype:", datatype);
    if (!datatype) {
      console.log("[useDocumentMetadata] no datatype found for type:", type);
      return "";
    }
    console.log("[useDocumentMetadata] isLoadedPlugin:", isLoadedPlugin(datatype), "module:", (datatype as any).module);
    if (datatype && isLoadedPlugin(datatype) && datatype.module) {
      const title = datatype.module.getTitle(currentDoc);
      console.log("[useDocumentMetadata] resolved title:", title);
      return title;
    }
    console.log("[useDocumentMetadata] datatype not loaded or missing module, returning empty title");
    return "";
  });

  const docRef = createMemo(() => {
    const h = handle();
    return h ? h.ref() : undefined;
  });

  return {
    title,
    docRef,
  };
}
