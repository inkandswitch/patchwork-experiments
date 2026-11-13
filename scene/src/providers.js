// Matching source docs to scene:source providers, and routing an object's
// content by the kind its provider makes. Pure.

import { isGroup } from "./groups.js";

/**
 * The kinds of content a `scene:source` makes, which it declares as its
 * `content` (COMPOSITION.md §1):
 *   - "file": the source doc already is a GLB file. Its objects get no render
 *     doc; the stage shows the file as it is (the GLB queue).
 *   - "built": the provider builds a GLB from the source into a render doc of
 *     the object's own (the render manager).
 * A source that declares neither is not one the stage can use.
 */
export const CONTENT_KINDS = Object.freeze(["file", "built"]);

/** The kind of content a provider (scene:source metadata) makes, or null if it declares none the stage knows. */
export const contentOf = (provider) => (CONTENT_KINDS.includes(provider?.content) ? provider.content : null);

/**
 * Where the stage sends an object's content at sync: "built" for an object
 * with a render doc (only built content has one, and the render manager
 * shows what was built even where its provider isn't installed); else the
 * kind its provider makes, `kindOf(providerId)`; else null, nothing to load.
 * A provider that builds, for an object without a render doc, has nothing to
 * show either.
 * @param {object} o  the object, as the doc stores it
 * @param {(providerId: string) => string | null} kindOf  the content kind of a registered provider, else null
 * @returns {"file" | "built" | null}
 */
export function routeOf(o, kindOf) {
  if (!o || typeof o !== "object" || isGroup(o)) return null;
  if (o.renderUrl) return "built";
  const kind = typeof o.providerId === "string" && o.providerId ? kindOf(o.providerId) : null;
  return kind === "built" ? null : kind;
}

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
 * match beats a datatype-only match beats a wildcard. A provider that
 * declares no content kind (`contentOf`) is never one.
 */
export function matchProviders(providers, source) {
  const score = (p) => {
    const sd = p.supportedDatatypes;
    const wild = sd === "*" || (Array.isArray(sd) && sd.includes("*"));
    const hasExt = Array.isArray(p.extensions) && p.extensions.length > 0;
    return (wild ? 0 : 2) + (hasExt ? 1 : 0);
  };
  return (providers ?? [])
    .filter((p) => p && p.id && contentOf(p) && providerMatches(p, source))
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
