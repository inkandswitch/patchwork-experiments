// Accepting Patchwork documents: drag-and-drop payloads and pasted URLs.
// Copied from scene/src/dnd.js (packages never import each other).
//
// The sidebar (and anything following its convention, e.g. universal-dnd) sets
// `text/x-patchwork-dnd` = { source, items: [{ url, name?, type? }] } and the
// simpler `text/x-patchwork-urls` = [url]. `text/plain` is the raw url.
// Adapted from patchwork-experiments/openscad/src/dnd.ts.

const DND_MIME = "text/x-patchwork-dnd";
const URLS_MIME = "text/x-patchwork-urls";

export function hasPatchworkDrop(dt) {
  const types = dt?.types ? [...dt.types] : [];
  return types.includes(DND_MIME) || types.includes(URLS_MIME) || types.includes("text/plain");
}

/** @returns {{ url: string, name?: string, type?: string }[]} */
export function parsePatchworkDrop(dt) {
  const out = [];
  const push = (item) => {
    const url = parseAutomergeUrl(item?.url);
    if (url && !out.some((o) => o.url === url)) out.push({ url, name: item.name, type: item.type });
  };

  const dnd = safeGet(dt, DND_MIME);
  if (dnd) {
    try {
      const parsed = JSON.parse(dnd);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [parsed];
      for (const item of items) push(item);
    } catch {
      // fall through
    }
  }
  if (out.length === 0) {
    const urls = safeGet(dt, URLS_MIME);
    if (urls) {
      try {
        const list = JSON.parse(urls);
        if (Array.isArray(list)) for (const url of list) push({ url });
      } catch {
        // ignore
      }
    }
  }
  if (out.length === 0) {
    for (const line of (safeGet(dt, "text/plain") ?? "").split(/\s+/)) push({ url: line });
  }
  return out;
}

function safeGet(dt, type) {
  try {
    return dt?.getData?.(type) || "";
  } catch {
    return "";
  }
}

/**
 * Normalise what a person might paste into an automerge URL:
 *   automerge:2j9…            → as is (heads / path suffixes dropped)
 *   https://…/#doc=2j9…       → automerge:2j9…
 *   https://…/?doc=automerge:2j9… etc.
 *   2j9…  (bare base58 id)    → automerge:2j9…
 * @returns {string | null}
 */
export function parseAutomergeUrl(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  const idRe = /^[1-9A-HJ-NP-Za-km-z]{20,60}$/; // base58check document id
  let m = /automerge:([1-9A-HJ-NP-Za-km-z]+)/.exec(s);
  if (m && idRe.test(m[1])) return `automerge:${m[1]}`;
  m = /[#?&](?:doc|docUrl|url)=(?:automerge(?::|%3A))?([1-9A-HJ-NP-Za-km-z]+)/i.exec(s);
  if (m && idRe.test(m[1])) return `automerge:${m[1]}`;
  if (idRe.test(s)) return `automerge:${s}`;
  return null;
}
