import { ImmutableString } from "@automerge/automerge";
import { collectSources, outputEntries, planWrite, repoTitle } from "./build.js";
import { previewPathFor } from "./preview.js";
import { describeRepo, onSelectedDoc, onToolStorage } from "./providers.js";
import { buildFor, recordBuild } from "./settings.js";

const STYLE_ID = "cakewalk-build-styles";
if (!document.getElementById(STYLE_ID)) {
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./styles.css", import.meta.url).href;
  document.head.appendChild(link);
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

  // From the last build: which file document is which source path, and what the build produced.
  // Together they answer "the document being edited is which page of the site".
  let sourceOfDoc = new Map();
  let builtPaths = new Set();

  let storage;
  let building = false;
  let dirty = false;
  let watched = new Set(); // handles we listen to for changes

  const record = (patch) => siteUrl && storage && recordBuild(storage, siteUrl, patch);
  const entry = () => buildFor(storage?.doc(), siteUrl);

  // ── watching ───────────────────────────────────────────────────────────────────────────────
  // Everything in the site, not just its root: a content edit changes that file's own document
  // and never touches the root, so watching the root alone would miss every edit made here.
  // The handles are already resolved by collectSources, so this costs little beyond the
  // listeners themselves.
  const rebuildSoon = debounce(REBUILD_AFTER_QUIET_MS, () => {
    if (entry()?.autoBuild) build();
  });

  function watchAll(handles) {
    for (const handle of watched) handle.off("change", rebuildSoon);
    watched = new Set(handles);
    for (const handle of watched) handle.on("change", rebuildSoon);
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
      const { sources, origins, index } = await collectSources(repo, url);
      sourceOfDoc = index;

      // Watch every file in the site plus its root. A content edit changes that file's own
      // document and never touches the root, so watching the root alone misses every edit made
      // here; the root still matters because that is where pushwork reports a sync.
      const handles = await Promise.all([url, ...index.keys()].map((u) => repo.find(u).catch(() => null)));
      watchAll(handles.filter(Boolean));
      const sourceCount = Object.keys(sources).length;
      const pageCount = Object.keys(sources).filter((p) => /^content\/.*\.(md|html)$/.test(p)).length;

      let buildSite;
      try {
        ({ buildSite } = await import(`/${encodeURIComponent(url)}/${BUNDLE}`));
      } catch (err) {
        throw new Error(
          `That repo has no ${BUNDLE} in it, so there is no build system to run. ` +
            `Run \`pnpm build:browser\` in the repo and sync it. (${err})`
        );
      }

      const { files, log, ms } = buildSite({
        sources,
        env: {
          // Every URL relative to the file it sits in. The document this writes to is addressed
          // by a URL with its own heads pinned on, so the mount point changes on every build.
          relativeUrls: true,
          // pushwork's file documents carry no modification time, so the sitemap's lastmod
          // would be the epoch for every page. Better to say nothing than a wrong date.
          useRealBuildDates: false,
        },
      });

      const entries = outputEntries(files, origins, { immutable: (text) => new ImmutableString(text) });
      builtPaths = new Set(Object.keys(entries));

      // ── writing only what moved ─────────────────────────────────────────────────────────
      // A one-page edit changes one page and the feed, so that is what gets written — not all
      // 45 files. Every such write does leave a version behind in the document's history, and
      // nobody wants the built site's history, so the document is replaced outright every
      // COMPACT_EVERY builds. That bounds the history without paying a full rewrite each time.
      const record0 = buildFor(storage.doc(), url) ?? {};
      const previousUrl = record0.outputUrl;
      let existing;
      if (previousUrl) {
        try {
          existing = (await repo.find(previousUrl)).doc();
        } catch {
          existing = undefined; // gone or unreachable: start again
        }
      }

      const plan = planWrite({ existing, entries, buildsSinceFresh: record0.buildsSinceFresh ?? 0 });
      let summary;

      if (plan.action === "skip") {
        summary = "nothing changed, left the document alone";
      } else if (plan.action === "replace") {
        const created = await repo.create2({ "@patchwork": { type: "directory" }, ...plan.set });
        recordBuild(storage, url, { outputUrl: created.url, buildsSinceFresh: 0 });
        summary = previousUrl
          ? `replaced the document (${Object.keys(plan.set).length} files, history discarded)`
          : `wrote a new document with ${Object.keys(plan.set).length} files`;
        // Only the one we replaced — anything else may be someone's open preview.
        if (previousUrl) {
          try { repo.delete(previousUrl) } catch {}
        }
      } else {
        const output = await repo.find(previousUrl);
        output.change((d) => {
          for (const [path, value] of Object.entries(plan.set)) d[path] = value;
          for (const path of plan.remove) delete d[path];
        });
        recordBuild(storage, url, { buildsSinceFresh: (record0.buildsSinceFresh ?? 0) + 1 });
        summary = `wrote ${Object.keys(plan.set).length} changed, removed ${plan.remove.length}`;
      }

      recordBuild(storage, url, {
        status: "ok",
        lastBuiltAt: new Date().toISOString(),
        log: [
          `read ${sourceCount} files from the repo (${pageCount} pages under content/)`,
          `built ${Object.keys(files).length} files in ${Math.round(ms)}ms`,
          summary,
          ...log,
        ],
      });
    } catch (err) {
      recordBuild(storage, url, { status: "error", log: [String((err && err.message) || err)] });
    } finally {
      building = false;
      render();
      // Something changed while we were building; go again.
      if (dirty && entry()?.autoBuild) rebuildSoon();
    }
  }

  // ── selection ──────────────────────────────────────────────────────────────────────────────
  const onSelection = async (url) => {
    selectedUrl = url;
    if (!url) {
      selectedReason = "Nothing selected";
      return render();
    }

    try {
      const handle = await repo.find(url);
      if (selectedUrl !== url) return; // moved again while resolving
      const verdict = describeRepo(handle.doc());
      selectedReason = verdict.reason;
      if (verdict.buildable) {
        // A repo: pin it.
        if (siteUrl !== url) {
          siteUrl = url;
          siteTitle = repoTitle(handle.doc());
          sourceOfDoc = new Map();
          builtPaths = new Set();
          watchAll([]);
        } else {
          siteTitle = repoTitle(handle.doc());
        }
      }
      // Anything else leaves the pinned site alone; render() works out whether it is a page
      // of that site and moves the preview there.
    } catch {
      // A document that will not resolve changes nothing.
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
    autoBox.checked = Boolean(build?.autoBuild);

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

    renderPreview(build?.outputUrl);
  }

  /**
   * The preview, pointed at the page for whatever is being edited.
   *
   * `data-path` is how site-viewer is told where to start — a late-bound convention, so this
   * tool works whether or not that one is installed.
   */
  function renderPreview(outputUrl) {
    if (!outputUrl) {
      stage.innerHTML = `<p class="cwb__empty">${
        siteUrl ? "Press Build to make this repo into a site." : "Select a pushworked CakeWalk repo."
      }</p>`;
      return;
    }

    const sourcePath = selectedUrl ? sourceOfDoc.get(selectedUrl) : undefined;
    const path = previewPathFor(sourcePath, builtPaths);

    let view = stage.querySelector("patchwork-view");
    if (!view || view.getAttribute("doc-url") !== outputUrl) {
      stage.innerHTML = "";
      view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", outputUrl);
      view.setAttribute("tool-id", "site-viewer");
      stage.append(view);
    }
    if (path && view.getAttribute("data-path") !== path) view.setAttribute("data-path", path);
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
  });

  const onClick = (event) => {
    if (event.target.closest('[data-act="build"]')) build();
    if (event.target.closest('[data-act="unpin"]')) {
      siteUrl = undefined;
      siteTitle = undefined;
      sourceOfDoc = new Map();
      builtPaths = new Set();
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
