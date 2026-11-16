// A run's flow volume, kept: the mesh and the last time's fields, as
// OpenFOAM wrote them, split by meaning so a reader fetches only what it
// shows. One `openfoam-volume` doc indexes it:
//
//   mesh:   { points: [piece 0, piece 1, …], faces: […], owner, neighbour, boundary, …Zones }
//   fields: { p: [piece 0, …], U: […], k, omega, nut, phi, yPlus, alpha.water, … }
//
// A piece is a processor's part of a parallel run (processor0…), or the
// whole case for a run on one core. Each entry is the file's bytes: inline
// when it's under INLINE_BYTES, else a ref to segment docs (src/segments.js,
// which says why nothing big goes in one doc). Files are OpenFOAM's own,
// binary with their FoamFile headers; src/volume.js reads them back.
//
// The writer waits for the sync server to have each file before going on
// (a few files at a time), and says what never arrived.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { putBytes, INLINE_BYTES } from "../src/segments.js";
import { VOLUME_TYPE, VOLUME_VERSION, MESH_FILES } from "../src/volume.js";

const isTime = (n) => /^[0-9.eE+-]+$/.test(n) && Number.isFinite(+n);

/**
 * What a case directory holds to keep: its pieces, its last time, and the
 * files by meaning.
 * @returns {{ time: string, pieces: string[], mesh: Record<string, string[]>, fields: Record<string, string[]> }}
 *   paths per name, one per piece, in piece order (a name every piece lacks is left out)
 */
export function volumeFiles(dir) {
  const procs = readdirSync(dir).filter((n) => /^processor\d+$/.test(n)).sort((a, b) => +a.slice(9) - +b.slice(9));
  const pieces = procs.length ? procs.map((p) => join(dir, p)) : [dir];
  const times = readdirSync(pieces[0]).filter((n) => isTime(n) && +n > 0).sort((a, b) => +a - +b);
  const time = times.at(-1);
  if (!time) throw new Error("no time written past 0");
  const mesh = {};
  for (const name of MESH_FILES) {
    const paths = pieces.map((p) => join(p, "constant", "polyMesh", name));
    if (paths.every((x) => existsSync(x))) mesh[name] = paths;
  }
  const fields = {};
  const names = readdirSync(join(pieces[0], time)).filter((n) => statSync(join(pieces[0], time, n)).isFile()).sort();
  for (const name of names) {
    const paths = pieces.map((p) => join(p, time, name));
    if (paths.every((x) => existsSync(x))) fields[name] = paths;
  }
  if (!mesh.points || !mesh.faces || !mesh.owner) throw new Error("the mesh isn't all there");
  return { time, pieces: pieces.map((p) => (p === dir ? "." : p.slice(dir.length + 1))), mesh, fields };
}

/**
 * Keep a case's flow volume in docs.
 * @param {object} o
 * @param {object} o.repo
 * @param {string} o.dir         the case directory
 * @param {string} o.runUrl
 * @param {string} o.title
 * @param {{ wait: Function }} o.watch   serverWatch(repo), started before this
 * @param {Function} [o.verify]  freshPeer(…).verify: fetch what the server didn't acknowledge
 * @param {(p: { done: number, of: number }) => void} [o.progress]   bytes confirmed so far
 * @param {number} [o.parallel]  files in flight at once
 * @returns {Promise<{ url: string, bytes: number, docs: number, files: number, missing: string[], verified: number, confirmed: boolean|null }>}
 *   verified: docs the server didn't acknowledge but a fresh peer fetched
 */
export async function keepVolume({ repo, dir, runUrl, title, watch, verify = null, progress = () => {}, parallel = 4, timeoutMs = 300_000, cells = null }) {
  const v = volumeFiles(dir);
  const jobs = [];
  for (const [kind, by] of [["mesh", v.mesh], ["fields", v.fields]])
    for (const [name, paths] of Object.entries(by)) paths.forEach((path, piece) => jobs.push({ kind, name, piece, path, size: statSync(path).size }));
  const of = jobs.reduce((n, j) => n + j.size, 0);
  const out = { mesh: {}, fields: {} };
  for (const [kind, by] of [["mesh", v.mesh], ["fields", v.fields]]) for (const name of Object.keys(by)) out[kind][name] = new Array(v.pieces.length).fill(null);
  const missing = [];
  let done = 0, docs = 0, unknown = false, next = 0, verified = 0;

  await Promise.all(
    Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const bytes = readFileSync(j.path);
        if (bytes.byteLength < INLINE_BYTES) {
          out[j.kind][j.name][j.piece] = new Uint8Array(bytes);
        } else {
          const { ref, handles } = await putBytes(repo, bytes, { title: `${title} · ${j.name} · ${v.pieces[j.piece]}` });
          out[j.kind][j.name][j.piece] = ref;
          docs += handles.length;
          const r = await watch.wait(handles, { timeoutMs, verify });
          if (r.ok === false) missing.push(`${j.name} (${v.pieces[j.piece]})`);
          if (r.ok === null) unknown = true;
          verified += r.verified ?? 0;
        }
        done += j.size;
        progress({ done, of });
      }
    }),
  );

  const bytes = { mesh: 0, fields: {} };
  for (const j of jobs) {
    if (j.kind === "mesh") bytes.mesh += j.size;
    else bytes.fields[j.name] = (bytes.fields[j.name] ?? 0) + j.size;
  }
  const index = await repo.create2({
    "@patchwork": { type: VOLUME_TYPE },
    version: VOLUME_VERSION,
    title: `${title} · flow volume`,
    run: runUrl,
    time: v.time,
    pieces: v.pieces,
    cells,
    format: "foam-binary",
    mesh: out.mesh,
    fields: out.fields,
    bytes,
    total: of,
    missing,
  });
  const r = await watch.wait([index], { timeoutMs, verify });
  if (r.ok === false) missing.push("the index");
  if (r.ok === null) unknown = true;
  verified += r.verified ?? 0;
  docs += 1;
  // confirmed: true when the server has all of it, false when something never arrived, null when this repo can't tell
  return { url: index.url, bytes: of, docs, files: jobs.length, missing, verified, confirmed: missing.length ? false : unknown ? null : true };
}
