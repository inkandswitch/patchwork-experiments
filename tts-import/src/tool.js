// patchwork:tool "tts-import" — drop a Tabletop Simulator mod (its .json and
// the cached assets: files, a folder such as TTS's Mods/, or a .zip), watch it
// import, read the report, open the scene.

import css from "./styles.css?inline";
import { DEFAULT_SETTINGS } from "./settings.js";

const OPEN_EVENT = "patchwork:open-document";

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

const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/** Copy plain data out of an automerge doc (for settings passed to the importer). */
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

export default function TtsImportTool(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = el("div", { class: "tts-import" });
  element.append(style, root);
  let dead = false;
  let busy = false;
  let local = null; // this browser's own progress line (between doc writes)
  let dropping = false;

  const doc = () => handle.doc() ?? {};
  const settings = () => ({ ...DEFAULT_SETTINGS, ...plain(doc().settings) });

  function open(url, toolId) {
    element.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, toolId }, bubbles: true, composed: true }));
  }

  // ─── running an import ────────────────────────────────────────────────────
  async function run(getSources) {
    if (busy) return;
    busy = true;
    local = { phase: "Reading what was dropped", done: 0, total: 0 };
    render();
    let lastWrite = 0;
    const write = (p, force = false) => {
      local = p;
      if (!dead) renderProgress();
      const now = Date.now();
      if (!force && now - lastWrite < 400) return;
      lastWrite = now;
      handle.change((d) => {
        d.progress = { phase: p.phase, done: p.done, total: p.total };
      });
    };
    try {
      const sources = await getSources();
      handle.change((d) => {
        d.status = "importing";
        d.error = null;
        d.progress = { phase: `Dropped ${sources.length} files`, done: 0, total: 0 };
      });
      const [{ runImport }, { canvasImages }] = await Promise.all([import("./importer.js"), import("./images.js")]);
      const { sceneUrl, report } = await runImport({
        sources,
        repo,
        images: canvasImages(),
        fetch: globalThis.fetch?.bind(globalThis),
        settings: settings(),
        onProgress: (p) => write(p, p.phase === "Done"),
        infoUrl: handle.url,
        infoToolId: "tts-import",
      });
      handle.change((d) => {
        d.status = "done";
        d.progress = null;
        d.report = report;
        d.sceneUrl = sceneUrl;
        if (!Array.isArray(d.scenes)) d.scenes = [];
        d.scenes.push(sceneUrl);
        if (!d.title || d.title === "TTS import") d.title = `${report.mod.saveName} (TTS)`;
      });
    } catch (err) {
      console.error("[tts-import]", err);
      handle.change((d) => {
        d.status = "error";
        d.error = String(err?.message ?? err);
        d.progress = null;
      });
    } finally {
      busy = false;
      local = null;
      if (!dead) render();
    }
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
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
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
    run(fromDrop(e.dataTransfer));
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
        run(async () => (await import("./inputs.js")).sourcesFromFiles(files));
      },
    });

  // ─── view ─────────────────────────────────────────────────────────────────
  let progressEl = null;
  function renderProgress() {
    if (!progressEl) return;
    const p = local ?? doc().progress;
    progressEl.replaceChildren(
      el("div", { class: "phase" }, p?.phase ?? "Working…", p?.total ? ` — ${p.done} of ${p.total}` : ""),
      el("progress", { max: p?.total || 1, value: p?.total ? p.done : null }),
    );
  }

  function settingsPanel() {
    const s = settings();
    const set = (k, v) => handle.change((d) => {
      if (!d.settings) d.settings = {};
      d.settings[k] = v;
    });
    const check = (k, label, hint) =>
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: !!s[k], disabled: busy, onchange: (e) => set(k, e.target.checked) }), el("span", {}, label), hint ? el("small", {}, hint) : null);
    return el(
      "details",
      { class: "settings" },
      el("summary", {}, "Settings"),
      el(
        "div",
        { class: "grid" },
        el("label", { class: "field" }, el("span", {}, "One TTS unit is"), el("input", { type: "number", step: "0.0001", min: "0.001", value: String(s.metresPerUnit), disabled: busy, onchange: (e) => Number(e.target.value) > 0 && set("metresPerUnit", Number(e.target.value)) }), el("small", {}, "metres (0.0254: an inch)")),
        el(
          "label",
          { class: "field" },
          el("span", {}, "Card faces up to"),
          el("select", { disabled: busy, onchange: (e) => set("cardTexture", Number(e.target.value)) }, ...[256, 512, 1024].map((v) => el("option", { value: String(v), selected: s.cardTexture === v }, `${v} px`))),
        ),
        check("includeContents", "Bring in what's in bags", "as hidden groups beside each bag"),
        check("hideFaceDown", "Face-down cards are hidden", "the scene shows their backs"),
        check("fetchMissing", "Fetch what wasn't dropped", "from the web; many hosts refuse (CORS)"),
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
        " folder is fine — only what the mod uses is read), or a ",
        el("code", {}, ".zip"),
        ".",
      ),
      el("div", { class: "row" }, el("button", { disabled: busy, onclick: () => files.click() }, "Choose files…"), el("button", { disabled: busy, onclick: () => folder.click() }, "Choose a folder…"), files, folder),
      el("p", { class: "muted" }, "Scripts (Lua, XML UI) are not imported."),
    );
  }

  const table = (head, rows) => el("table", {}, el("thead", {}, el("tr", {}, ...head.map((h) => el("th", {}, h)))), el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((c) => el("td", {}, c))))));

  function reportView(r, sceneUrl) {
    const c = r.counts ?? {};
    const a = c.assets ?? {};
    const missing = Object.values(r.assets ?? {}).filter((x) => !x.source);
    const stat = (n, label) => el("div", { class: "stat" }, el("b", {}, String(n ?? 0)), el("span", {}, label));
    const kinds = Object.values(r.kinds ?? {}).sort((x, y) => (y.copies ?? 0) - (x.copies ?? 0));
    const byName = Object.entries(c.byName ?? {}).sort((x, y) => y[1] - x[1]);
    return el(
      "div",
      { class: "report" },
      el(
        "div",
        { class: "row" },
        el("div", { class: "mod" }, el("div", { class: "mod-name" }, r.mod?.saveName ?? "Mod"), el("div", { class: "muted" }, r.mod?.fileName ?? "")),
        sceneUrl ? el("button", { class: "primary", onclick: () => open(sceneUrl, "scene") }, "Open the table") : null,
      ),
      el(
        "div",
        { class: "stats" },
        stat(r.mod?.objects, "objects in the mod"),
        stat(c.placed, "on the table"),
        stat(c.hidden, "hidden cards"),
        stat(c.kinds, `pieces drawn (${kb(c.glbBytes ?? 0)})`),
        stat(a.cache, "assets from the cache"),
        stat(a.fetched, "fetched"),
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
      Object.keys(r.notes ?? {}).length ? el("details", {}, el("summary", {}, `Notes (${Object.keys(r.notes).length})`), el("ul", {}, ...Object.entries(r.notes).map(([n, k]) => el("li", {}, `${n} (${k}×)`)))) : null,
      el(
        "details",
        {},
        el("summary", {}, `Pieces drawn (${kinds.length})`),
        table(
          ["piece", "type", "copies", "size"],
          kinds.map((k) => [k.glbUrl ? el("a", { href: "#", onclick: (e) => (e.preventDefault(), open(k.glbUrl)) }, k.name) : `${k.name} ✕`, k.type, String(k.copies ?? 0), k.bytes ? kb(k.bytes) : k.error ?? ""]),
        ),
      ),
      el("details", {}, el("summary", {}, `Objects in the mod, by type (${byName.length})`), table(["TTS name", "count"], byName.map(([k, n]) => [k, String(n)]))),
    );
  }

  function render() {
    if (dead) return;
    const d = doc();
    progressEl = null;
    const importing = busy || d.status === "importing";
    const parts = [el("div", { class: "head" }, el("div", { class: "title" }, d.title || "TTS import"), el("span", { class: "pill", "data-status": importing ? "importing" : d.status ?? "empty" }, importing ? "importing" : d.status === "done" ? "imported" : d.status === "error" ? "failed" : "empty"))];
    if (importing) {
      progressEl = el("div", { class: "progress" });
      parts.push(progressEl);
    }
    if (d.status === "error" && d.error && !busy) parts.push(el("div", { class: "error" }, d.error));
    if (d.report && !busy) parts.push(reportView(d.report, d.sceneUrl));
    if (!importing) parts.push(dropZone());
    if (d.report && Array.isArray(d.scenes) && d.scenes.length > 1) parts.push(el("details", {}, el("summary", {}, `Earlier imports (${d.scenes.length - 1})`), el("ul", {}, ...d.scenes.slice(0, -1).map((u, i) => el("li", {}, el("a", { href: "#", onclick: (e) => (e.preventDefault(), open(u, "scene")) }, `Table ${i + 1}`))))));
    parts.push(settingsPanel());
    root.replaceChildren(...parts);
    renderProgress();
  }

  const onChange = () => {
    if (busy) renderProgress();
    else render();
  };
  render();
  handle.on("change", onChange);

  return () => {
    dead = true;
    handle.off("change", onChange);
    root.removeEventListener("dragover", onDragOver);
    root.removeEventListener("dragleave", onDragLeave);
    root.removeEventListener("drop", onDrop);
    root.remove();
    style.remove();
  };
}

