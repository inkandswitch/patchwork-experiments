import { For, type JSX } from "solid-js";
import { TabButton } from "./TabButton";
import "./cards-sidebar.css";

// The flap group: a second sheet of paper beside the stack panes, with its own
// vertical rail of file-folder tabs (same look as Current Doc / Global) and one
// animated pane. The rail is always visible; only the pane grows and shrinks,
// squeezing the stack panes when open. The whole group expands and folds as a
// unit — the host decides what a tab click does (fold on the active tab,
// open-and-select otherwise) and no tab renders active while folded.
//
// The pane's contents are the host's children — one FlapPane per tab, all kept
// mounted so they hold their state, with only the selected one shown.
export function FlapGroup<Id extends string>(props: {
  tabs: readonly { id: Id; label: string }[];
  selected: Id;
  open: boolean;
  onTabClick: (id: Id) => void;
  // Pane width; defaults to var(--cards-flap-width).
  width?: string;
  children: JSX.Element;
}) {
  return (
    <>
      <div class="embark-cards__rail embark-cards__rail--flap">
        <For each={props.tabs}>
          {(tab) => (
            <TabButton
              label={tab.label}
              active={props.open && props.selected === tab.id}
              onSelect={() => props.onTabClick(tab.id)}
            />
          )}
        </For>
      </div>

      <div
        class="embark-cards__flap"
        classList={{ "embark-cards__flap--open": props.open }}
        style={props.width ? { "--cards-flap-width": props.width } : undefined}
      >
        <div class="embark-cards__flap-content">{props.children}</div>
      </div>
    </>
  );
}

// One tab's content inside the flap pane. Stays mounted while inactive (just
// hidden), mirroring how the sidebar's stack panes behave.
export function FlapPane(props: { active: boolean; children: JSX.Element }) {
  return (
    <div
      class="embark-cards__flap-pane"
      classList={{ "embark-cards__flap-pane--active": props.active }}
    >
      {props.children}
    </div>
  );
}
