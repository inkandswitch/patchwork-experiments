// A local-file opstream backed by the File System Access API — the lb "real file"
// backend. Unlike an automerge stream (which auto-persists), a file must be saved
// explicitly, so its complement carries a `save()` FUNCTION (presence = the
// affordance). It is a plain in-memory `Opstream` of the file's text: edits apply
// via the universal COW `apply`, and `save()` writes the current value back to
// disk through the file handle.
import { Opstream, Source } from "./opstreams.js";
import { snapshot } from "./ops.js";

const MIME_BY_EXT = {
  js: "text/javascript", jsx: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  ts: "text/typescript", tsx: "text/typescript",
  md: "text/markdown", markdown: "text/markdown", mdx: "text/markdown",
  css: "text/css", json: "application/json", yaml: "text/yaml", yml: "text/yaml",
  html: "text/html", txt: "text/plain",
};

function mimeFor(name, fallback) {
  if (fallback) return fallback;
  const ext = (name.split(".").pop() || "").toLowerCase();
  return MIME_BY_EXT[ext] || "text/plain";
}

// a plain value snapshot of a File (what the `file` Source emits). The File and
// handle ride in the complement; this is the JSON-shaped, lens-friendly value.
export function fileSnapshot(file, text) {
  const name = file.name;
  return {
    name,
    type: mimeFor(name, file.type),
    size: file.size,
    lastModified: file.lastModified,
    extension: (name.split(".").pop() || "").toLowerCase(),
    text,
  };
}

// has the file on disk changed since we last saw `prevMod`? (pure, testable)
export const diskChanged = (prevMod, file) => !!file && file.lastModified !== prevMod;
// does the in-memory stream differ from what we last loaded from disk? i.e. the
// "dirtied in the viewer" guard — when true we must NOT clobber with a reload.
export const isDirty = (streamValue, lastDiskText) => streamValue !== lastDiskText;

// Build a text opstream from a FileSystemFileHandle (already-picked). The stream's
// complement carries `save()` (write-back), `name`, `mimeType`, `extension`, the
// `fileHandle`, and the disk baseline (`diskText`/`lastModified`) the watcher uses.
export async function fileHandleOpstream(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const name = file.name;

  const stream = new Opstream(text, {
    complement: {
      fileSystem: true,
      fileHandle,
      name,
      mimeType: mimeFor(name, file.type),
      extension: (name.split(".").pop() || "").toLowerCase(),
      diskText: text, // baseline: what's currently on disk
      lastModified: file.lastModified,
    },
  });

  // capability: write the current value back to the OS file (and re-baseline so the
  // watcher doesn't treat our own write as an external change to reload)
  stream.complement.save = async () => {
    const writable = await fileHandle.createWritable();
    await writable.write(stream.value);
    await writable.close();
    try { const f = await fileHandle.getFile(); stream.complement.lastModified = f.lastModified; } catch {}
    stream.complement.diskText = stream.value;
    return stream.value;
  };

  return stream;
}

// Watch an editable file opstream: poll the handle and, when the file changes on
// disk AND the stream isn't dirty, reload it. Returns a stop function. (The "if not
// dirtied in the viewer" behaviour from the design — unsaved edits win.)
export function watchFileStream(stream, { intervalMs = 1500 } = {}) {
  const c = (stream && stream.complement) || {};
  const handle = c.fileHandle;
  if (!handle || typeof setInterval !== "function") return () => {};
  const id = setInterval(async () => {
    let file;
    try { file = await handle.getFile(); } catch { return; }
    if (!diskChanged(c.lastModified, file)) return;
    c.lastModified = file.lastModified;
    if (isDirty(stream.value, c.diskText)) return; // unsaved edits → keep them
    const text = await file.text();
    c.diskText = text;
    if (typeof stream.apply === "function") stream.apply(snapshot(text));
  }, intervalMs);
  return () => clearInterval(id);
}

// Prompt the user to pick a local file → its FileSystemFileHandle (or null on
// cancel). Throws if the API is unavailable.
export async function pickFile(options = {}) {
  if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function") {
    throw new Error("File System Access API is unavailable in this browser");
  }
  let fileHandle;
  try {
    [fileHandle] = await window.showOpenFilePicker(options);
  } catch (e) {
    if (e && e.name === "AbortError") return null; // user cancelled
    throw e;
  }
  return fileHandle;
}

// Prompt the user to pick a local file, then open it as an EDITABLE text opstream.
export async function openLocalFile(options = {}) {
  const fileHandle = await pickFile(options);
  return fileHandle ? fileHandleOpstream(fileHandle) : null;
}

// Load a picked file into an EXISTING read-only Source and keep it fresh by
// watching the disk (a read-only source always reflects disk — no edits to be
// dirty — so reload is unconditional). Returns a stop function. Used by the file
// Source node, whose Source is created synchronously (so it registers as an outlet
// immediately) and filled here after the user picks.
export async function startFileSource(stream, fileHandle, { intervalMs = 1500 } = {}) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  Object.assign(stream.complement, { fileSystem: true, fileHandle, file, name: file.name });
  stream.push(fileSnapshot(file, text));
  let lastMod = file.lastModified;
  let id = null;
  if (typeof setInterval === "function") {
    id = setInterval(async () => {
      let f;
      try { f = await fileHandle.getFile(); } catch { return; }
      if (!diskChanged(lastMod, f)) return;
      lastMod = f.lastModified;
      const t = await f.text();
      stream.complement.file = f;
      stream.push(fileSnapshot(f, t)); // unconditional: a source reflects disk
    }, intervalMs);
  }
  return () => { if (id) clearInterval(id); };
}

// Pick a file and emit a fresh read-only Source `{ stream, stop }` (or null on
// cancel) — the standalone form, for tests / non-UI use.
export async function openFileSource({ intervalMs = 1500, options = {} } = {}) {
  const fileHandle = await pickFile(options);
  if (!fileHandle) return null;
  const stream = new Source(null, { complement: {} });
  const stop = await startFileSource(stream, fileHandle, { intervalMs });
  return { stream, stop };
}
