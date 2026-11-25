// patchwork:tool "tts-import" — drop a Tabletop Simulator mod (its .json and
// the cached assets: files, a folder such as TTS's Mods/, or a .zip), watch it
// import, read the report, open the game it made (a tabletop-game: its page
// sets up tables).
//
// Dropping is this page's act: what was dropped exists only here, so the
// save and the files it uses are kept as file docs at once (dropped.js) and
// the import doc is set to ask for them (`request`, request.js). The import
// itself is work done through the task system (import-task.js, asked with
// doWork under a key naming this doc and that request): on the person's own
// queue when one of their machines serves it, so that it finishes when this
// page closes and two pages asking are one import; otherwise in this page.
// What is shown is decided in one place (status.js) from the doc and from
// whether that work is going on; an import asked of the person's queue from
// another tab or before a reload is followed by its key (watchWork) and
// shown, not offered again. One done in another page is not seen here.

import css from "./styles.css?inline";
import { DEFAULT_SETTINGS } from "./settings.js";
import { importAsk, importRequest, canonicalJson } from "./request.js";
import { shownStatus, underWay, workLines } from "./status.js";
import { doWork, inSamePackage, stopWork, watchWork } from "../kit/task-client.js";

const OPEN_EVENT = "patchwork:open-document";

// Vite sets this in the built package, whose import task is dist/import-task.js (vite.config.js)
const BUILT = import.meta.env?.PROD === true;

/**
 * Where the import's code is, as an import url both this page and a pool can
 * import: the package's own file, named by the package's url and not this
 * site's, when this module was loaded from a package in automerge; the file
 * beside this one when it runs unbuilt from anywhere else (tests, a dev
 * server); null when neither can be known, and the tool then calls it itself.
 */
export function importTaskUrl(here = import.meta.url, built = BUILT) {
  const inPackage = inSamePackage(here, built ? "dist/import-task.js" : "src/tts/import-task.js");
  if (inPackage || built) return inPackage;
  try {
    return new URL("./import-task.js", here).href;
  } catch {
    return null;
  }
}

/**
 * Does the import in this page by calling its module, for when there is no
 * url to import it by: with the same views as doWork's for work done here,
 * so that the tool shows it the same way.
 */
export async function callHere(repo, input, key, { onProgress, signal }) {
  const { default: importTask } = await import("./import-task.js");
  const logs = [];
  let progress = null;
  const view = (state, more = {}) => ({ key, state, taskUrl: null, importUrl: null, input, progress, logs: [...logs], result: undefined, error: null, runs: [], ...more });
  const ctx = {
    repo,
    signal,
    taskUrl: null,
    key,
    run: crypto.randomUUID(),
    log: (...a) => {
      logs.push({ timestampMillis: Date.now(), message: a.map(String).join(" ") });
      onProgress(view("running"));
    },
    progress: (v) => {
      progress = v;
      onProgress(view("running"));
    },
  };
  onProgress(view("running"));
  try {
    const result = await importTask(input, ctx);
    onProgress(view("succeeded", { result }));
    return result;
  } catch (err) {
    if (signal.aborted) {
      onProgress(view("cancelled"));
      throw new Error("The task was cancelled");
    }
    const error = String(err?.message ?? err);
    onProgress(view("failed", { error }));
    throw new Error(error);
  }
}

const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...children.flat().filter((c) => c != null && c !== false));
  return n;
};

/** Copy plain data out of an automerge doc (for settings passed to the importer). */
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

const PILL = { empty: "empty", looking: "…", importing: "importing", done: "imported", failed: "failed", stopped: "stopped", interrupted: "interrupted" };

