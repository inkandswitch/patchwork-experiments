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
import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  findContextStore,
  getContextHandle,
  subscribeContext,
  type ScopeHandle,
} from "../lib/context";
import { CommandQueries, CommandSuggestions } from "../canvas/channels";
import { deepCloneDocument } from "../canvas/deep-clone";
import type { Suggestion } from "./datatype";
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

// Stays dormant until a canvas context is reachable from this editor (so a
// markdown editor opened outside a canvas leaves `/` inert). Discovery is a
// synchronous one-shot, retried on updates until the editor is connected; the
// activation dispatch is deferred to a microtask so it never runs mid-update.
const brokerProbe = ViewPlugin.fromClass(
  class {
    private activated = false;
    private destroyed = false;

    constructor(view: EditorView) {
      this.schedule(view);
    }

    update(update: ViewUpdate) {
      this.schedule(update.view);
    }

    private schedule(view: EditorView) {
      if (this.activated || this.destroyed) return;
      if (!findContextStore(view.dom)) return;
      this.activated = true;
      queueMicrotask(() => {
        if (this.destroyed) return;
        view.dispatch({ effects: activation.reconfigure(commandsFeature()) });
      });
    }

    destroy() {
      this.destroyed = true;
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

// Async suggestion arrival (contributors fill the CommandSuggestions channel
// over time as they answer the query).
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

// Drives the commands system over the shared context: publishes the active
// query into `CommandQueries` (its own scoped slice) and reads back the
// suggestions contributors offered for it from `CommandSuggestions`.
const suggestionController = ViewPlugin.fromClass(
  class {
    private queries?: ScopeHandle<Record<string, true>>;
    private unsubscribe?: () => void;
    private latestSuggestions: Record<string, Suggestion[]> = {};
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
        if (this.query !== null) {
          this.query = null;
          this.publishQuery(null);
        }
        return;
      }
      if (!this.queries) {
        this.queries = getContextHandle(this.view.dom, CommandQueries);
      }
      if (!this.unsubscribe) {
        this.unsubscribe = subscribeContext(
          this.view.dom,
          CommandSuggestions,
          (all) => {
            this.latestSuggestions = all;
            this.publishSuggestions();
          },
        );
      }
      // Re-publish on every query change, including the empty query (`/` with
      // nothing typed) so contributors can offer their full command list.
      if (active.query !== this.query) {
        this.query = active.query;
        this.publishQuery(active.query);
      }
    }

    // A single-key slice. Unlike search, the empty query is meaningful (typing
    // `/` alone should surface every command), so it is published too.
    private publishQuery(query: string | null) {
      this.queries?.change((slice) => {
        for (const key of Object.keys(slice)) delete slice[key];
        if (query !== null) slice[query.trim()] = true;
      });
    }

    private publishSuggestions() {
      const active = this.view.state.field(menuState, false)?.active;
      if (!active) return;
      const suggestions = this.latestSuggestions[active.query.trim()] ?? [];
      this.view.dispatch({
        effects: setSuggestions.of({
          suggestions,
          index: wrapIndex(active.index, suggestions.length),
        }),
      });
    }

    destroy() {
      this.unsubscribe?.();
      this.queries?.release();
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

// Replaces the `/query` span with a mention-style token for the chosen
// suggestion's card. Cloning the card (so each insertion is independent) is
// async, so the menu is closed immediately and the token is filled in once the
// clone resolves (see `insertEmbed`).
function applySelected(view: EditorView, index?: number): boolean {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.suggestions.length === 0) return false;
  const suggestion = active.suggestions[index ?? active.index];
  if (!suggestion) return false;
  const { from, to } = active;
  const expected = view.state.doc.sliceString(from, to);
  view.dispatch({ effects: dismiss.of(null) });
  void insertEmbed(view, suggestion, from, to, expected);
  view.focus();
  return true;
}

// Deep-clone the suggestion's prototype card so the inserted embed is an
// independent instance, then drop a token referencing the clone (and its
// renderer) into the note. The `/query` span may have shifted while we cloned,
// so it is only replaced when still exactly what we captured.
async function insertEmbed(
  view: EditorView,
  suggestion: Suggestion,
  from: number,
  to: number,
  expected: string,
): Promise<void> {
  // `repo` is published on the window by the host frame.
  const repo = window.repo;
  let cardUrl = suggestion.url;
  if (repo) {
    try {
      cardUrl = await deepCloneDocument(repo, suggestion.url);
    } catch {
      // Fall back to referencing the prototype directly if cloning fails.
    }
  }
  const token = buildToken(suggestion.label, cardUrl, suggestion.viewUrl);
  const docLength = view.state.doc.length;
  const stillThere =
    to <= docLength && view.state.doc.sliceString(from, to) === expected;
  const head = view.state.selection.main.head;
  const at = stillThere ? { from, to } : { from: head, to: head };
  view.dispatch({
    changes: { from: at.from, to: at.to, insert: token },
    selection: { anchor: at.from + token.length },
  });
  view.focus();
}

// Build the mention-style token the embed renderer understands: `[label]{url}`
// for a plain mention, or `[label]{url?view=<encoded>}` when a render module is
// attached. The label is sanitized so `]`/newlines can't close the token early.
function buildToken(
  label: string,
  cardUrl: AutomergeUrl,
  viewUrl?: string,
): string {
  const name = label.replace(/[\]\n]/g, " ").trim() || "card";
  const url = viewUrl
    ? `${cardUrl}?view=${encodeURIComponent(viewUrl)}`
    : cardUrl;
  return `[${name}]{${url}}`;
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
    preview.textContent = shortUrl(suggestion.url);
    row.appendChild(preview);

    // mousedown (not click) + preventDefault so the editor keeps its selection.
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySelected(view, i);
    });
    dom.appendChild(row);
  });
}

function shortUrl(url: string): string {
  return url.replace(/^automerge:/, "").slice(0, 8);
}

function triggerKey(t: { from: number; query: string }): string {
  return `${t.from}:${t.query}`;
}

function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
