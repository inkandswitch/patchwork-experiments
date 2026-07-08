// The slash-command CodeMirror extension the Commands card publishes into the
// canvas `codemirror:extensions` channel. Unlike the mention extension, there
// is nothing to render for committed text (a chosen command is just plain
// editable text), so this is purely the search menu: it publishes the active
// `/query` into `CommandQueries` (its own scoped slice) and shows whatever
// contributors offer back through `CommandSuggestions`.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import { Compartment, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  showTooltip,
  tooltips,
} from "@codemirror/view";
import { CommandQueries, CommandSuggestions } from "./channels.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

// State shapes (plain objects, described here once):
// - An in-progress `/command`: `{ from, to, query, suggestions, index }` — the
//   document span being replaced (from the `/` to the caret), the query typed
//   after the `/`, and the suggestions/selection currently shown.
// - The feature's whole state: `{ active, dismissed }` — the active command
//   (or null) plus the trigger key the user last dismissed with Escape, so the
//   menu stays shut until they edit the command into something new.

// Entry point. The feature stays dormant until a commands broker is
// discovered: the empty compartment plus a probe fill it in once a provider
// answers. Until then (e.g. a markdown editor opened outside a canvas) typing
// `/` does nothing special.
export function slashCommands() {
  injectStyles();
  return [activation.of([]), brokerProbe];
}

const activation = new Compartment();

// Activates once the editor's DOM is in the document, so context reads/writes
// resolve to the right store (the nearest `<patchwork-context>`, or the
// page-global body store). Discovery is a synchronous one-shot retried on
// updates until the editor is connected; the activation dispatch is deferred to
// a microtask so it never runs mid-update. Suggestions only appear when a
// contributor fills the `CommandSuggestions` channel of the resolved store, so
// the feature stays quiet where nothing answers.
const brokerProbe = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.activated = false;
      this.destroyed = false;
      this.schedule(view);
    }

    update(update) {
      this.schedule(update.view);
    }

    schedule(view) {
      if (this.activated || this.destroyed) return;
      if (!view.dom.isConnected) return;
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
function commandsFeature() {
  return [
    menuState,
    suggestionController,
    menuKeymap,
    tooltips({ parent: document.body }),
  ];
}

// Async suggestion arrival (contributors fill the CommandSuggestions channel
// over time as they answer the query).
const setSuggestions = StateEffect.define();
// Keyboard navigation within the menu.
const moveIndex = StateEffect.define();
// Escape: hide the menu for the current command.
const dismiss = StateEffect.define();

// Tracks the command purely from the document + selection (so it follows edits
// for free) and layers async suggestions / navigation / dismissal on top via
// effects. Provides the menu tooltip.
const menuState = StateField.define({
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
function deriveFromDoc(prev, state) {
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
// trigger it). The query may contain spaces so commands can take arguments
// (e.g. `/weather berlin`); it ends only at a newline or a second `/`.
function activeCommand(state) {
  const range = state.selection.main;
  if (!range.empty) return null;
  const head = range.head;
  const line = state.doc.lineAt(head);
  const before = state.doc.sliceString(line.from, head);
  const match = /(?:^|\s)\/([^/\n]*)$/.exec(before);
  if (!match) return null;
  const query = match[1];
  return { from: head - query.length - 1, to: head, query };
}

// Drives the commands system over the shared context: publishes the active
// query into `CommandQueries` (its own scoped slice) and reads back the
// suggestions contributors offered for it from `CommandSuggestions`.
const suggestionController = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.queries = undefined;
      this.unsubscribe = undefined;
      this.latestSuggestions = {};
      this.query = null;
      this.sync();
    }

    update(update) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(dismiss)))
      ) {
        this.sync();
      }
    }

    sync() {
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
    publishQuery(query) {
      this.queries?.change((slice) => {
        for (const key of Object.keys(slice)) delete slice[key];
        if (query !== null) slice[query.trim()] = true;
      });
    }

    publishSuggestions() {
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

function navigate(view, delta) {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.suggestions.length === 0) return false;
  view.dispatch({ effects: moveIndex.of(delta) });
  return true;
}

// Replaces the `/query` span with a mention-style token referencing the chosen
// suggestion's card directly (no clone — the suggestion already minted a fresh
// card).
function applySelected(view, index) {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.suggestions.length === 0) return false;
  const suggestion = active.suggestions[index ?? active.index];
  if (!suggestion) return false;
  const { from, to } = active;
  view.dispatch({ effects: dismiss.of(null) });
  insertEmbed(view, suggestion, from, to);
  view.focus();
  return true;
}

