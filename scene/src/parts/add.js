// scene.add: adding documents to the scene (ported from the old tool.js
// addFromUrl, addFiles, choose and the root drag/paste handlers).
//   - Drop documents (dnd.js payloads) or desktop files (.stl, .glb, …)
//     anywhere in the stage. Files become file docs first, named after the
//     file. A "Drop to add" hint shows while an acceptable drag is over the
//     port.
//     The outline's own row drags (ROW_MIME) are never ours.
//   - Paste an automerge URL anywhere in the stage outside a text field.
//   - Each URL goes first to api.drop (an extension that lays out that
//     datatype its own way, e.g. a deck as its cards); otherwise to the scene
//     providers that can show it: none says so, one is used, several ask
//     (the chooser). The new object is selected (local.selected).
//   - While the scene has nothing in it, it's a start screen: "Start from:"
//     every registered scene:template (from the registry's metadata, so
//     nothing is loaded to offer one) and Blank, then how to add something.
//     A template runs through api.template (it writes the doc, view.activity
//     included, and the stage starts this viewer where it says: an arena's
//     maker lands in the game). Blank only puts the choice away, for this
//     view; the drop hint stays.
// Pastes, drops and keys inside an embedded document (marked with the
// stage's EMBED_ATTR, src/embed.js) are that document's, never ours.

import css from "./add.css?inline";
import { ROW_MIME, hasPatchworkDrop, parseAutomergeLink, parseAutomergeUrl, parsePatchworkDrop } from "../dnd.js";
import { describeForHumans, describeSource, extensionOf } from "../providers.js";
import { fromEmbed } from "../embed.js";

export { fromEmbed };

export { ROW_MIME };

/** Is this a drag we take: documents or files, and not an outline row? Pure. */
export function accepts(dt) {
  const types = dt?.types ? [...dt.types] : [];
  if (types.includes(ROW_MIME)) return false;
  return hasPatchworkDrop(dt) || types.includes("Files");
}

/** A desktop file's mime type, guessed from its extension when the browser doesn't say. Pure. */
export function mimeOf(name, type) {
  if (type) return type;
  const ext = extensionOf(name);
  return ext === "glb" ? "model/gltf-binary" : ext === "stl" ? "model/stl" : "application/octet-stream";
}

/** A file's name without its extension (what the object is called). Pure. */
export const baseName = (name) => String(name ?? "").replace(/\.[^.]+$/, "");

/** scene:template metadata as the start screen offers it: those with an id, in registry order. Pure. */
export const templatesOf = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((t) => t && typeof t.id === "string")
    .map((t) => ({ id: t.id, name: String(t.name ?? t.id), icon: typeof t.icon === "string" ? t.icon : null, description: typeof t.description === "string" ? t.description : null }));

