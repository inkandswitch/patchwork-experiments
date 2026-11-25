// Fetch data as work: what the Terrain tool's Fetch data button does,
// wherever it runs. The tool asks for it through the task system's doWork
// (task-client.js), so it runs on the person's own queue when one of their
// machines serves it (in a browser's run worker, or a Node run thread), and
// otherwise in the page. So it touches no DOM, and imports nothing a worker
// could not: everything it needs is in this package.
//
// Its input is { terrain: <the Terrain doc's url>, spec: <what it asks for> }
// (fetchRequest in fetch-spec.js), and its key is the SHA-256 of that spec, so
// a task fetches exactly what its key names. It fetches the spec
// (fetch-data.js) and stores it (store.js) only if the doc still asks for it:
// a person may move the frame while the task waits or fetches, and data for
// the old frame must not land on the new one.
// What it returns is small, the file docs' urls and a line for a person;
// the data itself is in those docs.
//
// It may run more than once for one asking (tasks run at least once); a
// second run fetches and stores again, which leaves the doc pointing at data
// that is as good as the first.

import { findWhenThere } from "./task-client.js";
import { fetchTerrainData, STOPPED } from "./fetch-data.js";
import { storeTerrainData } from "./store.js";
import { fetchSpec, sameSpec } from "./fetch-spec.js";

/** The stages a person sees while it runs (ctx.progress). */
export const STAGES = Object.freeze({
  finding: "Opening the terrain…",
  fetching: "Fetching the heights and the shore…",
  storing: "Storing the data…",
});

/** What it says, and returns, when the doc came to ask for something else after it was asked. */
export const MOVED = "The place or its settings changed after the data was asked for, so nothing was stored. Fetch again for the new place.";

/** What it fails with when the Terrain doc cannot be had. */
export const UNREACHABLE = "The terrain could not be opened to fetch its data.";

/** The line a person sees when it is done. */
export function doneLine(fetched) {
  const s = fetched.summary;
  return `Done: ${s.coastWays} coastline ways, ${s.structures} structures, ${s.marks} marks; heights ${s.min.toFixed(1)} to ${s.max.toFixed(1)} m (${fetched.dem.record.datum}).`;
}

/**
 * Fetch and store a Terrain doc's data. `fetch` is the network's (a test
 * passes its own).
 * @param {{ terrain: string }} input
 * @param {{ repo: any, log: (...a: unknown[]) => void, progress: (v: unknown) => void, signal: AbortSignal }} ctx
 * @returns {Promise<{ stored: boolean, message: string, dem?: string, features?: string, layers?: string | null, look?: string | null }>}
 */
export async function fetchTerrain(input, ctx, fetch = (...a) => globalThis.fetch(...a)) {
  const url = input?.terrain;
  const spec = input?.spec;
  if (typeof url !== "string" || !url.startsWith("automerge:") || !spec || typeof spec !== "object") throw new Error("No terrain was named to fetch data for.");
  ctx.progress(STAGES.finding);
  // what findWhenThere throws names the doc by its url, which is no message for a person
  const handle = await findWhenThere(ctx.repo, url).catch(() => {
    throw new Error(UNREACHABLE);
  });
  // asked for still: not stopped, and the doc wants what was asked for
  const wanted = (doc) => !ctx.signal?.aborted && sameSpec(fetchSpec(doc), spec);
  if (!ctx.signal?.aborted && !wanted(handle.doc())) {
    ctx.log(MOVED);
    return { stored: false, message: MOVED };
  }
  ctx.progress(STAGES.fetching);
  const fetched = await fetchTerrainData(spec, { fetch, log: (line) => ctx.log(line), signal: ctx.signal });
  if (wanted(handle.doc())) {
    ctx.progress(STAGES.storing);
    ctx.log("Storing…");
  }
  const urls = await storeTerrainData(ctx.repo, handle, fetched, { when: wanted });
  if (!urls) {
    if (ctx.signal?.aborted) throw new Error(STOPPED);
    ctx.log(MOVED);
    return { stored: false, message: MOVED };
  }
  const message = doneLine(fetched);
  ctx.log(message);
  return { stored: true, message, ...urls };
}

/** The task: fetchTerrain with the network's fetch. */
export default function fetchTerrainTask(input, ctx) {
  return fetchTerrain(input, ctx ?? this);
}
