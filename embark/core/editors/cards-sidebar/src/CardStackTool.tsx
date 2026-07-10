import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { binEntriesForPreset } from "./parts-bin/catalog";
import { PartsBinList } from "./parts-bin/PartsBinList";
import { FlapGroup, FlapPane } from "./FlapGroup";
import { StackPane, appendEntries } from "./StackPane";
import type { CardStackDoc } from "./types";
import "./cards-sidebar.css";

// A card stack as a full-frame document tool: one always-active pane, no tab
// rail, with the parts bin as a one-tab flap group beside it. This is how a
// stack opens as a regular document — and how the browser extension's side
// panel renders its stack, deep-linking `#frame=card-stack&doc=<id>` (see
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
    () => {
      // The bin flap's open state: per-browser chrome, persisted (unlike the
      // sidebar, this tool has just the one flap tab, so a click toggles it).
      const [binOpen, setBinOpen] = createSignal(readStoredBinOpen());
      createEffect(() => writeStoredBinOpen(binOpen()));

      return (
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
            <FlapGroup
              tabs={[{ id: "bin", label: "Parts bin" }]}
              selected="bin"
              open={binOpen()}
              onTabClick={() => setBinOpen((value) => !value)}
              width="280px"
            >
              <FlapPane active>
                <div class="embark-cards__flap-title">Parts bin</div>
                <PartsBinList entries={binEntries} />
              </FlapPane>
            </FlapGroup>
          </div>
        </RepoContext.Provider>
      );
    },
    element,
  );
};

const BIN_OPEN_STORAGE_KEY = "embark:cards:bin-open";

function readStoredBinOpen(): boolean {
  try {
    return localStorage.getItem(BIN_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredBinOpen(open: boolean): void {
  try {
    localStorage.setItem(BIN_OPEN_STORAGE_KEY, String(open));
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}
