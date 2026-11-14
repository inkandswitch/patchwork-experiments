// The two datatypes this package owns. See README.md for the document shapes.

export const DEFAULT_VIEW = Object.freeze({ units: "m", grid: true, axes: true, bounds: false, snap: true });
/** The body a scene made new starts people in: the editor (src/stage/bodies.js EDIT). */
export const NEW_SCENE_BODY = "edit";

export const SceneDatatype = {
  init(doc) {
    doc.title = "Untitled scene";
    doc.objects = {};
    doc.order = [];
    // every map a scene has is made here, so no two peers ever create one at
    // once (STAGE.md, "Shared maps")
    doc.dimensions = {};
    doc.traits = {};
    // the scene's own file docs, by key (ctx.file: STAGE.md, "Parts")
    doc.assets = {};
    // the packages its contents come from, as { url } (STAGE.md, "Packages"):
    // the stage adds to it, and offers a viewer the ones they don't have
    doc.packages = [];
    // world time (TOOLS.md §7): the stage only ever writes its fields, so a
    // pause and a checkpoint made at once both keep theirs
    doc.clock = { running: true, t: 0 };
    // where people start (TOOLS.md §2): a scene made new is made to be
    // built, so it starts them in Edit (src/stage/bodies.js). A doc that
    // names no body starts them in Look; a template or a publisher that
    // makes something to look at, play or walk writes its own view.start
    doc.view = { ...DEFAULT_VIEW, start: { body: NEW_SCENE_BODY } };
  },
  getTitle(doc) {
    return doc?.title || "Untitled scene";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "scene"}`;
  },
};

/** A fresh scene-render doc (pass to repo.create2). */
export function newRenderDoc({ title, parent, providerId, params }) {
  return {
    "@patchwork": { type: "scene-render" },
    title: title || "Scene render",
    parent,
    providerId,
    params: params ?? {},
    glbUrl: null,
    builtFrom: null,
    builtAt: null,
    bounds: null,
    status: "idle",
    error: null,
    pinned: false,
  };
}

/**
 * A new render doc started from another's (a copied object's): its params,
 * when it was by the same provider, and the build it had (GLB, record,
 * bounds) when it was of the same source too, so a copy shows at once and
 * rebuilds only when something changes. Pure; fresh copies throughout.
 */
export function seededRenderDoc(fresh, seed) {
  if (!seed || typeof seed !== "object" || seed.providerId !== fresh.providerId) return fresh;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const out = { ...fresh };
  if (seed.params && typeof seed.params === "object") out.params = copy(seed.params);
  if (seed.pinned === true) out.pinned = true;
  if (seed.parent === fresh.parent && typeof seed.glbUrl === "string" && seed.builtFrom && typeof seed.builtFrom === "object") {
    out.glbUrl = seed.glbUrl;
    out.builtFrom = copy(seed.builtFrom);
    out.builtAt = Number.isFinite(seed.builtAt) ? seed.builtAt : null;
    out.bounds = seed.bounds ? copy(seed.bounds) : null;
  }
  return out;
}

export const RENDER_SUFFIX = " (3D render)";

export const SceneRenderDatatype = {
  init(doc) {
    const seed = newRenderDoc({ parent: null, providerId: null });
    for (const [k, v] of Object.entries(seed)) if (k !== "@patchwork") doc[k] = v;
  },
  // The render doc copies its source's title; say it's the render, so the two
  // don't show up under the same name in the shell.
  getTitle(doc) {
    return doc?.title ? `${doc.title}${RENDER_SUFFIX}` : "Scene render";
  },
  setTitle(doc, title) {
    const t = String(title ?? "");
    doc.title = t.endsWith(RENDER_SUFFIX) ? t.slice(0, -RENDER_SUFFIX.length) : t;
  },
};
