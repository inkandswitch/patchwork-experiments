import type { AutomergeUrl } from "@automerge/automerge-repo";
import { render } from "solid-js/web";
import { findContextStore, type ContextViewMount } from "@embark/context";
import { EmbedToken, useHighlight } from "./tokens";

// The `doc-url` context view: any key or value element that is a document url
// draws as the document's real embed face (EmbedToken), wired to the shared
// hover->Highlight interaction. This is the one view that needs ambient state —
// the store the Highlight channel lives on — so it resolves it from its own
// mounted element via the same DOM discovery writers use, instead of taking a
// prop.
export const docUrlView: ContextViewMount = (element, value) => {
  const url = value as AutomergeUrl;
  const store = findContextStore(element);
  return render(() => {
    const highlight = useHighlight(store);
    return <EmbedToken url={url} highlight={highlight} />;
  }, element);
};
