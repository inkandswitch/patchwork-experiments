import {
  Compartment,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  showTooltip,
  tooltips,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { DocHandle } from "@automerge/automerge-repo";
import { subscribe } from "@inkandswitch/patchwork-providers";
import {
  COMMANDS_QUERY_SELECTOR,
  COMMANDS_RESPONSES_SELECTOR,
} from "../canvas/providers/CommandsProvider";
import type { CommandsDoc, Suggestion } from "./datatype";
import "./commands.css";

// An in-progress `/command`: the document span being replaced (from the `/` to
// the caret), the query typed after the `/`, and the suggestions/selection
// currently shown.
type Command = {
  from: number;
  to: number;
  query: string;
  suggestions: Suggestion[];
  index: number;
};

// The feature's whole state: the active command (if any) plus the trigger key
// the user last dismissed with Escape, so the menu stays shut until they edit
// the command into something new.
type MenuState = { active: Command | null; dismissed: string | null };

// Entry point. Unlike the mention extension, there is nothing to render for
// committed text (a chosen command is just plain editable text), so this is
// purely the search menu — and it stays dormant until a commands broker is
// discovered: the empty compartment plus a probe fill it in once a provider
// answers. Until then (e.g. a markdown editor opened outside a canvas) typing
// `/` does nothing special.
export function slashCommands(): Extension {
  return [activation.of([]), brokerProbe];
}

const activation = new Compartment();

// Opens a discovery subscription on mount. The broker only answers
// `commands:responses` over the channel, so a first emission is proof that a
// commands provider is reachable from this editor; at that point we install the
// real feature and stop probing.
const brokerProbe = ViewPlugin.fromClass(
  class {
    private unsubscribe?: () => void;

    constructor(view: EditorView) {
      this.unsubscribe = subscribe(
        view.dom,
        { type: COMMANDS_RESPONSES_SELECTOR },
        () => {
          this.unsubscribe?.();
          this.unsubscribe = undefined;
          view.dispatch({ effects: activation.reconfigure(commandsFeature()) });
        },
      );
    }

    destroy() {
      this.unsubscribe?.();
    }
  },
);

// The actual behaviour, installed only after a broker is found.
function commandsFeature(): Extension {
  return [
    menuState,
    suggestionController,
    menuKeymap,
    tooltips({ parent: document.body }),
  ];
}

// Async suggestion arrival (the broker writes them into the CommandsDoc over
// time as contributors answer).
const setSuggestions = StateEffect.define<{
  suggestions: Suggestion[];
  index: number;
}>();
// Keyboard navigation within the menu.
const moveIndex = StateEffect.define<number>();
// Escape: hide the menu for the current command.
const dismiss = StateEffect.define<null>();

// Tracks the command purely from the document + selection (so it follows edits
// for free) and layers async suggestions / navigation / dismissal on top via
// effects. Provides the menu tooltip.
const menuState = StateField.define<MenuState>({
  create: (state) => deriveFromDoc({ active: null, dismissed: null }, state),
  update(value, tr) {
    let next = deriveFromDoc(value, tr.state);
    for (const effect of tr.effects) {
      if (effect.is(setSuggestions) && next.active) {
        next = {
          ...next,
          active: {
            ...next.active,
            suggestions: effect.value.suggestions,
            index: effect.value.index,
          },
        };
      } else if (effect.is(moveIndex) && next.active) {
        const index = wrapIndex(
          next.active.index + effect.value,
          next.active.suggestions.length,
        );
        next = { ...next, active: { ...next.active, index } };
      } else if (effect.is(dismiss) && next.active) {
        next = { active: null, dismissed: triggerKey(next.active) };
      }
    }
    return next;
  },
  provide: (field) =>
    showTooltip.from(field, (value) =>
      value.active ? buildMenu(value.active) : null,
    ),
});

// Recompute the trigger from the doc, preserving suggestions when the command
// is unchanged and honouring an outstanding Escape dismissal.
function deriveFromDoc(prev: MenuState, state: EditorState): MenuState {
  const found = activeCommand(state);
  if (!found) return { active: null, dismissed: null };
  const key = triggerKey(found);
  if (prev.dismissed === key) return { active: null, dismissed: key };
  if (prev.active && triggerKey(prev.active) === key) {
    return {
      active: {
        ...found,
        suggestions: prev.active.suggestions,
        index: prev.active.index,
      },
      dismissed: null,
    };
  }
  return { active: { ...found, suggestions: [], index: 0 }, dismissed: null };
}

// Detects `/query` immediately before a caret. The `/` must start a line or
// follow whitespace (so URLs like `https://` and dates like `6/24` don't
// trigger it), and the query runs until the next whitespace or `/` — so the
// menu closes the moment the user types past the command word.
function activeCommand(
  state: EditorState,
): { from: number; to: number; query: string } | null {
  const range = state.selection.main;
  if (!range.empty) return null;
  const head = range.head;
  const line = state.doc.lineAt(head);
  const before = state.doc.sliceString(line.from, head);
  const match = /(?:^|\s)\/([^/\s]*)$/.exec(before);
  if (!match) return null;
  const query = match[1];
  return { from: head - query.length - 1, to: head, query };
}

// Drives the commands broker: lazily creates a throwaway CommandsDoc to receive
// suggestions into, (re)subscribes to the broker whenever the query changes,
// and pushes the suggestions back into the editor as the broker fills the doc.
const suggestionController = ViewPlugin.fromClass(
  class {
    private handle?: DocHandle<CommandsDoc>;
    private onDocChange?: () => void;
    private unsubscribe?: () => void;
    private query: string | null = null;

    constructor(private readonly view: EditorView) {
      this.sync();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(dismiss)))
      ) {
        this.sync();
      }
    }

    private sync() {
      const active = this.view.state.field(menuState, false)?.active;
      if (!active) {
        this.query = null;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        return;
      }
      const repo = window.repo;
      if (!repo) return;
      if (!this.handle) {
        // Intentionally never deleted — it's scratch state for receiving
        // suggestions, and leaking it is acceptable here.
        this.handle = repo.create<CommandsDoc>({
          "@patchwork": { type: "commands" },
          query: "",
          suggestions: [],
        });
        this.onDocChange = () => this.publishSuggestions();
        this.handle.on("change", this.onDocChange);
      }
      // Re-register on every query change, including the empty query (`/` with
      // nothing typed) so contributors can offer their full command list.
      if (active.query !== this.query) {
        this.query = active.query;
        this.unsubscribe?.();
        this.unsubscribe = subscribe(
          this.view.dom,
          {
            type: COMMANDS_QUERY_SELECTOR,
            query: active.query,
            doc: this.handle.url,
          },
          () => {},
        );
      }
    }

    private publishSuggestions() {
      const handle = this.handle;
      if (!handle) return;
      const active = this.view.state.field(menuState, false)?.active;
      if (!active) return;
      const suggestions = handle.doc()?.suggestions ?? [];
      this.view.dispatch({
        effects: setSuggestions.of({
          suggestions,
          index: wrapIndex(active.index, suggestions.length),
        }),
      });
    }

    destroy() {
      this.unsubscribe?.();
      if (this.handle && this.onDocChange) {
        this.handle.off("change", this.onDocChange);
      }
    }
  },
);

