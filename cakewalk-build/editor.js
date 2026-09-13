import { changedSince } from "./build.js";
import { ImmutableString } from "@automerge/automerge";
import { buildInto, summarise } from "./builder.js";
import { describeRepo } from "./providers.js";

console.info("cakewalk-editor loaded from", import.meta.url);

const STYLE_ID = "cakewalk-build-styles";
// One stylesheet for the package, pointed at whichever copy of the module loaded most recently.
// A shell can have two versions of a tool in one page — the list it booted with and the one it
// picked up after a sync — and guarding on the element alone meant the version that happened to
// load first owned the styles for the rest of the session. The new module's CSS then silently
// did nothing, which looks exactly like a CSS bug and is not one.
{
  const href = new URL("./styles.css", import.meta.url).href;
  let link = document.getElementById(STYLE_ID);
  if (!link) {
    link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

// Typing produces a change per keystroke. Wait for quiet rather than building on each one; a
// warm rebuild is about 50ms, so this is about not being silly rather than about affordability.
const REBUILD_AFTER_QUIET_MS = 500;

const debounce = (ms, fn) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/**
 * Write a site: its pages on the left, the one you picked in the middle, and what it looks like
 * on the right.
 *
 * Almost none of this is new. The editor is the `file` tool, the preview is `site-viewer`, and
 * the building is this package's own builder — each reached by id through <patchwork-view>, so
 * nothing here imports them and any of them can be missing without taking the rest down. What
 * this tool adds is the one thing none of them could know on their own: which page you are
 * working on, and therefore which document to edit and which page to show.
 */
export default function CakewalkEditorTool(handle, element) {
  const repo = element.repo ?? window.repo;

  const root = document.createElement("div");
  root.className = "cwe";
  root.innerHTML = `
    <nav class="cwe__pages" aria-label="Pages"></nav>
    <div class="cwe__editor"></div>
    <div class="cwe__preview"></div>
    <footer class="cwe__status">
      <span class="cwe__state"></span>
      <button class="cwe__button" data-act="rebuild">Rebuild</button>
      <span class="cwe__hint" hidden></span>
      <details class="cwe__logbox" hidden><summary>Build log</summary><pre class="cwe__log"></pre></details>
    </footer>`;
  element.append(root);

  const pagesEl = root.querySelector(".cwe__pages");
  const editorEl = root.querySelector(".cwe__editor");
  const previewEl = root.querySelector(".cwe__preview");
  const stateEl = root.querySelector(".cwe__state");
  const hintEl = root.querySelector(".cwe__hint");
  const logBox = root.querySelector(".cwe__logbox");
  const logEl = root.querySelector(".cwe__log");

  /** The site's source files, and what the last build made of them. */
  let files = new Map();
  let pages = new Map();
  let selected = null;
  let status = "idle";
  let statusDetail = "";
  let building = false;
  let dirty = false;
  let watched = new Set();

  const rebuildSoon = debounce(REBUILD_AFTER_QUIET_MS, () => build());

  const watchAll = (handles) => {
    for (const h of watched) h.off("change", rebuildSoon);
    watched = new Set(handles);
    for (const h of watched) h.on("change", rebuildSoon);
  };

  async function build() {
    if (building) {
      // Coalesce rather than drop: the dropped one is the last keystroke of a burst, which is
      // exactly the change you wanted to see.
      dirty = true;
      return;
    }
    building = true;
    dirty = false;
    status = "building";
    render();

    try {
      const result = await buildInto(repo, handle.url, { immutable: (text) => new ImmutableString(text) });
      files = result.files;
      pages = result.pages;
      if (!selected || !files.has(selected)) selected = firstPage(files);

      const handles = await Promise.all(
        [handle.url, ...result.sourceOfDocument.keys()].map((u) => repo.find(u).catch(() => null))
      );
      watchAll(handles.filter(Boolean));

      // Nothing was listening while the build ran. See changedSince.
      const moved = changedSince(result.files, result.sourceOfDocument, watched);
      if (moved) dirty = true;

      status = "ok";
      statusDetail = new Date().toLocaleTimeString();
      logEl.textContent = [
        `read ${result.files.size} files in ${Math.round(result.readMs)}ms (${result.pageCount} pages)`,
        `built ${result.builtCount} files in ${Math.round(result.buildMs)}ms`,
        `${summarise(result)} in ${Math.round(result.writeMs)}ms`,
        ...result.log,
      ].join("\n");
    } catch (err) {
      status = "error";
      statusDetail = String((err && err.message) || err);
      logEl.textContent = statusDetail;
    } finally {
      building = false;
      render();
      if (dirty) rebuildSoon();
    }
  }

  /** The page to open when nothing has been picked: the site's home, else the first page. */
  const firstPage = (files) => {
    const paths = [...files.keys()].filter((p) => /^content\/.*\.(md|html)$/.test(p)).sort();
    return paths.find((p) => p === "content/index.md" || p === "content/index.html") ?? paths[0] ?? null;
  };

  // ── rendering ────────────────────────────────────────────────────────────────────────────
  /** Replace an embedded view only when what it should show has changed. */
  const mount = (container, toolId, docUrl, path) => {
    if (!docUrl) {
      container.replaceChildren();
      return;
    }
    let view = container.querySelector("patchwork-view");
    if (!view || view.getAttribute("doc-url") !== docUrl || view.getAttribute("tool-id") !== toolId) {
      view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", docUrl);
      view.setAttribute("tool-id", toolId);
      container.replaceChildren(view);
    }
    if (path !== undefined && view.getAttribute("data-path") !== path) view.setAttribute("data-path", path);
  };

  // The list of files last rendered, joined. A build runs about once a second while you type,
  // and rebuilding the buttons each time would throw away the scroll position every time — so
  // the rows are made when the set of files changes and only their state is touched after that.
  let renderedPaths = null;
  let scrolledTo = null;

  function renderPages() {
    const paths = [...files.keys()].filter((p) => p.startsWith("content/")).sort();
    const key = paths.join("\n");
    if (key !== renderedPaths) {
      renderedPaths = key;
      pagesEl.replaceChildren(
        ...paths.map((path) => {
          const button = document.createElement("button");
          button.className = "cwe__page";
          button.dataset.path = path;
          // The path without its content/ prefix: that prefix is true of every row and so tells
          // you nothing about any of them.
          button.textContent = path.slice("content/".length);
          return button;
        })
      );
    }
    for (const button of pagesEl.children) {
      const path = button.dataset.path;
      button.setAttribute("aria-current", String(path === selected));
      // A file that is not a page — a template, an image — is still editable, just not previewable.
      button.classList.toggle("cwe__page--nonpage", !pages.has(path));
      // Following a link in the preview can select a file that is scrolled out of sight. Bring it
      // back, but only on the move: scrolling the list on every build would fight whoever is
      // reading it.
      if (path === selected && selected !== scrolledTo) button.scrollIntoView({ block: "nearest" });
    }
    scrolledTo = selected;
  }

  function render() {
    const verdict = describeRepo(handle.doc());
    if (!verdict.buildable) {
      stateEl.textContent = verdict.reason;
      stateEl.dataset.status = "error";
      pagesEl.replaceChildren();
      renderedPaths = null;
      editorEl.replaceChildren();
      previewEl.replaceChildren();
      return;
    }

    renderPages();
    mount(editorEl, "file", selected ? files.get(selected)?.url : null);
    // site-viewer is handed the repo and finds the site inside it; data-path is relative to the
    // site's own root. A source with no page — a template, an image — leaves the preview where
    // it is rather than sending it somewhere arbitrary.
    mount(previewEl, "site-viewer", handle.url, pages.get(selected) ?? undefined);

    stateEl.textContent =
      { idle: "not built yet", building: "building…", ok: `built · ${statusDetail}`, error: statusDetail }[status] ?? status;
    stateEl.dataset.status = status;

    // `pages` is a recent addition to the buildSite contract, and without it there is no way to
    // know which page a source became — so the preview stays on the home page however you move
    // around the list. That is a fixable thing about the repo, so say so rather than looking
    // quietly broken.
    const stale = status === "ok" && pages.size === 0 && [...files.keys()].some((p) => /^content\/.*\.md$/.test(p));
    hintEl.hidden = !stale;
    hintEl.textContent = stale
      ? "The preview cannot follow the page you pick: this repo's build system predates `pages`. Sync the repo to enable it."
      : "";
    logBox.hidden = !logEl.textContent;
    if (status === "error") logBox.open = true;
  }

  // ── wiring ───────────────────────────────────────────────────────────────────────────────
  // Selection and the preview are one value seen twice: pick a file and the preview goes to its
  // page; follow a link in the preview and the file it was built from becomes the selection. The
  // second direction is what makes the preview browsable — without it, moving around the site
  // would leave the list pointing at somewhere you no longer are.
  const onNavigate = (event) => {
    const path = event.detail?.path;
    if (!path) return;
    // `pages` maps a source to the page it became; this is the question asked the other way.
    const source = [...pages].find(([, page]) => page === path)?.[0];
    if (!source || source === selected || !files.has(source)) return;
    selected = source;
    // Rendering re-asserts data-path, which is already where the preview is — site-viewer
    // ignores a request for the path it is showing, so this does not bounce back.
    render();
  };
  root.addEventListener("site-viewer:navigate", onNavigate);

  const onClick = (event) => {
    const page = event.target.closest(".cwe__page");
    if (page) {
      selected = page.dataset.path;
      return render();
    }
    if (event.target.closest('[data-act="rebuild"]')) build();
  };
  root.addEventListener("click", onClick);

  // The repo document changes when pushwork syncs, or when a page is added or removed.
  const onRepoChange = debounce(REBUILD_AFTER_QUIET_MS, () => build());
  handle.on("change", onRepoChange);

  render();
  build();

  return () => {
    handle.off("change", onRepoChange);
    watchAll([]);
    root.removeEventListener("click", onClick);
    root.removeEventListener("site-viewer:navigate", onNavigate);
    root.remove();
  };
}
