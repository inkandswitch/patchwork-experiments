import { ImmutableString } from "@automerge/automerge";
import { repoTitle } from "./build.js";
import { buildInto, summarise } from "./builder.js";
import { describeRepo, onSelectedDoc, onToolStorage } from "./providers.js";
import { buildFor, recordBuild } from "./settings.js";

console.info("cakewalk-build loaded from", import.meta.url);

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

// A sync of many files lands in pieces, and typing produces a change per keystroke. Wait for
// quiet rather than building on each one.
const REBUILD_AFTER_QUIET_MS = 600;

// The site's own build system, loaded out of the repo being built. Each CakeWalk site carries
// its own — they are forks of a starter, not users of a library.
const BUNDLE = "dist/site-build.js";

const debounce = (ms, fn) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

/**
 * A `patchwork:component`: the host hands it an element and nothing else. The site comes from
 * the selected-doc provider, and what it remembers from the tool-storage provider.
 */
export default function CakewalkBuildContextTool(element) {
  const repo = element.repo ?? window.repo;

  const root = document.createElement("div");
  root.className = "cwb";
  root.innerHTML = `
    <div class="cwb__bar">
      <span class="cwb__repo"></span>
      <button class="cwb__button" data-act="unpin" title="Stop building this site" hidden>×</button>
      <button class="cwb__button" data-act="build" hidden>Build</button>
      <label class="cwb__auto" hidden><input type="checkbox" class="cwb__autobuild"> rebuild on change</label>
      <span class="cwb__status"></span>
    </div>
    <div class="cwb__stage"></div>
    <details class="cwb__logbox" hidden><summary>Build log</summary><pre class="cwb__log"></pre></details>`;
  element.append(root);

  const repoLabel = root.querySelector(".cwb__repo");
  const unpinButton = root.querySelector('[data-act="unpin"]');
  const buildButton = root.querySelector('[data-act="build"]');
  const autoLabel = root.querySelector(".cwb__auto");
  const autoBox = root.querySelector(".cwb__autobuild");
  const statusEl = root.querySelector(".cwb__status");
  const stage = root.querySelector(".cwb__stage");
  const logBox = root.querySelector(".cwb__logbox");
  const logEl = root.querySelector(".cwb__log");

  // ── the pinned site ────────────────────────────────────────────────────────────────────────
  // Selecting a repo pins it. Selecting anything else leaves it pinned — which is the whole
  // point: you cannot edit a page and have its repo selected at the same time, because editing
  // is what takes the selection.
  let siteUrl;
  let siteTitle;
  let selectedUrl;
  let selectedReason = "Nothing selected";

  // From the last build: which source path each document is, and which page each source became.
  // Together they answer "the document being edited is which page of the site" — both given by
  // the build rather than worked out from its output.
  let sourceOfDoc = new Map();
  let pageOfSource = new Map();

  let storage;
  /** Has the site we are pointed at been built since we picked it up? */
  let adopted = false;
  let building = false;
  let dirty = false;
  let watched = new Set(); // handles we listen to for changes

  const record = (patch) => siteUrl && storage && recordBuild(storage, siteUrl, patch);
  const entry = () => buildFor(storage?.doc(), siteUrl);

  // ── watching and rebuilding ────────────────────────────────────────────────────────────────
  // On unless someone turns it off. A warm rebuild is about 50ms end to end — reading the repo
  // out of Automerge costs 1-3ms once the documents are resolved — so there is no reason to make
  // anyone ask for it.
  const autoBuildFor = (record) => record?.autoBuild !== false;

  const rebuildSoon = debounce(REBUILD_AFTER_QUIET_MS, () => {
    if (autoBuildFor(entry())) build();
  });

  function watchAll(handles) {
    for (const handle of watched) handle.off("change", rebuildSoon);
    watched = new Set(handles);
    for (const handle of watched) handle.on("change", rebuildSoon);
  }

  /**
   * Build the site we have just adopted.
   *
   * Not an optimisation — it is what arms the watching. Every source document is subscribed to
   * as part of a build, so a tool that mounts without building never hears about an edit, and
   * nothing happens until someone presses the button. Building on adoption makes "pointed at a
   * site with auto-build on" mean "kept built", which is the only rule worth having.
   *
   * An unchanged rebuild writes nothing, so the cost of being wrong here is one compile.
   */
  function ensureBuilt() {
    if (adopted || !siteUrl || !storage) return;
    if (!autoBuildFor(entry())) return;
    adopted = true;
    build();
  }

  // ── building ───────────────────────────────────────────────────────────────────────────────
  async function build() {
    // Storage arrives over a port, so it can still be pending on a fast click.
    if (!siteUrl || !storage) return;
    if (building) {
      // Coalesce rather than drop. Dropping loses the last keystroke of a burst, which is
      // exactly the change you wanted to see.
      dirty = true;
      return;
    }
    building = true;
    dirty = false;
    const url = siteUrl; // the selection can move while a build runs
    record({ status: "building" });
    render();

    try {
      const result = await buildInto(repo, url, { immutable: (text) => new ImmutableString(text) });
      sourceOfDoc = result.sourceOfDocument;
      pageOfSource = result.pages;

      // Watch every file in the site plus its root. A content edit changes that file's own
      // document and never touches the root; the root still matters because that is where
      // pushwork reports a sync. The handles are already resolved by the read, so this costs
      // little beyond the listeners.
      const handles = await Promise.all(
        [url, ...result.sourceOfDocument.keys()].map((u) => repo.find(u).catch(() => null))
      );
      watchAll(handles.filter(Boolean));

      recordBuild(storage, url, {
        status: "ok",
        lastBuiltAt: new Date().toISOString(),
        log: [
          `read ${result.files.size} files from the repo in ${Math.round(result.readMs)}ms (${result.pageCount} pages under content/)`,
          `built ${result.builtCount} files in ${Math.round(result.buildMs)}ms`,
          `${summarise(result)} in ${Math.round(result.writeMs)}ms`,
          ...result.log,
        ],
      });
    } catch (err) {
      recordBuild(storage, url, { status: "error", log: [String((err && err.message) || err)] });
    } finally {
      building = false;
      render();
      // Something changed while we were building; go again.
      if (dirty && autoBuildFor(entry())) rebuildSoon();
    }
  }

  // ── selection ──────────────────────────────────────────────────────────────────────────────
  const onSelection = async (url) => {
    selectedUrl = url;
    if (!url) {
      selectedReason = "Nothing selected";
      return render();
    }

    // Only the lookup is allowed to fail quietly. An earlier version wrapped everything below
    // in the same catch, so a missing import surfaced as a repo with no name rather than as an
    // error — a broad catch turns a bug into a shrug.
    let handle;
    try {
      handle = await repo.find(url);
    } catch {
      selectedReason = "Not a CakeWalk repo";
      return render();
    }
    if (selectedUrl !== url) return; // moved again while resolving

    const verdict = describeRepo(handle.doc());
    selectedReason = verdict.reason;
    if (verdict.buildable) {
      // A repo: pin it. Anything else leaves the pinned site alone, and render() works out
      // whether it is a page of that site and moves the preview there.
      if (siteUrl !== url) {
        siteUrl = url;
        sourceOfDoc = new Map();
        pageOfSource = new Map();
        watchAll([]);
        adopted = false;
      }
      siteTitle = repoTitle(handle.doc());
      ensureBuilt();
    }
    render();
  };

  // ── rendering ──────────────────────────────────────────────────────────────────────────────
  function render() {
    const build = entry();
    const status = build?.status ?? "idle";
    const pinned = Boolean(siteUrl);

    buildButton.hidden = !pinned;
    unpinButton.hidden = !pinned;
    autoLabel.hidden = !pinned;
    buildButton.disabled = building || !storage;
    autoBox.checked = autoBuildFor(build);

    if (!pinned) {
      repoLabel.textContent = selectedReason;
    } else {
      const sourcePath = selectedUrl && selectedUrl !== siteUrl ? sourceOfDoc.get(selectedUrl) : undefined;
      repoLabel.textContent = sourcePath ? `${siteTitle ?? "site"} — ${sourcePath}` : siteTitle ?? "CakeWalk repo";
    }

    const when = build?.lastBuiltAt ? ` · ${new Date(build.lastBuiltAt).toLocaleTimeString()}` : "";
    statusEl.textContent = !pinned
      ? ""
      : { idle: "not built yet", building: "building…", ok: `built${when}`, error: "failed" }[status] ?? status;
    statusEl.dataset.status = status;

    const log = build?.log ?? [];
    logBox.hidden = !log.length;
    logEl.textContent = log.join("\n");
    // A failure is the one case where the log is the whole point, so do not make someone find it.
    if (status === "error") logBox.open = true;

    renderPreview(Boolean(build?.lastBuiltAt));
  }

  /**
   * The preview, pointed at the page for whatever is being edited.
   *
   * `data-path` is how site-viewer is told where to start — a late-bound convention, so this
   * tool works whether or not that one is installed.
   */
  function renderPreview(hasBuilt) {
    if (!siteUrl || !hasBuilt) {
      stage.innerHTML = `<p class="cwb__empty">${
        siteUrl ? "Press Build to make this repo into a site." : "Select a pushworked CakeWalk repo."
      }</p>`;
      return;
    }

    // Which page the document being edited became — the build said so, so there is nothing to
    // work out here. Relative to the site's own root; where that site lives is site-viewer's job.
    const sourcePath = selectedUrl ? sourceOfDoc.get(selectedUrl) : undefined;
    const path = pageOfSource.get(sourcePath) ?? "index.html";

    // The repo document IS the site now — the built pages live inside it under public/ — so the
    // preview points at the repo and says which page to open.
    let view = stage.querySelector("patchwork-view");
    if (!view || view.getAttribute("doc-url") !== siteUrl) {
      stage.innerHTML = "";
      view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", siteUrl);
      view.setAttribute("tool-id", "site-viewer");
      stage.append(view);
    }
    if (view.getAttribute("data-path") !== path) view.setAttribute("data-path", path);
  }

  // ── wiring ─────────────────────────────────────────────────────────────────────────────────
  const onStorageChange = () => render();

  const stopSelection = onSelectedDoc(element, onSelection);

  // The host creates this document the first time it is asked for, so it arrives a beat later
  // than the first render — which is why Build is disabled until it does.
  const stopStorage = onToolStorage(element, "cakewalk-build", async (url) => {
    if (!url || storage?.url === url) return;
    storage?.off("change", onStorageChange);
    storage = await repo.find(url);
    storage.on("change", onStorageChange);
    render();
    ensureBuilt();
  });

  const onClick = (event) => {
    if (event.target.closest('[data-act="build"]')) build();
    if (event.target.closest('[data-act="unpin"]')) {
      siteUrl = undefined;
      siteTitle = undefined;
      sourceOfDoc = new Map();
      pageOfSource = new Map();
      watchAll([]);
      render();
    }
  };
  root.addEventListener("click", onClick);

  const onToggle = () => record({ autoBuild: autoBox.checked });
  autoBox.addEventListener("change", onToggle);

  render();

  return () => {
    stopSelection();
    stopStorage();
    storage?.off("change", onStorageChange);
    watchAll([]);
    root.removeEventListener("click", onClick);
    autoBox.removeEventListener("change", onToggle);
    root.remove();
  };
}
