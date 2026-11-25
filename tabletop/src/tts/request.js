// What a TTS import asks for, and the key it is asked under.
//
// Dropping a mod stores what was dropped as file docs (dropped.js); the
// request is those files and the settings to import them with, and it is
// written whole on the import doc as `request`. Its id is the SHA-256 of
// the files and the settings, so the same files with the same settings are
// the same request, however often they are asked for. The import task's
// input and its key are both made from one request (importAsk), so a task
// imports exactly what its key names, and the task checks that the doc
// still asks for that request before it writes anything.

/**
 * @typedef {{ path: string, url: string, size: number }} StoredFile  a dropped file, kept in a file doc
 * @typedef {{ id: string, files: StoredFile[], settings: object }} ImportRequest
 */

/**
 * JSON with every object's keys in order, so that one request reads the same
 * whatever order its fields were written in (two replicas, or a copy).
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// automerge takes fresh plain values, never undefined
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

/**
 * The request to import these stored files with these settings.
 * @param {StoredFile[]} files
 * @param {object} settings
 * @returns {Promise<ImportRequest>}
 */
export async function importRequest(files, settings) {
  const body = { files: plain(files.map(({ path, url, size }) => ({ path, url, size }))), settings: plain(settings) };
  return { id: await sha256Hex(canonicalJson(body)), ...body };
}

/** Whether two requests ask for the same import (absent asks for nothing, so is never the same). */
export function sameRequest(a, b) {
  return !!a && !!b && canonicalJson(a) === canonicalJson(b);
}

/**
 * What an import of `importUrl`'s request is asked as: the task's input (the
 * import doc and the request) and its key, both from the one request.
 * @param {string} importUrl  the tts-import doc
 * @param {ImportRequest} request
 */
export function importAsk(importUrl, request) {
  return { input: { import: importUrl, request: plain(request) }, key: `tts-import:${importUrl}:${request.id}` };
}
