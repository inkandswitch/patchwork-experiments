import { createEffect, createSignal } from "solid-js";
import type { BinEntry } from "../parts-bin/catalog";
import { PartsBinList } from "../parts-bin/PartsBinList";
import "./cards-sidebar.css";

// The parts bin as a fixed right-hand column that collapses behind a chevron:
// a 1px divider carrying the toggle, then the bin panel itself. Closes the
// `.embark-cards` flex row for both the Cards sidebar and the full-frame
// card-stack tool. The panel stays mounted while collapsed (hidden via CSS)
// so its inert previews keep their state. The bin is code-defined and
// read-only — no drops, no deletes — see parts-bin/catalog.ts.
export function BinColumn(props: { entries: BinEntry[] }) {
  // Expanded or collapsed is per-browser chrome state, persisted to
  // localStorage and owned here so every host gets it for free.
  const [open, setOpen] = createSignal(readStoredBinOpen());
  createEffect(() => writeStoredBinOpen(open()));

  return (
    <>
      <div class="embark-cards__divider">
        <button
          type="button"
          class="embark-cards__bin-toggle"
          title={open() ? "Collapse parts bin" : "Expand parts bin"}
          aria-expanded={open()}
          on:click={() => setOpen((value) => !value)}
        >
          <ChevronIcon open={open()} />
        </button>
      </div>

      <div
        class="embark-cards__bin"
        classList={{ "embark-cards__bin--open": open() }}
      >
        <div class="embark-cards__bin-title">Parts bin</div>
        <PartsBinList entries={props.entries} />
      </div>
    </>
  );
}

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

// Divider chevron: points right when the bin is open ("push it away"), left
// when collapsed ("pull it out").
function ChevronIcon(props: { open: boolean }) {
  return (
    <svg
      class="embark-cards__chevron"
      classList={{ "embark-cards__chevron--open": props.open }}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
