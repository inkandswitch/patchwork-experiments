// Matching source docs to scene:source providers. Pure.

/** Lower-case, no leading dot. */
export function normalizeExtension(ext) {
  return String(ext ?? "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();
}

/** Extension from a file name, "" if none. */
export function extensionOf(name) {
  const m = /\.([^./\\]+)$/.exec(String(name ?? ""));
  return m ? m[1].toLowerCase() : "";
}

/**
 * What a source doc is, for provider matching.
 * @returns {{ datatype: string | null, extension: string | null }}
 */
export function describeSource(doc) {
  const datatype = doc?.["@patchwork"]?.type ?? null;
  let extension = null;
  if (datatype === "file" || doc?.extension != null) {
    extension = normalizeExtension(doc?.extension) || extensionOf(doc?.name) || null;
  }
  return { datatype, extension };
}

/** Does this provider claim this source? */
export function providerMatches(provider, { datatype, extension }) {
  const sd = provider?.supportedDatatypes;
  const typeOk =
    sd === "*" || (Array.isArray(sd) && (sd.includes("*") || (datatype != null && sd.includes(datatype))));
  if (!typeOk) return false;
  const exts = Array.isArray(provider.extensions) ? provider.extensions.map(normalizeExtension) : null;
  if (exts && exts.length > 0) return extension != null && exts.includes(extension);
  return true;
}

/**
 * Providers for a source, most specific first: an exact datatype + extension
 * match beats a datatype-only match beats a wildcard.
 */
export function matchProviders(providers, source) {
  const score = (p) => {
    const sd = p.supportedDatatypes;
    const wild = sd === "*" || (Array.isArray(sd) && sd.includes("*"));
    const hasExt = Array.isArray(p.extensions) && p.extensions.length > 0;
    return (wild ? 0 : 2) + (hasExt ? 1 : 0);
  };
  return (providers ?? [])
    .filter((p) => p && p.id && providerMatches(p, source))
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ p }) => p);
}

/** Human description of a source, for "no provider for …" messages. */
export function describeForHumans({ datatype, extension }) {
  if (datatype === "file" && extension) return `.${extension} files`;
  if (datatype) return `“${datatype}” documents`;
  return "this document";
}
