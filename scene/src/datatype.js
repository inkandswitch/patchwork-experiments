// The two datatypes this package owns. See README.md for the document shapes.

export const DEFAULT_VIEW = Object.freeze({ units: "m", grid: true, axes: true, bounds: false });

export const SceneDatatype = {
  init(doc) {
    doc.title = "Untitled scene";
    doc.objects = {};
    doc.order = [];
    doc.dimensions = {};
    doc.view = { ...DEFAULT_VIEW };
    doc.camera = null;
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
    status: "idle",
    error: null,
    pinned: false,
  };
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
