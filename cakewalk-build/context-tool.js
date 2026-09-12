import { changesFor, collectSources, outputEntries } from "./build.js";
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

// pushwork sets lastSyncAt on the root folder doc when it has finished writing a sync, which is
// the signal to rebuild. Wait for quiet anyway: a sync of many files can land in pieces.
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
 * A `patchwork:component`: the host hands it an element and nothing else. The repo to build
 * comes from the selected-doc provider, and what it remembers from the tool-storage provider.
 */
export default function CakewalkBuildContextTool(element) {
  const repo = element.repo ?? window.repo;
  const root = document.createElement("div");
  root.className = "cwb";
  root.innerHTML = `
    <div class="cwb__bar">
      <span class="cwb__repo"></span>
      <button class="cwb__button" data-act="build" hidden>Build</button>
      <label class="cwb__auto" hidden><input type="checkbox" class="cwb__autobuild"> rebuild on sync</label>
      <span class="cwb__status"></span>
    </div>
    <div class="cwb__stage"></div>
    <details class="cwb__logbox" hidden><summary>Build log</summary><pre class="cwb__log"></pre></details>`;
  element.append(root);

  const repoLabel = root.querySelector(".cwb__repo");
  const buildButton = root.querySelector('[data-act="build"]');
  const autoLabel = root.querySelector(".cwb__auto");
  const autoBox = root.querySelector(".cwb__autobuild");
  const statusEl = root.querySelector(".cwb__status");
  const stage = root.querySelector(".cwb__stage");
  const logBox = root.querySelector(".cwb__logbox");
  const logEl = root.querySelector(".cwb__log");

  /** The document the user is looking at, and whether it is something we can build. */
  let sourceUrl;
  let sourceHandle;
  let isRepo = false;
  let whyNot = "Nothing selected";
  let storage; // the account-scoped doc the host creates for this tool
  let building = false;
  let watching = null; // the repo handle we listen to for syncs

  const record = (patch) => sourceUrl && storage && recordBuild(storage, sourceUrl, patch);
  const entry = () => buildFor(storage?.doc(), sourceUrl);

  async function build() {
    // Storage arrives over a port, so it can still be pending on a fast click.
    if (!sourceUrl || !isRepo || building || !storage) return;
    const url = sourceUrl; // the selection can move while a build runs
    building = true;
    record({ status: "building" });
    render();

    try {
      const { sources, origins } = await collectSources(repo, url);
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

      // One output document per repo, created once and then kept, so anything pointed at it
      // keeps working across builds.
      let outputUrl = buildFor(storage.doc(), url)?.outputUrl;
      if (!outputUrl) {
        const created = await repo.create2({ "@patchwork": { type: "directory" } });
        outputUrl = created.url;
        recordBuild(storage, url, { outputUrl });
      }

      const output = await repo.find(outputUrl);
      const entries = outputEntries(files, origins);
      const { set, remove } = changesFor(output.doc(), entries);

      output.change((d) => {
        d["@patchwork"] = { type: "directory" };
        for (const [path, value] of Object.entries(set)) d[path] = value;
        for (const path of remove) delete d[path];
      });

      recordBuild(storage, url, {
        status: "ok",
        lastBuiltAt: new Date().toISOString(),
        log: [
          `read ${sourceCount} files from the repo (${pageCount} pages under content/)`,
          `built ${Object.keys(files).length} files in ${Math.round(ms)}ms`,
          `wrote ${Object.keys(set).length} changed, removed ${remove.length}`,
          ...log,
        ],
      });
    } catch (err) {
      recordBuild(storage, url, { status: "error", log: [String((err && err.message) || err)] });
    } finally {
      building = false;
      render();
    }
  }

  const rebuildSoon = debounce(REBUILD_AFTER_QUIET_MS, () => {
    if (entry()?.autoBuild) build();
  });

  /** Listen to the repo itself, so a pushwork sync can trigger a rebuild. */
  function watchRepo(handle) {
    if (watching?.url === handle?.url) return;
    if (watching) watching.off("change", rebuildSoon);
    watching = null;
    if (!handle) return;
    handle.on("change", rebuildSoon);
    watching = handle;
  }

  // Selection changes are the main event: everything else follows from what is on screen.
  const onSelection = async (url) => {
    sourceUrl = url;
    sourceHandle = null;
    isRepo = false;
    whyNot = "Nothing selected";
    render();
    if (!url) return watchRepo(null);

    try {
      const handle = await repo.find(url);
      // The selection may have moved again while that resolved.
      if (sourceUrl !== url) return;
      sourceHandle = handle;
      const verdict = describeRepo(handle.doc());
      isRepo = verdict.buildable;
      whyNot = verdict.reason;
      watchRepo(isRepo ? handle : null);
    } catch {
      // A document that will not resolve is not a repo; the message below covers it.
    }
    render();
  };

  function render() {
    const build = entry();
    const status = build?.status ?? "idle";

    buildButton.hidden = !isRepo;
    autoLabel.hidden = !isRepo;
    buildButton.disabled = building || !storage;
    autoBox.checked = Boolean(build?.autoBuild);

    if (!isRepo) repoLabel.textContent = whyNot;
    else repoLabel.textContent = sourceHandle?.doc()?.title || "CakeWalk repo";

    const when = build?.lastBuiltAt ? ` · ${new Date(build.lastBuiltAt).toLocaleTimeString()}` : "";
    statusEl.textContent = !isRepo
      ? ""
      : { idle: "not built yet", building: "building…", ok: `built${when}`, error: "failed" }[status] ?? status;
    statusEl.dataset.status = status;

    const log = build?.log ?? [];
    logBox.hidden = !log.length;
    logEl.textContent = log.join("\n");
    // A failure is the one case where the log is the whole point, so do not make someone find it.
    if (status === "error") logBox.open = true;

    // The preview is whatever tool claims directory documents — site-viewer, if it is installed.
    // Looked up by id at render time, so this tool does not depend on that one.
    const outputUrl = build?.outputUrl;
    const view = stage.querySelector("patchwork-view");
    if (outputUrl && view?.getAttribute("doc-url") !== outputUrl) {
      stage.innerHTML = "";
      const el = document.createElement("patchwork-view");
      el.setAttribute("doc-url", outputUrl);
      el.setAttribute("tool-id", "site-viewer");
      stage.append(el);
    } else if (!outputUrl) {
      stage.innerHTML = `<p class="cwb__empty">${
        isRepo ? "Press Build to make this repo into a site." : "Select a pushworked CakeWalk repo."
      }</p>`;
    }
  }

  const onClick = (event) => {
    if (event.target.closest('[data-act="build"]')) build();
  };
  root.addEventListener("click", onClick);

  const onToggle = () => record({ autoBuild: autoBox.checked });
  autoBox.addEventListener("change", onToggle);

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

  render();

  return () => {
    stopSelection();
    stopStorage();
    storage?.off("change", onStorageChange);
    if (watching) watching.off("change", rebuildSoon);
    root.removeEventListener("click", onClick);
    autoBox.removeEventListener("change", onToggle);
    root.remove();
  };
}