export default function TtsImportTool(handle, element) {
  const repoOf = () => handle.repo ?? element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "tts-import" });
  element.append(style, root);
  let dead = false;
  let dropping = false;
  // this page's own import, the latest: { controller, view } (view: a Work, status.js), kept once it has ended
  let job = null;
  // the import under the doc's request's key, as watchWork has it: { request, key, view, stop },
  // its view undefined until watchWork first reports (within the task system's lapse)
  let seen = null;

  const doc = () => handle.doc() ?? {};
  const settings = () => ({ ...DEFAULT_SETTINGS, ...plain(doc().settings) });

  function open(url, toolId) {
    element.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, toolId }, bubbles: true, composed: true }));
  }

  /** The work this page knows of for the doc's request (status.js's Work): its own, or the one followed. */
  function work() {
    const id = doc().request?.id ?? null;
    const own = job && (job.view.request === null || job.view.request === id) ? job.view : null;
    if (own && underWay(own.state)) return own;
    const watched = id && seen?.request === id ? (seen.view === undefined ? undefined : seen.view.state !== "missing" ? { ...seen.view, request: id } : null) : undefined;
    if (watched && underWay(watched.state)) return watched;
    return own ?? watched;
  }

  const shown = () => shownStatus(doc(), work());
  const busy = () => ["importing", "looking"].includes(shown().status);

  // ─── following the doc's request ──────────────────────────────────────────
  function follow() {
    const request = doc().request ?? null;
    const id = request?.id ?? null;
    if ((seen?.request ?? null) === id) return;
    seen?.stop();
    seen = null;
    if (!id) return;
    const followed = (seen = { request: id, key: importAsk(handle.url, request).key, view: undefined, stop: () => {} });
    followed.stop = watchWork(repoOf(), followed.key, (view) => {
      if (dead || seen !== followed) return;
      followed.view = view;
      update();
    });
  }

  // ─── running an import ────────────────────────────────────────────────────
  /** Starts an import of the request `makeRequest` makes (keeping what was dropped first, for a drop). */
  async function start(makeRequest) {
    if (busy()) return;
    const controller = new AbortController();
    const mine = (job = { controller, view: { request: null, state: "running", progress: { phase: "Reading what was dropped", done: 0, total: 0 }, logs: [], taskUrl: null } });
    const show = (view) => {
      if (job !== mine) return;
      mine.view = view;
      update();
    };
    update();
    try {
      const request = await makeRequest((p) => show({ ...mine.view, progress: p }), controller.signal);
      controller.signal.throwIfAborted();
      if (canonicalJson(doc().request ?? null) !== canonicalJson(request)) handle.change((d) => (d.request = plain(request)));
      show({ request: request.id, state: "starting", progress: null, logs: [], taskUrl: null });
      const { input, key } = importAsk(handle.url, request);
      const importUrl = importTaskUrl();
      const onProgress = (view) => show({ ...view, request: request.id });
      if (importUrl) await doWork(repoOf(), { importUrl, input, key }, { signal: controller.signal, onProgress });
      else await callHere(repoOf(), input, key, { signal: controller.signal, onProgress });
    } catch (err) {
      // the views have said how the work ended; what ended before any did (keeping the files, or a stop while deciding) is said here
      if (underWay(mine.view.state)) show({ ...mine.view, state: controller.signal.aborted ? "cancelled" : "failed", error: String(err?.message ?? err) });
    } finally {
      update();
    }
  }

  const keepDropped = (getSources) => async (onProgress, signal) => {
    const sources = await getSources();
    const { storeDropped } = await import("./dropped.js");
    const files = await storeDropped(repoOf(), sources, { onProgress, signal });
    return importRequest(files, settings());
  };

  const importAgain = () => start(async () => importRequest(doc().request.files, settings()));

  function stop() {
    const w = work();
    if (!w || !underWay(w.state)) return;
    if (job && job.view === w) job.controller.abort();
    else if (seen) void stopWork(repoOf(), seen.key);
  }

  const fromDrop = (dt) => {
    // entries must be taken before the first await
    const pending = import("./inputs.js");
    const items = [...(dt.items ?? [])].map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() : null)).filter(Boolean);
    const files = [...(dt.files ?? [])];
    return async () => {
      const m = await pending;
      if (items.length) return m.sourcesFromEntries(items);
      return m.sourcesFromFiles(files);
    };
  };

  // ─── drop zone ────────────────────────────────────────────────────────────
  const onDragOver = (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files") || busy()) return;
    e.preventDefault();
    if (!dropping) {
      dropping = true;
      root.dataset.dropping = "";
    }
  };
  const onDragLeave = (e) => {
    if (e.relatedTarget && root.contains(e.relatedTarget)) return;
    dropping = false;
    delete root.dataset.dropping;
  };
  const onDrop = (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
    e.preventDefault();
    dropping = false;
    delete root.dataset.dropping;
    if (!busy()) start(keepDropped(fromDrop(e.dataTransfer)));
  };
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);

  const picker = (folder) =>
    el("input", {
      type: "file",
      multiple: true,
      hidden: true,
      ...(folder ? { webkitdirectory: true } : {}),
      onchange: (e) => {
        const files = [...e.target.files];
        start(keepDropped(async () => (await import("./inputs.js")).sourcesFromFiles(files)));
      },
    });

  // ─── view ─────────────────────────────────────────────────────────────────
  let progressEl = null;
  function renderProgress(w) {
    if (!progressEl) return;
    const { stage, where, done, total } = workLines(w);
    progressEl.replaceChildren(
      el("div", { class: "phase" }, stage),
      el("progress", { max: total || 1, value: total ? done : null }),
      el("div", { class: "row" }, el("button", { class: "cancel", onclick: stop }, "Cancel"), where ? el("span", { class: "muted where" }, where) : null),
    );
  }

  function settingsPanel(disabled) {
    const s = settings();
    const set = (k, v) =>
      handle.change((d) => {
        if (!d.settings) d.settings = {};
        d.settings[k] = v;
      });
    const check = (k, label, hint) =>
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: !!s[k], disabled, onchange: (e) => set(k, e.target.checked) }), el("span", {}, label), hint ? el("small", {}, hint) : null);
    return el(
      "details",
      { class: "settings" },
      el("summary", {}, "Settings"),
      el(
        "div",
        { class: "grid" },
        el("label", { class: "field" }, el("span", {}, "One TTS unit is"), el("input", { type: "number", step: "0.0001", min: "0.001", value: String(s.metresPerUnit), disabled, onchange: (e) => Number(e.target.value) > 0 && set("metresPerUnit", Number(e.target.value)) }), el("small", {}, "metres (0.0254: an inch)")),
        check("includeContents", "Bring in what's in bags", "each bag holds what it held in TTS"),
        check("fetchNow", "Fetch every asset now", "for playing offline; otherwise each is fetched when it's first drawn (many hosts refuse: CORS)"),
        check("flipObjX", "Mirror OBJ models in x", "as TTS (Unity) does when it loads them"),
      ),
    );
  }

  function dropZone() {
    const files = picker(false);
    const folder = picker(true);
    return el(
      "div",
      { class: "drop" },
      el("div", { class: "drop-title" }, "Drop a Tabletop Simulator mod here"),
      el(
        "p",
        {},
        "The mod's ",
        el("code", {}, ".json"),
        " (Mods/Workshop/<id>.json, or a save from Saves/) together with its cached assets: the files, a folder (TTS's whole ",
        el("code", {}, "Mods"),
        " folder is fine — only what the mod uses is kept), or a ",
        el("code", {}, ".zip"),
        ".",
      ),
      el("div", { class: "row" }, el("button", { onclick: () => files.click() }, "Choose files…"), el("button", { onclick: () => folder.click() }, "Choose a folder…"), files, folder),
      el("p", { class: "muted" }, "Scripts (Lua, XML UI) are not imported."),
    );
  }

  const table = (head, rows) => el("table", {}, el("thead", {}, el("tr", {}, ...head.map((h) => el("th", {}, h)))), el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c) => el("td", {}, c))))));

  function reportView(r, gameUrl) {
    const c = r.counts ?? {};
    const a = c.assets ?? {};
    const missing = Object.values(r.assets ?? {}).filter((x) => !x.source || x.error);
    const stat = (n, label) => el("div", { class: "stat" }, el("b", {}, String(n ?? 0)), el("span", {}, label));
    const byName = Object.entries(c.byName ?? {}).sort((x, y) => y[1] - x[1]);
    return el(
      "div",
      { class: "report" },
      el(
        "div",
        { class: "row" },
        el("div", { class: "mod" }, el("div", { class: "mod-name" }, r.mod?.saveName ?? "Mod"), el("div", { class: "muted" }, r.mod?.fileName ?? "")),
        gameUrl ? el("button", { class: "primary", onclick: () => open(gameUrl, "tabletop-game") }, "Open the game") : null,
      ),
      el(
        "div",
        { class: "stats" },
        stat(r.mod?.objects, "objects in the mod"),
        stat(c.placed, "in the game"),
        stat(c.pieces, "kinds of piece"),
        stat(c.cards, `cards (${c.decks ?? 0} decks)`),
        stat(c.bags, "bags"),
        stat(c.dice, "dice"),
        stat(c.states, "other states"),
        stat(a.cache, "assets from the cache"),
        stat(a.fetched, "fetched"),
        stat(a.web, "fetched when first drawn"),
        stat(a.missing, "missing"),
        stat(c.seats, "seats"),
      ),
      missing.length
        ? el(
            "section",
            {},
            el("h3", {}, `Missing assets (${missing.length})`),
            el("p", { class: "muted" }, "Whatever uses these is drawn without them: plain colour, or a see-through stand-in for a model."),
            table(["used by", "url", "why"], missing.map((m) => [m.usedBy?.join(", ") || "—", el("code", { class: "url" }, m.url), m.error ?? ""])),
          )
        : el("p", { class: "ok" }, "Every asset was found."),
      Object.keys(c.skipped ?? {}).length || Object.keys(c.approximated ?? {}).length
        ? el(
            "section",
            {},
            el("h3", {}, "Not drawn as they are"),
            table(
              ["object", "count", ""],
              [
                ...Object.entries(c.skipped ?? {}).map(([k, n]) => [k, String(n), "left out"]),
                ...Object.entries(c.approximated ?? {}).map(([k, n]) => [k, String(n), "a stand-in shape"]),
              ],
            ),
          )
        : null,
      r.warnings?.length ? el("section", {}, el("h3", {}, "Warnings"), el("ul", {}, ...r.warnings.map((w) => el("li", {}, w)))) : null,

      el("details", {}, el("summary", {}, `Objects in the mod, by type (${byName.length})`), table(["TTS name", "count"], byName.map(([k, n]) => [k, String(n)]))),
    );
  }

  function render(s) {
    const d = doc();
    progressEl = null;
    const going = s.status === "importing" || s.status === "looking";
    const parts = [el("div", { class: "head" }, el("div", { class: "title" }, d.title || "TTS import"), el("span", { class: "pill", "data-status": s.status === "failed" ? "error" : s.status }, PILL[s.status]))];
    if (s.status === "importing") {
      progressEl = el("div", { class: "progress" });
      parts.push(progressEl);
    }
    if (s.status === "failed") parts.push(el("div", { class: "error" }, s.line));
    else if (s.line && s.status !== "done") parts.push(el("p", { class: "muted note" }, s.line));
    if (s.status === "done") {
      if (s.report) parts.push(reportView(s.report, s.gameUrl));
      else parts.push(el("div", { class: "row" }, el("span", { class: "muted note" }, s.line ?? ""), el("button", { class: "primary", onclick: () => open(s.gameUrl, "tabletop-game") }, "Open the game")));
    }
    // the kept files again, with the settings as they are now: after an import that did not finish, or with other settings
    const again = !going && !!d.request?.files?.length && (s.status !== "done" || canonicalJson(d.request.settings) !== canonicalJson(settings()));
    if (again) parts.push(el("div", { class: "row" }, el("button", { class: "again", onclick: importAgain }, s.status === "done" ? "Import again with these settings" : "Import again"), el("span", { class: "muted" }, `the files kept from the last drop (${d.request.files.length})`)));
    if (!going) parts.push(dropZone());
    if (s.status === "done" && Array.isArray(d.games) && d.games.length > 1) parts.push(el("details", {}, el("summary", {}, `Earlier imports (${d.games.length - 1})`), el("ul", {}, ...d.games.slice(0, -1).map((u, i) => el("li", {}, el("a", { href: "#", onclick: (e) => (e.preventDefault(), open(u, "tabletop-game")) }, `Game ${i + 1}`))))));
    parts.push(settingsPanel(going));
    root.replaceChildren(...parts);
    renderProgress(s.work);
  }

  // what the last full render showed: while it stays the same only the progress is redrawn
  let rendered = null;
  function update() {
    if (dead) return;
    follow();
    const s = shown();
    const d = doc();
    const shape = canonicalJson({ status: s.status, line: s.line ?? null, gameUrl: s.gameUrl ?? null, report: !!s.report, title: d.title ?? null, settings: d.settings ?? null, request: d.request?.id ?? null, games: d.games?.length ?? 0 });
    if (shape === rendered) return renderProgress(s.work);
    rendered = shape;
    render(s);
  }

  update();
  handle.on("change", update);

  return () => {
    dead = true;
    // work done in this page (or not yet asked of a queue) ends with it; work on the person's queue goes on
    if (job && underWay(job.view.state) && !job.view.taskUrl) job.controller.abort();
    seen?.stop();
    handle.off("change", update);
    root.removeEventListener("dragover", onDragOver);
    root.removeEventListener("dragleave", onDragLeave);
    root.removeEventListener("drop", onDrop);
    root.remove();
    style.remove();
  };
}
