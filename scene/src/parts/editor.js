// The editor's writes (STAGE.md, "Undo", "Drops", "Templates", "Parts"). Its
// view plugins (the halo, handles, inspector and tree, transfer, add, the
// parts bin, dimensions, Frame's Set home view, Delete, Undo) write the focus
// doc through here, each write recorded from what the stage's change(fn)
// returns (its patches) onto this viewer's stacks for that doc, kept in the
// focus stage's `local.edits` (src/undo.js). Nothing else is ever on them: a
// package's verb, a clock act or a process's save writes through its own
// api.change, unrecorded. Drops, parts and templates run here too, each a
// package's module given a drop context made from the focus, its writes one
// step.

import { EMPTY, createEdits } from "../undo.js";
import { isGroup } from "../groups.js";
import { paramsBySpec } from "../staleness.js";
import { composeMatrix, decomposeMatrix, multiplyMatrices, normalizeTransform } from "../transform.js";

const copy = (v) => JSON.parse(JSON.stringify(v));

/** An object's render doc as the recorder writes one: change(fn) → its patches. */
const writer = (h) => ({
  url: h.url,
  doc: () => h.doc(),
  change(fn) {
    let patches = [];
    h.change(fn, { patchCallback: (p) => void (patches = p) });
    return patches;
  },
});

/**
 * What a step did to a doc (undo.js `judge`): the names of the objects it
 * removed whose contents a keeper holds, bound by the trait of an extension
 * whose plugin says `keeper` (STAGE.md, "Keepers"), read from `reg` (the
 * focus's registry("scene:extension"), at once).
 */
function judge(reg, { before, after }) {
  const gone = Object.keys(before?.objects ?? {}).filter((id) => !after?.objects?.[id]);
  if (!gone.length) return null;
  const traits = (reg?.filter?.((p) => !!p?.keeper) ?? []).flatMap((p) => (Array.isArray(p.traits) ? p.traits : []));
  return { kept: gone.filter((id) => traits.some((k) => before.objects[id]?.traits?.[k] != null)).map((id) => String(before.objects[id].name ?? id)) };
}

/**
 * The editor at the focus `f` (a view plugin's api.focus(), read now: its
 * steps stay with this doc wherever the focus goes). edit(fn, { label,
 * handle? }) writes fn as one step (on the scene, or on `handle`: an
 * object's render doc); edits(label) opens a step of several writes ({
 * change(fn, handle?), end() }); undo() and redo() take this viewer's last
 * step here back or again (false when there's none, or it has been changed
 * since); labels() names them.
 */
export function editor(f) {
  const { url, doc, change, local, notify } = f;
  const e = createEdits({
    handle: { url, doc, change },
    store: { get: () => local.get().edits ?? EMPTY, swap: (fn) => local.swap((m) => ({ ...m, edits: fn(m.edits ?? EMPTY) })) },
    writable: f.writable,
    notify: (text) => notify(text),
    judge: (part) => judge(f.registry("scene:extension"), part),
  });
  const edits = (label) => {
    const g = e.begin(label);
    return Object.freeze({ change: (fn, h) => g.change(fn, h && writer(h)), end: g.end });
  };
  return Object.freeze({
    edit(fn, { label, handle } = {}) {
      const g = edits(label);
      g.change(fn, handle);
      g.end();
    },
    edits,
    undo: () => e.take("undo"),
    redo: () => e.take("redo"),
    labels: e.labels,
  });
}

/** Add a doc as an object (the stage's addObject), as one step. @returns {Promise<string>} its id */
export async function add(f, input, opts) {
  const write = await f.addObject(input, opts);
  editor(f).edit(write, { label: "Add" });
  return write.id;
}

// ─── drops, parts and templates ─────────────────────────────────────────────

const making = new Map(); // `${scene url} ${key}` → the file being made, so two drops at once make one

/**
 * ctx.file(key, make) (STAGE.md, "Parts"): the scene's own file doc for a
 * versioned key ("sailing/mast@1"), the one doc.assets[key] names, else one
 * made now from make() and remembered there. Two peers making one key at
 * once each write theirs if it is still empty; the merge keeps one in
 * `assets`, and what each made keeps the file it made.
 * @returns {Promise<{ url: string, hint: object | null }>}
 */
async function sceneFile(f, key, make) {
  if (typeof key !== "string" || !key) throw new Error("A file needs a key.");
  const known = () => {
    const a = f.doc().assets?.[key];
    return typeof a?.url === "string" ? { url: a.url, hint: a.hint ? copy(a.hint) : null } : null;
  };
  if (known()) return known();
  if (!f.writable()) throw new Error("This scene is read-only here.");
  const k = `${f.url} ${key}`;
  if (!making.has(k)) {
    const made = (async () => {
      const m = await make();
      if (!m?.bytes) throw new Error(`Nothing to make “${key}” from.`);
      const file = await f.repo.create2({ "@patchwork": { type: "file" }, name: String(m.name ?? key), extension: String(m.extension ?? ""), mimeType: String(m.mimeType ?? "application/octet-stream"), content: m.bytes });
      const hint = m.hint ? copy(m.hint) : null;
      f.change((d) => {
        if (!d.assets[key]?.url) d.assets[key] = hint ? { url: file.url, hint } : { url: file.url };
      });
      return known() ?? { url: file.url, hint };
    })();
    making.set(k, made.finally(() => making.delete(k)));
  }
  return making.get(k);
}

