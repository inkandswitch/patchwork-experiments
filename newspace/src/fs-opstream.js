// A local-file opstream backed by the File System Access API — the lb "real file"
// backend. Unlike an automerge stream (which auto-persists), a file must be saved
// explicitly, so its complement carries a `save()` FUNCTION (presence = the
// affordance). It is a plain in-memory `Opstream` of the file's text: edits apply
// via the universal COW `apply`, and `save()` writes the current value back to
// disk through the file handle.
import { Opstream } from "./opstreams.js";

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

// Build a text opstream from a FileSystemFileHandle (already-picked). The stream's
// complement carries `save()` (write-back), `name`, `mimeType`, `extension`, and
// the `fileHandle` itself.
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
    },
  });

  // capability: write the current value back to the OS file
  stream.complement.save = async () => {
    const writable = await fileHandle.createWritable();
    await writable.write(stream.value);
    await writable.close();
    return stream.value;
  };

  return stream;
}

// Prompt the user to pick a local file, then open it as an opstream. Resolves to
// null if the picker is unavailable or the user cancels.
export async function openLocalFile(options = {}) {
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
  return fileHandleOpstream(fileHandle);
}
