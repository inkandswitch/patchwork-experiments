// Accepting Patchwork documents: drag-and-drop payloads and pasted URLs.
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

/**
 * @returns {{ url: string, heads?: string[], name?: string, type?: string }[]}
 *   `heads` only when the dropped URL names a version (see parseAutomergeLink)
 */
export function parsePatchworkDrop(dt) {
  const out = [];
  const push = (item) => {
    const link = parseAutomergeLink(item?.url);
    if (!link) return;
    const { url, heads } = link;
    const same = (o) => o.url === url && (o.heads ?? []).join("|") === (heads ?? []).join("|");
    if (out.some(same)) return;
    const entry = { url, name: item.name, type: item.type };
    if (heads) entry.heads = heads;
    out.push(entry);
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

const B58 = "[1-9A-HJ-NP-Za-km-z]";
const ID_RE = new RegExp(`^${B58}{20,60}$`); // base58check document id
// A head as automerge-repo writes it in a URL: a base58check change hash (a
// 32-byte hash + 4-byte checksum comes to 48–50 characters).
const HEAD_RE = new RegExp(`^${B58}{40,60}$`);

function decoded(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Sorted heads from a `h1|h2` section, or null if it is empty or any head is malformed. */
function headsFrom(section) {
  if (!section) return null;
  const heads = section.split(/[|,]/).filter(Boolean);
  if (!heads.length || !heads.every((h) => HEAD_RE.test(h))) return null;
  return [...new Set(heads)].sort();
}

/**
 * Normalise what a person might paste or drop into an automerge URL, and the
 * version it names, if it names one:
 *   automerge:2j9…                         → { url: "automerge:2j9…", heads: null }
 *   automerge:2j9…#h1|h2                   → heads ["h1", "h2"] (automerge-repo's
 *                                            stringifyAutomergeUrl form: base58check
 *                                            heads, `|`-joined)
 *   https://…/#doc=automerge:2j9…#h1|h2&tool=…   (a Patchwork link at a version)
 *   https://…/#doc=2j9…&heads=h1|h2        (older Patchwork links)
 *   https://…/?doc=automerge%3A2j9…%23h1   (percent-encoded)
 *   2j9…  (bare base58 id)                 → no heads
 * A path suffix (`automerge:2j9…/a/b`) is dropped. Heads that don't look like
 * heads are ignored (the result follows the latest version).
 * @returns {{ url: string, heads: string[] | null } | null}
 */
export function parseAutomergeLink(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const s = decoded(raw);
  let m = new RegExp(`automerge:(${B58}+)(?:/[^#&\\s]*)?(?:#([^&\\s]*))?`).exec(s);
  if (m && ID_RE.test(m[1])) return { url: `automerge:${m[1]}`, heads: headsFrom(m[2]) ?? headsParam(s) };
  m = new RegExp(`[#?&](?:doc|docUrl|url)=(${B58}+)`, "i").exec(s);
  if (m && ID_RE.test(m[1])) return { url: `automerge:${m[1]}`, heads: headsParam(s) };
  if (ID_RE.test(s)) return { url: `automerge:${s}`, heads: null };
  return null;
}

function headsParam(s) {
  const m = /[#?&]heads=([^&\s]*)/.exec(s);
  return m ? headsFrom(m[1]) : null;
}

/**
 * Just the document URL from anything parseAutomergeLink accepts; any heads
 * or path suffix is dropped.
 * @returns {string | null}
 */
export function parseAutomergeUrl(input) {
  return parseAutomergeLink(input)?.url ?? null;
}
