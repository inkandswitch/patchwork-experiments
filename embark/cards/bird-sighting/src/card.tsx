import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { BirdSighting, type BirdSightingState } from "./BirdSightingProvider";

// Bird Sightings card behavior, loaded by the shared card shell as this
// package's `card.js`. It renders the madlib controls and species list into the
// middle slot and runs the eBird lookup against the canvas context; the card's
// face (title, description, pips) is drawn by the shell from the card document.
const card: ToolRender<BirdSightingState> = (handle, element) =>
  render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <BirdSighting element={element} handle={handle} />
      </RepoContext.Provider>
    ),
    element,
  );

export default card;
