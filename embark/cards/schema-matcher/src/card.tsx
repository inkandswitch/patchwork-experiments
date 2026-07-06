import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { findContextStore, resolveOwner } from "@embark/context";
import { runSchemaMatcher } from "./schema-matcher";

// Schema Matcher card behavior, loaded by the shared card shell as this
// package's `card.js`. While the card sits face-up on a canvas it runs the
// matcher engine (./schema-matcher) against that canvas's context store:
// schemas published into `SchemaQueries` are matched over the documents in the
// `OpenDocuments` channel (fed by the Open Documents card and by cards minting
// synthetic docs), and match urls are answered into `SchemaMatches`. Flipping
// or removing the card releases the matches slice and stops answering. It
// renders nothing into the middle slot — the face is drawn by the shell.
const card: ToolRender = (_handle, element) =>
  render(() => <SchemaMatcherCard element={element} />, element);

function SchemaMatcherCard(props: { element: ToolElement }) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree, so the store
    // resolves to the canvas's context (the page-global body store) and the
    // owner to this card's embed — that's what lets the context viewer
    // attribute the matcher's reads and writes to this card.
    const stop = runSchemaMatcher(
      findContextStore(props.element),
      props.element.repo,
      resolveOwner(props.element),
    );
    onCleanup(stop);
  });

  return null;
}

export default card;