/** Is someone typing into this element? */
function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.isContentEditable || el.getAttribute?.("contenteditable") === "true";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function create(api) {
  api.style(css);
  const live = () => !api.signal.aborted;

  // ── the layers ───────────────────────────────────────────────────────────
  // One overlay for the passive hints (they never take the pointer), one for
  // the chooser (above the other overlays).
  const hints = api.overlay();
  hints.classList.add("add-layer");
  const port = api.port ?? hints.parentElement;
  const root = api.root ?? hints.closest(".scene-stage") ?? port;

  const empty = el("div", "add-empty");
  const start = el("div", "add-start");
  start.setAttribute("role", "group");
  start.setAttribute("aria-label", "Start from");
  start.hidden = true;
  empty.append(start, el("p", null, "Drop a document here, or paste its URL."), el("p", "hint", "Anything with a scene provider works — STL and GLB files out of the box."));
  empty.hidden = true;
  const dropHint = el("div", "add-drop-hint", "Drop to add to the scene");
  dropHint.hidden = true;
  hints.append(empty, dropHint);

  const chooserLayer = api.overlay();
  chooserLayer.classList.add("add-chooser-layer");

  // ── the start screen ─────────────────────────────────────────────────────
  let templates = []; // templatesOf(the scene:template registry)
  let blank = false; // Blank was chosen: no more asking, in this view
  let starting = false; // a template is running
  let startKey = null;

  function renderStart() {
    const show = !blank && templates.length > 0;
    if (start.hidden === show) start.hidden = !show;
    if (!show) return;
    const key = JSON.stringify(templates);
    if (key === startKey) return;
    startKey = key;
    const list = el("div", "add-templates");
    for (const t of templates) {
      const b = el("button", "button add-template");
      b.type = "button";
      b.dataset.template = t.id;
      if (t.icon) b.dataset.icon = t.icon;
      b.append(el("span", "add-template-name", t.name));
      if (t.description) b.append(el("span", "add-template-description", t.description));
      b.addEventListener("click", () => void startFrom(t.id));
      list.append(b);
    }
    const none = el("button", "button add-template add-blank");
    none.type = "button";
    none.dataset.template = "";
    none.append(el("span", "add-template-name", "Blank"), el("span", "add-template-description", "Add your own documents"));
    none.addEventListener("click", () => {
      blank = true;
      renderStart();
    });
    list.append(none);
    start.replaceChildren(el("p", "add-start-title", "Start from:"), list);
  }

  async function startFrom(id) {
    if (starting) return;
    starting = true;
    for (const b of start.querySelectorAll("button")) b.disabled = true;
    try {
      await api.template(id);
    } finally {
      starting = false;
      if (live()) for (const b of start.querySelectorAll("button")) b.disabled = false;
    }
  }

  Promise.resolve(api.registry("scene:template"))
    .then((reg) => {
      if (!live() || !reg) return;
      const read = () => {
        let list = [];
        try {
          list = reg.filter?.(() => true) ?? [];
        } catch {
          list = [];
        }
        templates = templatesOf(list);
        if (live()) renderStart();
      };
      read();
      try {
        const off = reg.on?.("changed", read);
        if (typeof off === "function") api.signal.addEventListener("abort", off, { once: true });
      } catch {
        // what's installed now is what's offered
      }
    })
    .catch(() => {});

  // ── the provider chooser ─────────────────────────────────────────────────
  let choosing = null; // { box, done, disarm }

  /** Ask which provider to show `what` with. @returns {Promise<object | null>} */
  function choose(providers, what) {
    choosing?.done(null); // one question at a time: a newer one replaces it
    return new Promise((resolve) => {
      const box = el("div", "add-chooser");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", `Show ${what} as`);
      const done = (p) => {
        if (choosing?.box !== box) return;
        const c = choosing;
        choosing = null;
        c.disarm?.();
        box.remove();
        resolve(p);
      };
      box.append(el("p", "add-chooser-title", `Show ${what} as…`));
      for (const p of providers) {
        const b = el("button", "button", p.name ?? p.id);
        b.type = "button";
        b.dataset.provider = p.id;
        b.addEventListener("click", () => done(p));
        box.append(b);
      }
      const cancel = el("button", "button link", "Cancel");
      cancel.type = "button";
      cancel.dataset.cancel = "";
      cancel.addEventListener("click", () => done(null));
      box.append(cancel);
      chooserLayer.append(box);
      choosing = { box, done, disarm: null };
      // Escape cancels; Enter and Space press the focused choice (and nothing
      // else down the chain hears them). Every other event falls through.
      choosing.disarm = api.arm({
        key(ev) {
          if (ev.key === "Escape") {
            done(null);
            return true;
          }
          if ((ev.key === "Enter" || ev.key === " ") && box.contains(document.activeElement)) {
            document.activeElement.click();
            return true;
          }
          return false;
        },
      });
      box.querySelector("button")?.focus?.({ preventScroll: true });
    });
  }

  // ── adding ───────────────────────────────────────────────────────────────
  const fail = (text) => {
    api.notify(text, "error");
    return null;
  };

  /**
   * Add one document: an extension's layout, else a provider's object.
   * @param {string} input  an automerge URL (or anything parseAutomergeLink reads)
   * @param {{ name?: string, at?: { point, hitId } | null, heads?: string[] }} [o]
   *   heads (or heads in the URL): the object is added fixed at that version
   * @returns {Promise<string | null>} the new object's id (null when an extension laid it out, or nothing was added)
   */
  async function add(input, { name, at = null, heads = null } = {}) {
    const link = parseAutomergeLink(input);
    if (!link) return fail("That doesn't look like an automerge URL.");
    const url = link.url;
    const version = heads?.length ? heads : link.heads;
    if (url === api.url) return fail("A scene can't contain itself.");
    let source;
    try {
      source = await api.repo.find(url);
    } catch (err) {
      return fail(`Couldn't open that document: ${err?.message ?? err}`);
    }
    if (!live()) return null;
    const doc = source?.doc?.();
    if (await api.drop({ url, doc, handle: source, group: null, at })) return null;
    if (!live()) return null;
    const providers = (await api.providersFor(url, doc)) ?? [];
    if (!providers.length) return fail(`Nothing can show ${describeForHumans(describeSource(doc))} in a scene.`);
    const what = name || doc?.title || doc?.name || "this document";
    const provider = providers.length === 1 ? providers[0] : await choose(providers, what);
    if (!provider || !live()) return null;
    let id;
    try {
      id = await api.addObject(url, { providerId: provider.id, group: null, ...(name ? { name } : {}), ...(version?.length ? { heads: version } : {}) });
    } catch (err) {
      return fail(err?.message ?? String(err));
    }
    if (!live()) return id;
    api.local.swap((m) => ((m.selected ?? null) === id ? m : { ...m, selected: id }));
    return id;
  }

  /** Desktop files become file docs, then objects named after them. */
  async function addFiles(files, at) {
    for (const file of files) {
      if (!live()) return;
      let h;
      try {
        const content = new Uint8Array(await file.arrayBuffer());
        h = await api.repo.create2({
          "@patchwork": { type: "file" },
          name: file.name,
          extension: extensionOf(file.name),
          mimeType: mimeOf(file.name, file.type),
          content,
        });
      } catch (err) {
        fail(`Couldn't read ${file.name}: ${err?.message ?? err}`);
        continue;
      }
      if (!live()) return;
      await add(h.url, { name: baseName(file.name), at });
    }
  }

  async function addAll(items, at) {
    for (const item of items) {
      if (!live()) return;
      await add(item.url, { name: item.name, at, heads: item.heads ?? null });
    }
  }

  // ── drag and drop on the port ────────────────────────────────────────────
  let depth = 0; // dragenter/dragleave fire per element crossed: count them
  const showHint = (on) => {
    if (dropHint.hidden === !on) return;
    dropHint.hidden = !on;
  };

  /** Where a drop landed: what's under it (or the ground), for api.drop's `at`; null off the port. */
  function dropAt(e) {
    if (!(e.target instanceof Node) || !port.contains(e.target)) return null;
    const r = port.getBoundingClientRect();
    let hit = null;
    try {
      hit = api.pick(e.clientX - r.left, e.clientY - r.top, { ground: true });
    } catch {
      hit = null;
    }
    return hit?.point ? { point: hit.point, hitId: hit.id ?? null } : null;
  }

  // Anywhere in the stage takes a drop (the side panels too, as the old tool
  // did), unless something under it already did (an outline row, which stops
  // it). The hint shows only while the drag is over the port.
  const inPort = (e) => e.target instanceof Node && port.contains(e.target);
  api.listen(root, "dragenter", (e) => {
    if (!inPort(e) || fromEmbed(e, root) || !accepts(e.dataTransfer)) return;
    depth++;
    showHint(true);
  });
  api.listen(root, "dragover", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root) || !accepts(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  api.listen(root, "dragleave", (e) => {
    if (!inPort(e) || fromEmbed(e, root)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) showHint(false);
  });
  // any drop ends the drag, whoever takes it (heard first, so a row's drop can't skip it)
  api.listen(
    root,
    "drop",
    () => {
      depth = 0;
      showHint(false);
    },
    { capture: true },
  );
  api.listen(root, "drop", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root)) return;
    const dt = e.dataTransfer;
    if (!accepts(dt)) return;
    e.preventDefault();
    const at = dropAt(e);
    const files = [...(dt.files ?? [])];
    if (files.length) return void addFiles(files, at);
    const items = parsePatchworkDrop(dt);
    if (!items.length) return void fail("Nothing droppable there.");
    void addAll(items, at);
  });

  // ── paste, anywhere in the stage outside a field ─────────────────────────
  api.listen(root, "paste", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root)) return;
    if (isTyping(e.composedPath?.()[0] ?? e.target)) return;
    const text = e.clipboardData?.getData?.("text/plain");
    if (!parseAutomergeUrl(text)) return;
    e.preventDefault();
    void add(text);
  });

  return {
    update(scene, local, prev) {
      if (scene === prev.scene) return;
      const none = !scene.ids.length;
      if (empty.hidden !== !none) empty.hidden = !none;
    },
    dispose() {
      choosing?.done(null);
    },
    // for tests and other code holding the instance
    add,
    startFrom,
  };
}

export default { create };
