import { isValidAutomergeUrl } from "@automerge/automerge-repo";

export type RefValidity = "empty" | "valid" | "invalid";

/**
 * Extract the document-URL portion of a ref.
 *
 * TEMPORARY: a ref is `automerge:<docId>/<path>` (optionally `#<heads>`). We
 * split off the doc URL and validate only that, because the current
 * `isValidAutomergeUrl` validates a bare doc URL, not a full ref. Refs and
 * Automerge doc handles are slated to merge soon — once that lands, this split
 * can be dropped in favour of validating the whole ref directly.
 */
export function refDocUrl(url: string): string {
  const scheme = "automerge:";
  const rest = url.startsWith(scheme) ? url.slice(scheme.length) : url;
  let end = rest.length;
  for (const ch of ["/", "#"]) {
    const i = rest.indexOf(ch);
    if (i >= 0 && i < end) end = i;
  }
  return scheme + rest.slice(0, end);
}

/** Live validity of a typed ref URL, for inline feedback. */
export function validateRef(url: string): RefValidity {
  const trimmed = url.trim();
  if (!trimmed) return "empty";
  return isValidAutomergeUrl(refDocUrl(trimmed)) ? "valid" : "invalid";
}
