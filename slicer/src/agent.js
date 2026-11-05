// The `prepare_slice` agent tool: make (or re-point) a slice job for a model,
// with settings, and optionally slice it now. Uses the same modules as the
// tool, so the two can't disagree about what a slice job is.

import { JOB_TYPE, newJobDoc, normalizeJob } from "./datatype.js";
import { SPEC_BY_KEY, settingsWrites } from "./settings.js";
import { describeSource, sourceName } from "./source.js";
import { parseAutomergeUrl } from "./dnd.js";
import { sliceJob } from "./job.js";

const NOT_SETTINGS = new Set(["model", "job", "title", "auto", "slice"]);

function describeKind(desc) {
  return desc.kind === "render" ? "scene object render" : `${desc.format.toUpperCase()} file`;
}

export default {
  async execute(input, ctx = {}) {
    const repo = ctx.repo ?? globalThis.repo;
    if (!repo) throw new Error("No repo available.");
    const url = parseAutomergeUrl(input?.model);
    if (!url) throw new Error("`model` must be an automerge URL: a scene object's render (its renderUrl in the scene doc), or a GLB or STL file document.");

    const modelDoc = (await repo.find(url)).doc();
    const desc = describeSource(modelDoc);
    if (desc.kind === "unsupported") {
      const t = desc.type;
      if (t === "scene") throw new Error("That is a whole scene. Pass one object's render instead: read the scene doc and use objects[<id>].renderUrl (or its sourceUrl if renderUrl is null and it is a GLB).");
      if (t === "openscad") throw new Error("That is an OpenSCAD document. Add it to a scene, then pass the scene object's renderUrl.");
      throw new Error(`Can't slice a ${t ?? "document of unknown type"}: pass a scene render, or a GLB or STL file document.`);
    }

    const patch = {};
    for (const [k, v] of Object.entries(input ?? {})) if (!NOT_SETTINGS.has(k)) patch[k] = v;
    const { writes, rejected } = settingsWrites(patch);
    const unknown = rejected.filter((k) => !SPEC_BY_KEY[k]);
    const invalid = rejected.filter((k) => SPEC_BY_KEY[k]);

    let handle;
    let made = false;
    const jobUrl = input?.job ? parseAutomergeUrl(input.job) : null;
    if (input?.job && !jobUrl) throw new Error("`job` must be the automerge URL of an existing slice job.");
    if (jobUrl) {
      handle = await repo.find(jobUrl);
      const d = handle.doc();
      if (d?.["@patchwork"]?.type !== JOB_TYPE && !("settings" in (d ?? {}))) throw new Error("`job` is not a slice job.");
      handle.change((doc) => {
        doc.source = url;
        if (!doc.settings || typeof doc.settings !== "object") doc.settings = {};
        for (const [k, v] of Object.entries(writes)) doc.settings[k] = v;
        if (typeof input.auto === "boolean") doc.auto = input.auto;
        if (typeof input.title === "string" && input.title) doc.title = input.title;
      });
    } else {
      const title = (typeof input?.title === "string" && input.title) || `${sourceName(modelDoc).replace(/\.[a-z0-9]{2,5}$/i, "")} slice`;
      handle = await repo.create2(newJobDoc({ title, source: url, settings: writes, auto: typeof input?.auto === "boolean" ? input.auto : true }));
      made = true;
    }

    const job = normalizeJob(handle.doc());
    const s = job.settings;
    const lines = [
      `${made ? "Created" : "Updated"} slice job ${handle.url} for the ${describeKind(desc)} ${url}.`,
      `Settings: layer ${s.layerHeight} mm (first ${s.firstLayerHeight} mm), ${s.wallLoops} walls, ${s.infillDensity}% infill, ${s.filament} at ${s.nozzleTemp} °C / bed ${s.bedTemp} °C, scale ${s.scale}${s.supports ? ", supports requested (not generated)" : ""}.`,
    ];
    if (unknown.length) lines.push(`Ignored unknown settings: ${unknown.join(", ")}.`);
    if (invalid.length) lines.push(`Ignored values that don't fit: ${invalid.join(", ")}.`);

    if (input?.slice) {
      const r = await sliceJob({ repo, handle });
      if (r.ok) {
        const st = normalizeJob(handle.doc()).stats;
        lines.push(`Sliced: ${st.layers} layers, about ${Math.round(st.timeSeconds / 60)} min, ${st.grams} g. G-code: ${r.gcodeUrl}${r.reused ? " (unchanged)" : ""}.`);
      } else lines.push(`Slicing failed: ${r.error}`);
    } else {
      lines.push(job.auto ? "It slices when opened in the Slicer tool, and again whenever the model or settings change. The G-code goes to the job's gcodeUrl." : "Auto is off: open it in the Slicer tool and press Slice now.");
    }
    return { text: lines.join("\n"), doc: { url: handle.url, name: job.title, kind: JOB_TYPE } };
  },

  summarize(input) {
    return `${input?.job ? "updated" : "prepared"} ${input?.filament || "PLA"} slice job for ${input?.model}${input?.slice ? " and sliced it" : ""}`;
  },
};
