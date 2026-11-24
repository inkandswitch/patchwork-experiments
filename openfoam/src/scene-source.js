// SourceImpl for scene:source "openfoam-results": a case (or one run) as the
// results of its run, in the scene.
//
// Which run: a run doc shows itself; a case shows its selected run if that
// has finished, else its newest finished run, else the selected run's hull
// as it was frozen (plain grey: "no results yet").
//
// Freshness: a run doc is written every couple of seconds while it solves,
// so neither the source nor its dependencies are keyed by heads. A run is
// fingerprinted by its status and its layer links, which change exactly
// twice (when it finishes, and if it's re-run, never: runs are immutable
// once done). The layer docs themselves are written once and never change.

import { CASE_TYPE, RUN_TYPE, decodeLayer } from "./protocol.js";
import { decodeSTL } from "./hull/prepare.js";
import { buildResultsGLB } from "./scene-build.js";
import { findWhenThere } from "./find.js";
import { getBytes, internalize } from "./segments.js";

const typeOf = (doc) => doc?.["@patchwork"]?.type;
const runKey = (run) => `${run?.status ?? "?"}|${JSON.stringify(run?.layers ?? {})}`;

async function pickRun(doc, url, repo) {
  if (typeOf(doc) === RUN_TYPE) return { run: doc, url };
  const urls = Array.isArray(doc.runs) ? [...doc.runs] : [];
  const runs = [];
  for (const u of urls) {
    try {
      const h = await repo.find(u);
      runs.push({ url: u, run: h.doc() });
    } catch {
      // not loadable here; the host retries dependencies that haven't arrived
    }
  }
  const sel = runs.find((r) => r.url === doc.selected);
  if (sel?.run?.status === "done") return sel;
  const done = runs.filter((r) => r.run?.status === "done").sort((a, b) => (b.run.finishedAt ?? 0) - (a.run.finishedAt ?? 0));
  return done[0] ?? sel ?? runs[runs.length - 1] ?? null;
}

export default {
  fingerprint(doc) {
    if (typeOf(doc) === RUN_TYPE) return `run:${runKey(doc)}`;
    return `case:${doc.selected ?? ""}|${(doc.runs ?? []).join(",")}`;
  },
  dependencies(doc) {
    return typeOf(doc) === CASE_TYPE && Array.isArray(doc.runs) ? doc.runs.filter((u) => typeof u === "string") : [];
  },
  fingerprintDependency(url, doc) {
    return typeOf(doc) === RUN_TYPE ? runKey(doc) : null;
  },
  async build({ doc, url, params, repo }) {
    const picked = await pickRun(doc, url, repo);
    if (!picked?.run) return buildResultsGLB({ layers: {}, params, mode: "double-body", notes: ["no runs yet"] });
    const { run } = picked;
    const notes = [];
    const layers = {};
    if (run.status === "done") {
      for (const [name, u] of Object.entries(run.layers ?? {})) {
        // a layer that isn't here yet is this peer's problem: throw, keep the last good render
        const L = decodeLayer(await internalize(repo, (await findWhenThere(repo, u, { tries: 4 })).doc()));
        if (!L) throw new Error(`the ${name} layer hasn't arrived`);
        layers[name] = L;
      }
      notes.push(`${run.title}`);
    } else notes.push(`${run.title}: ${run.status}, no results yet`);
    let hullTriangles = null;
    if (run.status !== "done" && run.hull?.stl) {
      try {
        hullTriangles = decodeSTL(await getBytes(repo, run.hull.stl));
      } catch {
        hullTriangles = null;
      }
    }
    return buildResultsGLB({ layers, params, mode: run.setup?.mode, hullTriangles, notes, frame: run.hull?.frame ?? null });
  },
};
