// Selection card behavior, loaded by the shared card shell as this package's
// `card.js`. The card is the face of the `selection` / `highlight` channels it
// defines (./channels.js): while face-up it renders the live focus state — the
// titles of the selected and highlighted documents — read-only in the middle
// slot. It writes nothing; the canvas editor and hovering views remain the
// publishers, whether or not this card is on the canvas.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { Highlight, Selection } from "./channels.js";
import { useDocTitles } from "./tokens.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

// The doc-url context view rides this module's `plugins` export: the card
// shell registers it when the card first turns face-up and keeps it until the
// card leaves the canvas.
export const plugins = [
  {
    type: "embark:context-view",
    id: "doc-url-context-view",
    name: "Document token context view",
    supports: ["doc-url"],
    async load() {
      const { docUrlView } = await import("./views.js");
      return docUrlView;
    },
  },
];

export default function card(_handle, element) {
  injectStyles();

  const [selected, setSelected] = createSignal([]);
  const [highlighted, setHighlighted] = createSignal([]);
  const titles = useDocTitles(element.repo);

  const track = (setUrls) => (all) => {
    const urls = Object.keys(all);
    for (const url of urls) titles.request(url);
    setUrls(urls);
  };
  const unsubscribeSelection = subscribeContext(
    element,
    Selection,
    track(setSelected),
  );
  const unsubscribeHighlight = subscribeContext(
    element,
    Highlight,
    track(setHighlighted),
  );

  const row = (label, urls) =>
    html`<div class="embark-selection-card__row">
      <span class="embark-selection-card__label">${label}</span>
      <${Show}
        when=${() => urls().length > 0}
        fallback=${html`<span class="embark-selection-card__empty">none</span>`}
      >
        <${For} each=${urls}>
          ${(url) =>
            html`<span class="embark-selection-card__chip" title=${url}
              >${() => titles.titleOf(url)}</span
            >`}
        <//>
      <//>
    </div>`;

  const dispose = render(
    () =>
      html`<div class="embark-selection-card">
        ${row("selected", selected)} ${row("highlighted", highlighted)}
      </div>`,
    element,
  );

  return () => {
    unsubscribeSelection();
    unsubscribeHighlight();
    dispose();
  };
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-selection-card-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.embark-selection-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  font-size: 11px;
  overflow: auto;
}

.embark-selection-card__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}

.embark-selection-card__label {
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 9px;
}

.embark-selection-card__chip {
  max-width: 100%;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.embark-selection-card__empty {
  color: #d1d5db;
}
`;