/** Run create(ctx) with a drop context (STAGE.md, "Drops") made from the focus `f`, its writes one step. */
async function inStep(f, id, label, create) {
  const g = editor(f).edits(label);
  try {
    return await create(
      Object.freeze({
        id,
        repo: f.repo,
        handle: f.handle,
        url: f.url,
        viewer: f.viewer,
        doc: f.doc,
        scene: f.scene,
        newId: f.newId,
        change: (fn) => g.change(fn),
        addObject: async (input, opts) => {
          const write = await f.addObject(input, opts);
          g.change(write);
          return write.id;
        },
        file: (key, make) => sceneFile(f, key, make),
        content: f.content,
        worldOf: f.worldOf,
        registry: f.registry,
        local: Object.freeze({ get: f.local.get, swap: f.local.swap }),
        select: (oid) => f.view.select(oid),
        notify: f.notify,
      }),
    );
  } finally {
    g.end();
  }
}

/** A registered module (its default export, else itself), or null, having said why. */
async function loadModule(f, type, id, what) {
  try {
    const p = await (await f.registry(type))?.load(id);
    return p ? { mod: p.module?.default ?? p.module, params: Array.isArray(p.params) ? p.params : [] } : null;
  } catch (err) {
    f.notify(`Couldn't load that ${what}: ${err?.message ?? err}`, "error");
    return null;
  }
}
const failed = (f, what, err, out) => (f.notify(`That ${what} failed: ${err?.message ?? err}`, "error"), out);

/** May this extension lay out a dropped doc of this datatype (`drops`; "*": any)? */
const takesDrop = (meta, type) => !!meta?.id && Array.isArray(meta.drops) && (meta.drops.includes("*") || (!!type && meta.drops.includes(type)));

/**
 * Lay out a dropped doc (`info`: { url, doc, handle, group, at }): each
 * extension module (registry order) whose `drops` take its datatype, until
 * one's drop(ctx, info) says true. The traits it writes start its extension.
 * @returns {Promise<boolean>}
 */
export async function drop(f, info) {
  if (!f.writable()) return false;
  const reg = await f.registry("scene:extension");
  const type = info?.doc?.["@patchwork"]?.type ?? null;
  for (const meta of reg?.filter?.((m) => takesDrop(m, type)) ?? []) {
    try {
      const loaded = await reg.load(meta.id);
      const mod = loaded?.module?.default ?? loaded?.module;
      if (typeof mod?.drop === "function" && (await inStep(f, meta.id, "Add", (ctx) => mod.drop(ctx, info)))) return true;
    } catch (err) {
      console.warn(`[scene] extension “${meta.id}”: drop failed`, err);
    }
  }
  return false;
}

/**
 * Put a part in (STAGE.md, "Parts"): its create(ctx, at), `at` being {
 * parent, transform, world }: a parent gone or a group is the scene root,
 * the transform is in the parent's frame, and `world` the same place in the
 * world. What it returns is selected.
 * @returns {Promise<string | null>} its id
 */
export async function part(f, partId, at = null) {
  if (!f.writable()) return null;
  const { mod } = (await loadModule(f, "scene:part", partId, "part")) ?? {};
  if (typeof mod?.create !== "function") return null;
  const objects = f.doc().objects ?? {};
  const parent = typeof at?.parent === "string" && objects[at.parent] && !isGroup(objects[at.parent]) ? at.parent : null;
  const transform = normalizeTransform(at?.transform);
  const parentWorld = parent ? f.worldOf(parent) : null;
  const world = parentWorld ? normalizeTransform(decomposeMatrix(multiplyMatrices(parentWorld, composeMatrix(transform)))) : transform;
  let made;
  try {
    made = await inStep(f, partId, "Add part", (ctx) => mod.create(ctx, Object.freeze({ parent, transform, world })));
  } catch (err) {
    return failed(f, "part", err, null);
  }
  const id = typeof made === "string" && f.doc().objects?.[made] ? made : null;
  if (id) f.view.select(id);
  return id;
}

/**
 * Start the scene from a template (STAGE.md, "Templates"): its create(ctx,
 * params) with exactly the params its metadata declares (coerced, defaulted,
 * others dropped: paramsBySpec). Then this viewer arrives where the doc now
 * says. True when it ran.
 * @returns {Promise<boolean>}
 */
export async function template(f, templateId, params) {
  if (!f.writable()) return false;
  const loaded = await loadModule(f, "scene:template", templateId, "template");
  if (typeof loaded?.mod?.create !== "function") return false;
  try {
    await inStep(f, templateId, "Template", (ctx) => loaded.mod.create(ctx, paramsBySpec(loaded.params, params)));
  } catch (err) {
    return failed(f, "template", err, false);
  }
  f.view.arrive();
  return true;
}
