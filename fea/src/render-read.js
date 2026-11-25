/**
 * render-read.js — read a scene's `scene-render` doc from another package.  [kit: render-read.js v2]
 *
 * COPY THIS FILE into your package; do not import it across packages. It has no
 * imports, so it runs anywhere. The canonical copy is
 * patchwork-experiments/scene/src/render-read.js; copy it whole, never edit a
 * copy (`node scripts/check-kit.mjs` fails on a copy that differs).
 *
 * A render doc is the scene's built output for one object: its source doc,
 * built by a `scene:source` provider with the params the scene chose, as a GLB
 * (glTF 2.0, Y-up, metres). Consuming the render instead of calling the
 * provider yourself means the work is done once and shared, you see exactly
 * the geometry the scene shows, and the render's own dependencies come along.
 *
 * A render doc holds { title, parent (its source), providerId, params, pinned,
 * result, failure }: `result` is its last build, one value written whole,
 * { glbUrl, builtFrom, bounds, builtAt } (null until built); `failure` is the
 * last build that failed, { error, inputs } (null when none has).
 *
 *   readRender(repo, url) -> {
 *     url, render,                    // the render doc
 *     glb: Uint8Array | null,         // null until it has been built
 *     glbUrl, builtFrom, builtAt, bounds,  // its result's
 *     failure: { error, inputs } | null,
 *     source: AutomergeUrl | null,    // what it renders (render.parent)
 *   }
 *   isRenderDoc(doc) -> boolean
 *   renderKey(render) -> string       // changes exactly when the GLB does
 *   fileBytes(fileDoc) -> Uint8Array  // the bytes of a Patchwork `file` doc
 *
 * As a scene:source provider, list the render's url in dependencies(doc). The
 * scene host keys a scene-render dependency by renderKey() on its own, so
 * only a new GLB rebuilds you. Elsewhere (a tool), watch the render handle and compare renderKey().
 */

export const RENDER_TYPE = "scene-render";

export function isRenderDoc(doc) {
  return doc?.["@patchwork"]?.type === RENDER_TYPE;
}

/** A key that changes exactly when the render's GLB does (a rebuild with identical bytes keeps it). */
export function renderKey(render) {
  return `render:${render?.result?.glbUrl ?? ""}`;
}

/** The bytes of a Patchwork `file` doc: Uint8Array, ArrayBuffer(-view), string or ImmutableString content. */
export function fileBytes(doc) {
  const c = doc?.content;
  if (c instanceof Uint8Array) return c;
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  if (ArrayBuffer.isView(c)) return new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  if (typeof c === "string") return new TextEncoder().encode(c);
  if (c != null && typeof c.toString === "function") return new TextEncoder().encode(String(c));
  throw new Error("file has no content");
}

/**
 * Load a render doc and its current GLB. Throws if the url isn't a render doc,
 * or its GLB file doc can't be loaded; a render that hasn't been built yet
 * gives `glb: null` (its `failure` says if a build failed).
 */
export async function readRender(repo, url) {
  const handle = await repo.find(url);
  const render = handle.doc();
  if (!isRenderDoc(render)) throw new Error("not a scene render");
  const result = render.result ?? null;
  let glb = null;
  if (result?.glbUrl) glb = fileBytes((await repo.find(result.glbUrl)).doc());
  return {
    url,
    render,
    glb,
    glbUrl: result?.glbUrl ?? null,
    builtFrom: result?.builtFrom ?? null,
    builtAt: result?.builtAt ?? null,
    bounds: result?.bounds ?? null,
    failure: render.failure ?? null,
    source: render.parent ?? null,
  };
}
