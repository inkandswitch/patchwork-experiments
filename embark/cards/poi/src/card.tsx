import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { PoiProvider } from "./PoiProvider";

// Place Finder card behavior, loaded by the shared card shell as this package's
// `card.js`. It runs the OpenStreetMap search contributor against the canvas
// context it is mounted inside; the card's face (title, description, pips) is
// drawn by the shell from the card document, so the middle slot stays blank.
const card: ToolRender = (_handle, element) =>
  render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PoiProvider element={element} />
      </RepoContext.Provider>
    ),
    element,
  );

export default card;
