import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  useDocument,
  useDocuments,
} from "@automerge/automerge-repo-react-hooks";
import {
  FolderDoc,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import {
  DatatypeDescription,
  DatatypeImplementation,
  getRegistry,
} from "@inkandswitch/patchwork-plugins";
import { PluginRegistry } from "@inkandswitch/patchwork-plugins/dist/registry/registry";
import { useEffect } from "react";

export const useUpdateDocLinksOfActiveDocumentsEffect = (
  rootFolderUrl: AutomergeUrl,
  docUrls: AutomergeUrl[],
) => {
  const [selectedDocsMap] = useDocuments<HasPatchworkMetadata>(docUrls);

  const [rootFolderDoc, changeRootFolderDoc] = useDocument<FolderDoc>(
    rootFolderUrl,
    {
      suspense: true,
    },
  );

  useEffect(() => {
    let canceled = false;

    const registry = getRegistry("patchwork:datatype") as PluginRegistry<
      DatatypeDescription,
      DatatypeImplementation
    >;

    for (const docUrl of docUrls) {
      const doc = selectedDocsMap.get(docUrl);

      if (!doc) {
        continue;
      }

      const type = doc["@patchwork"]?.type;

      if (!type) {
        continue;
      }

      registry.load(type).then((datatype) => {
        if (canceled || !datatype) {
          return;
        }

        const title = datatype.module.getTitle(doc);

        changeRootFolderDoc((doc) => {
          for (const docLink of doc.docs) {
            if (docLink.url === docUrl && docLink.name !== title) {
              docLink.name = title;
            }
          }
        });
      });
    }

    return () => {
      canceled = true;
    };
  }, [changeRootFolderDoc, docUrls, rootFolderDoc, selectedDocsMap]);
};
