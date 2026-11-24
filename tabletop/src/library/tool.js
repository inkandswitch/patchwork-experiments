// patchwork:tool "game-library" — the launcher's page: a library's Games
// and Sessions (newest first), and New game, Continue, Fork, Import, Add the
// built-in games and Open as folder (actions.js; README.md, "The library").

import css from "../styles.css?inline";
import { gamesIn, sessionsIn } from "./model.js";
import { addBuiltIns, foldersFor, forkSession, importGame, startSession } from "./actions.js";
import { hostRegistry } from "../table/made-with.js";
import { DEFAULT_SETTINGS } from "../tts/settings.js";
import { optionsForm } from "../options-form.js";

const OPEN_EVENT = "patchwork:open-document";
const FOLDER_TOOL = "folder-viewer";

const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...children.flat().filter((c) => c != null));
  return n;
};

export default function GameLibraryTool(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "tabletop-game tabletop-library" });
  element.append(style, root);
  let dead = false;
  let busy = null; // what's being done now, for the status line (one thing at a time)
  let status = null; // the last thing done or failed, until the next
  let fetchNow = DEFAULT_SETTINGS.fetchNow;
  const chosen = new Map(); // a game's url → the options chosen for its next session (GAME-FORMAT.md §6)
  const choicesFor = (url) => (chosen.has(url) ? chosen.get(url) : chosen.set(url, {}).get(url));

  const open = (url, toolId) => element.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, toolId }, bubbles: true, composed: true }));

  // ─── the folders, and the docs they link ─────────────────────────────────
  let folders = { games: null, sessions: null };
  let foldersFound = false;
  const docs = new Map(); // url → its handle, once found (null: couldn't be)
  const watched = new Set();
  const watch = (h) => {
    if (!h || watched.has(h)) return;
    watched.add(h);
    h.on?.("change", render);
  };
  const docOf = (url) => {
    if (!docs.has(url)) {
      docs.set(url, undefined);
      Promise.resolve(repo?.find?.(url))
        .then((h) => {
          // read as it is when shown (a session's scene changes all through play: not watched)
          docs.set(url, h ?? null);
          render();
        })
        .catch(() => {
          docs.set(url, null);
          render();
        });
    }
    return docs.get(url)?.doc?.() ?? null;
  };
  async function findFolders() {
    folders = await foldersFor(repo, handle);
    foldersFound = true;
    watch(folders.games);
    watch(folders.sessions);
    render();
  }

  async function act(what, fn) {
    if (busy) return;
    busy = what;
    status = null;
    render();
    try {
      status = (await fn()) ?? null;
    } catch (err) {
      console.warn("[tabletop] library", err);
      status = `Couldn't ${what.toLowerCase().replace(/…$/, "")}: ${err?.message ?? err}`;
    } finally {
      busy = null;
      render();
    }
  }
  const phase = (text) => {
    busy = text;
    updateStatus();
  };

  const newGame = (link, d) =>
    act(`Setting up ${d?.title ?? link.name}…`, async () => {
      const game = await repo.find(link.url);
      const { url, notes } = await startSession({ repo, registry: hostRegistry, library: handle, game, options: { ...choicesFor(link.url) }, phase });
      open(url, "scene");
      return notes.length ? notes.join(" ") : null;
    });
  const fork = (link) =>
    act(`Forking ${link.name}…`, async () => {
      const { url, name } = await forkSession({ repo, registry: hostRegistry, library: handle, session: link });
      open(url, "scene");
      return `Forked as “${name}”.`;
    });
  const builtIns = () =>
    act("Adding the built-in games…", async () => {
      const made = await addBuiltIns({ repo, registry: hostRegistry, library: handle });
      return made.length ? `Added ${made.length} game${made.length === 1 ? "" : "s"}.` : "The built-in games are here already.";
    });
  const importFiles = (files) =>
    act("Importing…", async () => {
      const { sourcesFromFiles } = await import("../tts/inputs.js");
      const sources = await sourcesFromFiles(files);
      const { name, report } = await importGame({
        repo,
        library: handle,
        sources,
        settings: { ...DEFAULT_SETTINGS, fetchNow },
        fetch: globalThis.fetch?.bind(globalThis) ?? null,
        onProgress: (p) => phase(`Importing: ${p.phase}${p.total ? ` ${p.done} of ${p.total}` : ""}…`),
      });
      const a = report?.counts?.assets ?? {};
      return `Imported “${name}”: ${a.cache ?? 0} assets came with it, ${a.web ?? 0} fetched when first drawn${a.missing ? `, ${a.missing} missing` : ""}.`;
    });

  // ─── view ─────────────────────────────────────────────────────────────────
  function gameRow(link) {
    const d = docOf(link.url);
    const pick = d ? optionsForm(d, choicesFor(link.url), (k, v) => (choicesFor(link.url)[k] = v), link.name) : null;
    return el(
      "li",
      { class: "game" },
      el("div", { class: "what" }, el("strong", {}, d?.title || link.name), el("span", { class: "muted" }, d ? [d.players ? ` ${d.players} players` : "", d.origin?.tts ? " · from Tabletop Simulator" : ""].join("") : " …")),
      el(
        "div",
        { class: "cluster" },
        pick,
        el("button", { type: "button", class: "button primary", disabled: !!busy || !d, onclick: () => newGame(link, d) }, "New game"),
        el("button", { type: "button", class: "button", onclick: () => open(link.url, "tabletop-game") }, "About"),
      ),
    );
  }
  function sessionRow(link) {
    const d = docOf(link.url);
    const from = d?.forkedFrom?.url ? sessionsIn(folders.sessions?.doc?.() ?? {}).find((l) => l.url === d.forkedFrom.url)?.name : null;
    return el(
      "li",
      { class: "session" },
      el("div", { class: "what" }, el("span", {}, link.name), from ? el("span", { class: "muted" }, ` · forked from ${from}`) : null),
      el(
        "div",
        { class: "cluster" },
        el("button", { type: "button", class: "button primary", onclick: () => open(link.url, "scene") }, "Continue"),
        el("button", { type: "button", class: "button", disabled: !!busy, onclick: () => fork(link) }, "Fork"),
      ),
    );
  }

  function render() {
    if (dead) return;
    const lib = handle.doc() ?? {};
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    if (focused && focused.tagName === "INPUT" && focused.type === "text") return void updateStatus();
    const title = el("input", { type: "text", class: "title", value: lib.title ?? "", "aria-label": "Title", onchange: (e) => handle.change((d) => (d.title = e.target.value)) });
    const asFolder = el("button", { type: "button", class: "button", title: "Show this library in the folder tool", onclick: () => open(handle.url, FOLDER_TOOL) }, "Open as folder");
    const games = folders.games ? gamesIn(folders.games.doc()) : [];
    const sessions = folders.sessions ? sessionsIn(folders.sessions.doc()) : [];
    const file = el("input", {
      type: "file",
      multiple: true,
      class: "import-file",
      accept: ".json,.zip,.png,.jpg,.jpeg,.obj,image/*",
      disabled: !!busy || !folders.games,
      onchange: (e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) importFiles(files);
      },
    });
    const missing = foldersFound && (!folders.games || !folders.sessions);
    root.replaceChildren(
      ...[
        el("header", { class: "head" }, title, asFolder),
        el("p", { class: "status muted" }),
        missing ? el("p", {}, "This library is missing its Games or Sessions folder.") : null,
        el(
          "section",
          { class: "games-list" },
          el("h3", {}, "Games"),
          games.length ? el("ul", { class: "rows" }, games.map(gameRow)) : el("p", { class: "muted" }, foldersFound ? "No games yet." : "Looking…"),
          el(
            "div",
            { class: "cluster" },
            el("button", { type: "button", class: "button", disabled: !!busy || !folders.games, onclick: builtIns }, "Add the built-in games"),
            el("label", { class: "button file-button", title: "A Tabletop Simulator mod's .json (Mods/Workshop/<id>.json, or a save), with any of its cached assets, or a .zip of them" }, "Import a TTS mod…", file),
            el("label", { class: "toggle", title: "For playing offline; otherwise each asset is fetched when it's first drawn (many hosts refuse: CORS)" }, el("input", { type: "checkbox", checked: fetchNow, onchange: (e) => (fetchNow = e.target.checked) }), " Fetch every asset now"),
          ),
        ),
        el(
          "section",
          { class: "sessions-list" },
          el("h3", {}, "Sessions"),
          sessions.length ? el("ul", { class: "rows" }, sessions.map(sessionRow)) : el("p", { class: "muted" }, foldersFound ? "None yet: start a new game." : "Looking…"),
        ),
      ].filter(Boolean),
    );
    updateStatus();
  }
  function updateStatus() {
    const s = root.querySelector(".status");
    if (s) s.textContent = busy ?? status ?? "";
  }

  handle.on?.("change", render);
  render();
  findFolders().catch((err) => {
    status = `Couldn't open the library's folders: ${err?.message ?? err}`;
    foldersFound = true;
    render();
  });

  return () => {
    dead = true;
    handle.off?.("change", render);
    for (const h of watched) h.off?.("change", render);
    root.remove();
    style.remove();
  };
}
