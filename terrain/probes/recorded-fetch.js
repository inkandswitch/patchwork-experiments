// A fetch that answers from a recording: what probes/fetch-cadboro.mjs
// fetched from NCEI and Overpass, kept on disk as an index and one file per
// answer. Node records through it; the browser probes replay through it, so
// the template's own fetch code runs against the real (recorded) answers
// without asking the servers again.
//
//   index.json: { "<key>": { url, method, status, contentType, file, fetched } }
//   key: SHA-256 of `${method}\n${url}\n${body}`

export async function requestKey(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const bytes = new TextEncoder().encode(`${method}\n${url}\n${body}`);
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A fetch over a recording. `index` the recording's index; `load(file)` → its bytes;
 * `fallback` (optional) for requests not recorded (else they fail, loudly).
 */
export function replayFetch({ index, load, fallback = null, seen = [] }) {
  return async (input, init = {}) => {
    const key = await requestKey(input, init);
    const hit = index[key];
    if (!hit) {
      if (fallback) return fallback(input, init);
      throw new Error(`Not in the recording: ${(init.method ?? "GET").toUpperCase()} ${String(typeof input === "string" ? input : input.url).slice(0, 120)}`);
    }
    seen.push(hit.url);
    const bytes = await load(hit.file);
    return new Response(bytes, { status: hit.status, headers: { "content-type": hit.contentType ?? "application/octet-stream" } });
  };
}
