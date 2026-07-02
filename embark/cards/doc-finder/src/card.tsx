import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { DocFinderProvider } from "./DocFinderProvider";

// Find Docs card behavior, loaded by the shared card shell as this package's
// `card.js`. It answers the canvas search channel with documents already on the
// canvas whose title matches the query; the card's face is drawn by the shell
// from the card document, so the middle slot stays blank.
const card: ToolRender = (_handle, element) =>
  render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <DocFinderProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );

export default card;
