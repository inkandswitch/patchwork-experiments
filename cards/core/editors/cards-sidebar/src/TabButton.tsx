import "./cards-sidebar.css";

// A file-folder tab on a vertical rail: the label reads top-to-bottom and the
// active tab merges with the sheet of paper beside it. Shared by the sidebar's
// stack rail (Current Doc / Global) and the flap group's rail (Parts bin /
// Inspector) so both read as the same kind of tab.
export function TabButton(props: {
  label: string;
  active: boolean;
  // Draw attention to an unselected tab (e.g. a highlighted card lives inside).
  highlighted?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class="embark-cards__tab"
      classList={{
        "embark-cards__tab--active": props.active,
        "embark-cards__tab--highlighted": props.highlighted === true,
      }}
      aria-selected={props.active}
      on:click={() => props.onSelect()}
    >
      <span class="embark-cards__tab-label">{props.label}</span>
    </button>
  );
}
