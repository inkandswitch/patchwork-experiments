import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { Show, createEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { binEntriesForPreset } from "./parts-bin/catalog";
import { PartsBinList } from "./parts-bin/PartsBinList";
import { FlapGroup, FlapPane } from "./FlapGroup";
import { StackPane, appendEntries } from "./StackPane";
import { resolveInspectorDoc } from "./inspector-doc";
import type { CardStackDoc } from "./types";
import "./cards-sidebar.css";

// A card stack as a full-frame document tool: one always-active pane, no tab
// rail, with a flap group beside it holding the parts bin and the Inspector —
// the same pair the sidebar's flap group offers. This is how a stack opens as
// a regular document — and how the browser extension's side panel renders its
// stack, deep-linking `#frame=card-stack&doc=<id>` (see
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
      // The flap group's chrome state: which tab is selected and whether the
      // group is open, persisted per browser (same click behavior as the
      // sidebar: the active tab folds the group, any tab opens and selects).
      const [flapTab, setFlapTab] = createSignal<FlapTabId>(
        readStoredFlapTab(),
      );
      const [flapOpen, setFlapOpen] = createSignal(readStoredFlapOpen());
      createEffect(() => writeStoredFlapTab(flapTab()));
      createEffect(() => writeStoredFlapOpen(flapOpen()));
      const clickFlapTab = (id: FlapTabId) => {
        if (flapOpen() && flapTab() === id) {
          setFlapOpen(false);
        } else {
          setFlapTab(id);
          setFlapOpen(true);
        }
      };
      const inspectorVisible = () => flapOpen() && flapTab() === "inspector";

      // The Inspector's backing doc: the same per-browser singleton the
      // sidebar uses, resolved lazily when its tab first shows. It persists
      // the picked target across opens; with no target the inspect tool shows
      // the whole shared context.
      const [inspectorDocUrl, setInspectorDocUrl] =
        createSignal<AutomergeUrl>();
      createEffect(() => {
        if (!inspectorVisible() || inspectorDocUrl() !== undefined) return;
        void resolveInspectorDoc(element.repo).then(setInspectorDocUrl);
      });

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
              tabs={FLAP_TABS}
              selected={flapTab()}
              open={flapOpen()}
              onTabClick={clickFlapTab}
              width="280px"
            >
              <FlapPane active={flapTab() === "bin"}>
                <div class="embark-cards__flap-title">Parts bin</div>
                <PartsBinList entries={binEntries} />
              </FlapPane>
              <FlapPane active={flapTab() === "inspector"}>
                {/* Nothing in the Inspector does page-wide work, so it mounts
                    only while visible — keeping the context viewer from
                    registering as a phantom reader on every channel while
                    hidden (same as the sidebar). */}
                <Show when={inspectorVisible()}>
                  <Show when={inspectorDocUrl()}>
                    {(url) => (
                      <patchwork-view
                        class="embark-cards__inspector-view"
                        doc-url={url()}
                        tool-id="inspect"
                      />
                    )}
                  </Show>
                </Show>
              </FlapPane>
            </FlapGroup>
          </div>
        </RepoContext.Provider>
      );
    },
    element,
  );
};

// The flap group's tabs, mirroring the sidebar's pair.
type FlapTabId = "bin" | "inspector";

const FLAP_TABS: readonly { id: FlapTabId; label: string }[] = [
  { id: "bin", label: "Parts bin" },
  { id: "inspector", label: "Inspector" },
];

const FLAP_TAB_STORAGE_KEY = "embark:cards:stack-flap-tab";
// Kept from when the tool had just the one bin flap, so an existing browser's
// open/closed state carries over.
const FLAP_OPEN_STORAGE_KEY = "embark:cards:bin-open";

function readStoredFlapTab(): FlapTabId {
  try {
    return localStorage.getItem(FLAP_TAB_STORAGE_KEY) === "inspector"
      ? "inspector"
      : "bin";
  } catch {
    return "bin";
  }
}

function writeStoredFlapTab(tab: FlapTabId): void {
  try {
    localStorage.setItem(FLAP_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}

function readStoredFlapOpen(): boolean {
  try {
    return localStorage.getItem(FLAP_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeStoredFlapOpen(open: boolean): void {
  try {
    localStorage.setItem(FLAP_OPEN_STORAGE_KEY, String(open));
  } catch {
    // Ignore: storage can be unavailable (private mode / disabled).
  }
}
