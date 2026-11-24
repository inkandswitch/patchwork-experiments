// What packages' modules make in the focus doc (EDITOR.md, "Drops",
// "Templates", "Parts"): a dropped doc laid out by the extension whose
// `drops` take it, a part, a template. Each runs its module with the drop
// context made from the focus, its writes one step of the editor's
// (./editor.js).

import { editor } from "./editor.js";
import { isGroup } from "../groups.js";
import { paramsBySpec } from "../staleness.js";
import { composeMatrix, decomposeMatrix, multiplyMatrices, normalizeTransform } from "../transform.js";

const copy = (v) => JSON.parse(JSON.stringify(v));

const making = new Map(); // `${scene url} ${key}` → the file being made, so two drops at once make one

/**
 * ctx.file(key, make) (EDITOR.md, "Parts"): the scene's own file doc for a
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

/** Run create(ctx) with a drop context (EDITOR.md, "Drops") made from the focus `f`, its writes one step. */
async function inStep(f, id, label, create) {
  const g = editor(f).edits(label);
  try {
    return await create(
      Object.freeze({
        id,
        repo: f.repo,
        url: f.url,
        viewer: f.channel.viewer,
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
        notify: (text, kind) => f.use("notices")?.notify(text, kind),
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
    f.use("notices")?.notify(`Couldn't load that ${what}: ${err?.message ?? err}`, "error");
    return null;
  }
}
const failed = (f, what, err, out) => (f.use("notices")?.notify(`That ${what} failed: ${err?.message ?? err}`, "error"), out);

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
 * Put a part in (EDITOR.md, "Parts"): its create(ctx, at), `at` being {
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
 * Start the scene from a template (EDITOR.md, "Templates"): its create(ctx,
 * params) with exactly the params its metadata declares (coerced, defaulted,
 * others dropped: paramsBySpec). True when it ran (its maker, the start
 * screen, then arrives where the doc says).
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
  return true;
}
