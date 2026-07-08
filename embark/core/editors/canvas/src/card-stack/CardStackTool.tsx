import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { binEntriesForPreset } from "../parts-bin/catalog";
import { BinColumn } from "./BinColumn";
import { StackPane, appendEntries } from "./StackPane";
import type { CardStackDoc } from "./types";
import "./cards-sidebar.css";

// A card stack as a full-frame document tool: one always-active pane, no tab
// rail, with the collapsible parts bin column beside it. This is how a stack
// opens as a regular document — and how the browser extension's side panel
// renders its stack, deep-linking `#frame=card-stack&doc=<id>` (see
// cards-browser-extension). Cards here are live on the page-global body
// store; since the stack *is* the frame, they're trivially always-on and none
// of the sidebar's lease/host machinery is needed.
export const CardStackTool: ToolRender = (handle, element) => {
  const stack = handle as DocHandle<CardStackDoc>;
  // Which bin catalog to offer rides on the document (the extension stamps
  // "browser" onto the stacks it mints). Read once — it never changes after
  // minting.
  const binEntries = binEntriesForPreset(stack.doc()?.binPreset);

  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <div class="embark-cards">
          <div class="embark-cards__main">
            <StackPane
              active
              stack={stack}
              emptyHint="Drag cards here from the parts bin"
              onDropItems={(items) => appendEntries(stack, items)}
            />
          </div>
          <BinColumn entries={binEntries} />
        </div>
      </RepoContext.Provider>
    ),
    element,
  );
};