// Drop a `{cardUrl}` token into the note for the suggestion's card. How that
// token renders is decided later by the resolved document (its title, or a
// registered token tool for its datatype), so the token carries nothing but the
// card url.
function insertEmbed(view, suggestion, from, to) {
  const token = buildToken(suggestion.url);
  view.dispatch({
    changes: { from, to, insert: token },
    selection: { anchor: from + token.length },
  });
  view.focus();
}

// Build the token the unified renderer understands: `{automerge:<url>}`. The
// name shown and whether a custom face is drawn are both decided by the resolved
// document (its title, and an optional registered token tool for its datatype),
// so the token itself carries nothing but the card url.
function buildToken(cardUrl) {
  return `{${cardUrl}}`;
}

function closeMenu(view) {
  if (!view.state.field(menuState, false)?.active) return false;
  view.dispatch({ effects: dismiss.of(null) });
  return true;
}

// Builds the popup. A fresh tooltip is produced whenever the field changes, so
// rendering is one-shot per state; the row embeds are torn down when the tooltip
// is destroyed.
function buildMenu(active) {
  return {
    pos: active.from,
    above: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-command-menu";
      const teardowns = renderMenu(dom, view, active);
      return {
        dom,
        destroy() {
          for (const teardown of teardowns) teardown();
        },
      };
    },
  };
}

// Render the menu rows, returning a teardown per row (the embed faces subscribe
// to their card, so they must be disposed when the menu is rebuilt or closed).
function renderMenu(dom, view, active) {
  if (active.suggestions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cm-command-empty";
    empty.textContent = active.query ? "No commands" : "Type a command…";
    dom.appendChild(empty);
    return [];
  }
  const teardowns = [];
  active.suggestions.forEach((suggestion, i) => {
    const row = document.createElement("div");
    row.className = "cm-command-row";
    if (i === active.index) row.classList.add("cm-command-row--active");

    // Preview each suggestion with the same inline face it gets once embedded
    // (via the shared `token-view`, which delegates to the datatype's token tool
    // or draws a title pill). `fallback-label` seeds the suggestion label so the
    // row is never empty. pointer-events are off so the row owns the click.
    const host = document.createElement("patchwork-view");
    host.className = "cm-command-row__embed";
    host.style.pointerEvents = "none";
    host.setAttribute("tool-id", "token-view");
    host.setAttribute("doc-url", suggestion.url);
    host.setAttribute("fallback-label", suggestion.label);
    host.textContent = suggestion.label;
    row.appendChild(host);
    teardowns.push(() => host.remove());

    // mousedown (not click) + preventDefault so the editor keeps its selection.
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySelected(view, i);
    });
    dom.appendChild(row);
  });
  return teardowns;
}

function triggerKey(t) {
  return `${t.from}:${t.query}`;
}

function wrapIndex(index, length) {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-commands-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* The slash-command menu renders inside CodeMirror's .cm-tooltip wrapper.
   Neutralize the wrapper's chrome so only our own surface shows. */
const CSS = `
.cm-tooltip:has(.cm-command-menu) {
  border: none;
  background: transparent;
}

.cm-command-menu {
  min-width: 220px;
  max-width: 420px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  font-size: 13px;
  line-height: 1.4;
}

.cm-command-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.cm-command-row--active,
.cm-command-row:hover {
  background: rgba(59, 130, 246, 0.15);
}

/* The suggestion's inline face (its card's viewUrl preview) or, when the card
   has no custom face, its plain label text. */
.cm-command-row__embed {
  color: #111827;
  font-weight: 500;
}

.cm-command-empty {
  padding: 6px 8px;
  color: #6b7280;
  font-style: italic;
}

@media (prefers-color-scheme: dark) {
  .cm-command-menu {
    border-color: rgba(255, 255, 255, 0.12);
    background: #1f2937;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .cm-command-row--active,
  .cm-command-row:hover {
    background: rgba(96, 165, 250, 0.25);
  }

  .cm-command-row__embed {
    color: #e5e7eb;
  }

  .cm-command-empty {
    color: #9ca3af;
  }
}
`;
