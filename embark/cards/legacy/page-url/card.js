// Page-url card behavior, loaded by the shared card shell as this package's
// `card.js`. It shows the web page currently open in the browser, as reported
// by the patchwork-cards browser extension through the `window.patchworkCards`
// global its content script injects. The live tab is persisted onto the card
// document, so a viewer without the extension still sees the last captured
// page (with a note that it isn't live). All rendering is driven by document
// changes — the extension path only writes.
//
// Plain-JS bundleless module with no imports at all: the extension bridge is a
// window global and the card document arrives through the shell.

/**
 * The card doc fields this module touches. The shared CardDoc chrome (title,
 * description, icon, accent) is drawn by the shell; the module widens the doc
 * with its own persisted state, per the card package's convention.
 * @typedef {{
 *   "@patchwork": { type: "card", title: string },
 *   url?: string | null,
 *   pageTitle?: string | null,
 * }} PageUrlCardDoc
 */

export default function card(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "page-url-card";
  element.append(style, root);

  const api = extensionApi();

  const renderFromDoc = () => {
    const doc = handle.doc();
    render(
      root,
      { url: doc?.url ?? null, title: doc?.pageTitle ?? null },
      api !== undefined,
    );
  };
  handle.on("change", renderFromDoc);
  renderFromDoc();

  // Persist the live tab; the change event above repaints.
  const captureTab = (tab) => {
    const url = tab.url ?? null;
    const pageTitle = tab.title ?? null;
    const doc = handle.doc();
    if (doc?.url === url && doc?.pageTitle === pageTitle) return;
    handle.change((d) => {
      d.url = url;
      d.pageTitle = pageTitle;
    });
  };

  let unsubscribe;
  if (api) {
    api
      .getActiveTab()
      .then(captureTab)
      .catch((error) =>
        console.warn("[page-url-card] get-active-tab failed", error),
      );
    unsubscribe = api.onTabChanged(captureTab);
  }

  return () => {
    handle.off("change", renderFromDoc);
    unsubscribe?.();
    root.remove();
    style.remove();
  };
}

// The bridge the browser extension installs on the patchwork page:
// `{ getActiveTab(), runJs(code), onTabChanged(listener) }`.
function extensionApi() {
  return window.patchworkCards;
}

// Bumped by hand on edits, so you can see at a glance which build a card runs.
const VERSION = "v1";

function render(root, page, live) {
  root.replaceChildren();
  if (page.title) root.append(part("title", page.title));
  root.append(part("url", page.url ?? "(no page captured yet)"));
  if (!live) {
    root.append(
      part("note", "Browser extension not connected — showing the last captured page."),
    );
  }
  root.append(part("version", VERSION));
}

function part(className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

const css = `
@layer package {
  :root,
  :host,
  [theme] {
    --page-url-card-fg: var(--editor-line, #222);
    --page-url-card-muted: var(--editor-line-offset-50, #888);
    --page-url-card-family: var(--editor-family-sans, system-ui, sans-serif);
    --page-url-card-family-code: var(--editor-family-code, ui-monospace, monospace);
  }
}

.page-url-card {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--studio-space-2xs, 4px);
  font-family: var(--page-url-card-family);
  color: var(--page-url-card-fg);
}
.page-url-card .title {
  font-weight: 600;
}
.page-url-card .url {
  font-family: var(--page-url-card-family-code);
  font-size: 0.8rem;
  word-break: break-all;
  color: var(--page-url-card-muted);
}
.page-url-card .note {
  font-size: 0.75rem;
  font-style: italic;
  color: var(--page-url-card-muted);
}
.page-url-card .version {
  margin-top: auto;
  align-self: flex-end;
  font-size: 0.65rem;
  color: var(--page-url-card-muted);
}
`;
