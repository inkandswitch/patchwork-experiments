// Dropped things → sources ({ path, size, read() }): plain files, whole
// folders (a mod's cache, or all of Mods/), and .zip files. Nothing is read
// until the importer asks for it, so dropping the whole Mods folder (gigabytes
// of other mods' images) only costs the files this mod uses.

import { unzipSync } from "fflate";
import { extensionOf } from "./cache.js";

const source = (path, size, read) => ({ path, size, read });

const fileSource = (file, path = file.webkitRelativePath || file.name) => source(path, file.size, async () => new Uint8Array(await file.arrayBuffer()));

/** A zip's entries as sources (the archive is read once; each entry inflated when read). */
export async function sourcesFromZip(bytes, name = "archive.zip") {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = [];
  unzipSync(data, {
    filter(f) {
      if (!f.name.endsWith("/")) entries.push({ name: f.name, size: f.originalSize });
      return false;
    },
  });
  return entries.map((e) =>
    source(`${name}/${e.name}`, e.size, async () => {
      const out = unzipSync(data, { filter: (f) => f.name === e.name });
      return out[e.name];
    }),
  );
}

async function expand(file, path) {
  if (extensionOf(file.name) === "zip") return sourcesFromZip(new Uint8Array(await file.arrayBuffer()), path);
  return [fileSource(file, path)];
}

function readAll(dirReader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () =>
      dirReader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walkEntry(entry, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push(...(await expand(file, entry.fullPath.replace(/^\//, ""))));
  } else if (entry.isDirectory) {
    for (const child of await readAll(entry.createReader())) await walkEntry(child, out);
  }
}

/** FileSystemEntry objects from a drop (take them before awaiting anything) → sources. */
export async function sourcesFromEntries(entries) {
  const out = [];
  for (const e of entries) await walkEntry(e, out);
  return out;
}

/** An <input type=file> FileList (files or a folder) → sources. */
export async function sourcesFromFiles(files) {
  const out = [];
  for (const f of [...(files ?? [])]) out.push(...(await expand(f, f.webkitRelativePath || f.name)));
  return out;
}
