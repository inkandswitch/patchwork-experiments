// One slice: source → print-space mesh → toolpaths → G-code → file doc → job doc.
// The source is only read. Works on anything shaped like a DocHandle and a Repo.

import { normalizeJob } from "./datatype.js";
import { settingsKey } from "./settings.js";
import { loadModel, SourceError } from "./source.js";
import { bounds } from "./stl.js";
import { buildToolpaths } from "./toolpaths.js";
import { generateGcode } from "./gcode.js";
import { saveGcode } from "./output.js";
import { sameInputs } from "./staleness.js";

export function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

/**
 * Slice an already-loaded model. No documents involved (the quick view on a
 * file doc uses this directly).
 * @returns {Promise<{ toolpaths, gcode: string, stats: object }>}
 */
export async function sliceModel({ model, settings, provenance = null, onProgress }) {
  const b = bounds(model.tris);
  const sizeMm = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  const toolpaths = await buildToolpaths(model.tris, settings, onProgress);
  const g = generateGcode(toolpaths, settings, provenance);
  const stats = {
    layers: toolpaths.layers.length,
    timeSeconds: Math.round(g.time),
    filamentMm: +g.filamentMm.toFixed(1),
    grams: +g.grams.toFixed(1),
    lines: g.lines,
    sizeMm,
    triangles: model.triangles,
    openEdges: model.openEdges,
    unit: model.units.unit,
    unitSource: model.units.source,
    scale: settings.scale,
  };
  return { toolpaths, gcode: g.gcode, stats };
}

/**
 * Slice a job and record the result on it.
 * @param {object} o
 * @param {object} o.repo
 * @param {object} o.handle        the slice-job DocHandle
 * @param {(p: number) => void} [o.onProgress]
 * @param {() => number} [o.now]
 * @param {(inputs) => void} [o.onInputs]   called once the inputs are known (to broadcast "slicing")
 * @returns {Promise<{ ok: true, gcode, toolpaths, model, inputs, gcodeUrl, reused, superseded? }
 *                  | { ok: false, error: string, code: string }>}
 */
export async function sliceJob({ repo, handle, onProgress, now = Date.now, onInputs }) {
  const job = normalizeJob(handle.doc());
  if (!job.source) return { ok: false, error: "This job has no source yet.", code: "no-source" };
  const settings = job.settings;
  const sKey = settingsKey(settings);
  let inputs = null;
  try {
    const model = await loadModel({ repo, url: job.source, settings });
    inputs = { sourceKey: model.sourceKey, settingsKey: sKey };
    onInputs?.(inputs);
    handle.change((d) => {
      d.status = "slicing";
      d.error = null;
    });
    const provenance = {
      job: handle.url ?? null,
      source: job.source,
      sourceKind: model.sourceKind,
      sourceKey: model.sourceKey,
      renderOf: model.renderOf,
      unit: model.units.unit,
      unitSource: model.units.source,
      scale: settings.scale,
      settings,
    };
    const { toolpaths, gcode, stats } = await sliceModel({ model, settings, provenance, onProgress });

    // A peer may have sliced exactly these inputs while we did: keep theirs.
    const current = normalizeJob(handle.doc());
    if (current.gcodeUrl && sameInputs(current.builtFrom, inputs)) {
      if (current.status === "slicing") {
        handle.change((d) => {
          d.status = "idle";
          d.error = null;
        });
      }
      return { ok: true, gcode, toolpaths, model, inputs, gcodeUrl: current.gcodeUrl, reused: true, superseded: true };
    }

    const saved = await saveGcode({ repo, job: current, gcode, title: current.title });
    handle.change((d) => {
      d.gcodeUrl = saved.url;
      d.builtFrom = {
        sourceKey: inputs.sourceKey,
        settingsKey: inputs.settingsKey,
        sourceUrl: job.source,
        sourceHeads: [...model.heads],
        gcodeHash: saved.hash,
      };
      d.builtAt = now();
      d.status = "idle";
      d.error = null;
      d.errorFrom = null;
      d.stats = { ...stats, sizeMm: [...stats.sizeMm], gcodeBytes: saved.bytes.byteLength };
      if (saved.storedBytes != null) d.stats.storedBytes = saved.storedBytes;
      if (saved.tooLarge) d.stats.notStored = true;
    });
    return { ok: true, gcode, toolpaths, model, inputs, gcodeUrl: saved.url, reused: saved.reused };
  } catch (err) {
    const error = errorMessage(err);
    const code = err instanceof SourceError ? err.code : "error";
    // A render that isn't built yet is waiting, not failing: record nothing.
    if (code === "unbuilt") {
      if (handle.doc()?.status === "slicing") handle.change((d) => void (d.status = "idle"));
      return { ok: false, error, code };
    }
    const from = inputs ?? (err?.sourceKey ? { sourceKey: err.sourceKey, settingsKey: sKey } : null);
    handle.change((d) => {
      d.status = "error";
      d.error = error;
      d.errorFrom = from ? { ...from } : null;
    });
    return { ok: false, error, code };
  }
}