// Menu keys take precedence over the editor's defaults, but only while the menu
// is actually open with something to act on — otherwise they fall through.
const menuKeymap = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: (view) => navigate(view, 1) },
    { key: "ArrowUp", run: (view) => navigate(view, -1) },
    { key: "Enter", run: (view) => applySelected(view) },
    { key: "Escape", run: closeMenu },
  ]),
);

function navigate(view: EditorView, delta: number): boolean {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.suggestions.length === 0) return false;
  view.dispatch({ effects: moveIndex.of(delta) });
  return true;
}

// Replaces the `/query` span with the chosen suggestion's `insert` text,
// verbatim. The text is plain and editable — a card effect later finds and acts
// on it (and may decorate it with a sticker showing the result).
function applySelected(view: EditorView, index?: number): boolean {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.suggestions.length === 0) return false;
  const suggestion = active.suggestions[index ?? active.index];
  if (!suggestion) return false;
  const insert = suggestion.insert;
  view.dispatch({
    changes: { from: active.from, to: active.to, insert },
    selection: { anchor: active.from + insert.length },
  });
  view.focus();
  return true;
}

function closeMenu(view: EditorView): boolean {
  if (!view.state.field(menuState, false)?.active) return false;
  view.dispatch({ effects: dismiss.of(null) });
  return true;
}

// Builds the popup. A fresh tooltip is produced whenever the field changes, so
// rendering is one-shot per state.
function buildMenu(active: Command): Tooltip {
  return {
    pos: active.from,
    above: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-command-menu";
      renderMenu(dom, view, active);
      return { dom };
    },
  };
}

function renderMenu(dom: HTMLElement, view: EditorView, active: Command) {
  if (active.suggestions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cm-command-empty";
    empty.textContent = active.query ? "No commands" : "Type a command…";
    dom.appendChild(empty);
    return;
  }
  active.suggestions.forEach((suggestion, i) => {
    const row = document.createElement("div");
    row.className = "cm-command-row";
    if (i === active.index) row.classList.add("cm-command-row--active");

    const label = document.createElement("span");
    label.className = "cm-command-row__label";
    label.textContent = suggestion.label;
    row.appendChild(label);

    const preview = document.createElement("span");
    preview.className = "cm-command-row__preview";
    preview.textContent = suggestion.insert;
    row.appendChild(preview);

    // mousedown (not click) + preventDefault so the editor keeps its selection.
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySelected(view, i);
    });
    dom.appendChild(row);
  });
}

function triggerKey(t: { from: number; query: string }): string {
  return `${t.from}:${t.query}`;
}

function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
