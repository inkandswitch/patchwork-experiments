import "./style.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AutomergeUrl, parseAutomergeUrl } from "@automerge/automerge-repo";
import { RepoContext, useDocument } from "@automerge/automerge-repo-react-hooks";
import { getType, HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import {
  getRegistry,
  type DatatypeDescription,
  type DatatypeImplementation,
  type LoadedPlugin,
  type ToolElement,
} from "@inkandswitch/patchwork-plugins";
import { openDocument } from "@inkandswitch/patchwork-elements";

function useDatatype(id?: string) {
  const [plugin, setPlugin] = useState<
    LoadedPlugin<DatatypeDescription, DatatypeImplementation> | undefined
  >(undefined);

  useEffect(() => {
    let canceled = false;
    const registry = getRegistry<DatatypeDescription>("patchwork:datatype");

    const loadDatatype = () => {
      if (!id) return;
      registry.load(id).then((datatype) => {
        if (canceled) return;
        setPlugin(
          datatype as LoadedPlugin<DatatypeDescription, DatatypeImplementation>
        );
      });
    };

    const unsubscribe = registry.on("changed", loadDatatype);
    loadDatatype();

    return () => {
      canceled = true;
      unsubscribe();
    };
  }, [id]);

  return plugin?.id === id ? plugin : undefined;
}

export const BackLinkButton = ({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) => {
  const [doc] = useDocument<HasPatchworkMetadata>(docUrl);
  const originalDocUrl = doc?.["@patchwork"]?.copyOf as
    | AutomergeUrl
    | undefined;
  const [originalDoc] = useDocument<HasPatchworkMetadata>(originalDocUrl);
  const originalDocDatatypeId = originalDoc ? getType(originalDoc) : undefined;
  const titleOfOriginalDoc = useDatatype(
    originalDocDatatypeId
  )?.module.getTitle(originalDoc);

  if (!originalDocUrl) {
    return null;
  }

  // strip the heads because we want to link to the current version of the document
  const originalDocWithoutHeads =
    `automerge:${parseAutomergeUrl(originalDocUrl).documentId}` as AutomergeUrl;

  return (
    <div className="text-base-content text-sm">
      (Copy of{" "}
      <button
        className="link"
        onClick={() => {
          openDocument(element, originalDocWithoutHeads);
        }}
      >
        {titleOfOriginalDoc}
      </button>
      )
    </div>
  );
};

export function renderBackLinkButton(
  handle: { url: AutomergeUrl },
  element: ToolElement
) {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <BackLinkButton docUrl={handle.url} element={element} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
