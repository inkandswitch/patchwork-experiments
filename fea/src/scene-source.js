// SourceImpl for scene:source "fea-results": a study (or one run) in a scene,
// as its results on the part.
//
// Which run: a run doc shows itself; a study shows its selected run if that
// has finished, else its newest finished run, else the part it keeps, plain,
// with its supports and loads marked ("no results yet").
//
// Freshness: a run doc is written as it goes, so neither the source nor its
// dependencies are keyed by heads. A run is fingerprinted by its status and
// its results' link, which change once, when it finishes; a study by which
// run it shows, its kept part and what its marks are drawn from. The kept
// part and the results never change once written.

import { STUDY_TYPE, RUN_TYPE, decodeLayer } from "./protocol.js";
import { decodePart, PART_TYPE } from "./part/kept.js";
import { buildStudyGLB } from "./scene-build.js";
import { normalizeSetup } from "./setup.js";
import { findWhenThere } from "./find.js";
import { internalize } from "./segments.js";

const typeOf = (doc) => doc?.["@patchwork"]?.type;
const runKey = (run) => `${run?.status ?? "?"}|${JSON.stringify(run?.layers ?? {})}`;
const marksKey = (setup) => JSON.stringify([setup?.supports ?? {}, setup?.loads ?? {}]);

async function pickRun(doc, repo) {
  const runs = [];
  for (const u of Array.isArray(doc.runs) ? [...doc.runs] : []) {
    try {
      runs.push({ url: u, run: (await repo.find(u)).doc() });
    } catch {
      // not loadable here; the host retries dependencies that haven't arrived
    }
  }
  const sel = runs.find((r) => r.url === doc.selected);
  if (sel?.run?.status === "done") return sel.run;
  return runs.filter((r) => r.run?.status === "done").sort((a, b) => (b.run.finishedAt ?? 0) - (a.run.finishedAt ?? 0))[0]?.run ?? null;
}

export default {
  fingerprint(doc) {
    if (typeOf(doc) === RUN_TYPE) return `run:${runKey(doc)}`;
    return `study:${doc.selected ?? ""}|${(doc.runs ?? []).join(",")}|${doc.part?.kept ?? ""}|${marksKey(doc.setup)}`;
  },
  dependencies(doc) {
    if (typeOf(doc) !== STUDY_TYPE) return [];
    return [...(Array.isArray(doc.runs) ? doc.runs : []), doc.part?.kept].filter((u) => typeof u === "string");
  },
  fingerprintDependency(url, doc) {
    if (typeOf(doc) === RUN_TYPE) return runKey(doc);
    if (typeOf(doc) === PART_TYPE) return "part"; // written once
    return null;
  },
  async build({ doc, params, repo }) {
    const run = typeOf(doc) === RUN_TYPE ? doc : await pickRun(doc, repo);
    const notes = [];
    if (run?.status === "done" && run.layers?.skin) {
      // results that aren't here yet are this peer's problem: throw, keep the last good render
      const layer = decodeLayer(await internalize(repo, (await findWhenThere(repo, run.layers.skin, { tries: 4 })).doc()));
      if (!layer) throw new Error("the run's results haven't arrived");
      const part = decodePart(await internalize(repo, run.part));
      notes.push(run.title);
      return buildStudyGLB({ layer, part, setup: normalizeSetup(run.setup), params, notes });
    }
    // no results: the part as it is kept (a run's own, or the study's)
    let kept = null;
    if (typeOf(doc) === RUN_TYPE) kept = doc.part;
    else if (doc.part?.kept) kept = (await findWhenThere(repo, doc.part.kept, { tries: 4 })).doc();
    if (!kept?.stl) return buildStudyGLB({ params, notes: ["no part linked yet"] });
    const part = decodePart(await internalize(repo, kept));
    notes.push(typeOf(doc) === RUN_TYPE ? `${doc.title}: ${doc.status}, no results yet` : "no results yet");
    return buildStudyGLB({ part, setup: normalizeSetup(doc.setup), params, notes });
  },
};
