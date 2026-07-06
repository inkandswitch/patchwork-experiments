import {
  isImmutableString,
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";

// Deep-clone a document: clone it, then recursively clone every document it
// references and rewrite those references to point at the clones. References
// are found both as whole automerge-url strings (doc links, folder entries)
// and embedded inside longer strings — plain (`automerge:<id>`, e.g. markdown
// links) or URL-encoded (`automerge%3A<id>`, e.g. a card's `src` module path).
//
// `visited` maps original url -> clone url. It is written *before* recursing,
// so cycles and shared references resolve to a single clone. A `#heads` pin on
// a rewritten reference is dropped: the clone should serve its live latest
// content, not a version pinned for the original.
export async function deepCloneDoc(
  repo: Repo,
  url: AutomergeUrl,
  visited: Map<string, AutomergeUrl> = new Map(),
): Promise<AutomergeUrl> {
  const base = baseUrl(url);
  const existing = visited.get(base);
  if (existing) return existing;

  const handle = await repo.find(base as AutomergeUrl);
  const clone = repo.clone(handle);
  visited.set(base, clone.url);
  await rewriteClonedReferences(repo, clone, visited);
  return clone.url;
}

// The second half of a deep clone, for callers that must clone the root
// synchronously (the parts bin's dragstart writes its payload before any
// await): given an already-made clone, deep-clone everything it references and
// rewrite the clone's references in place.
export async function rewriteClonedReferences(
  repo: Repo,
  clone: DocHandle<unknown>,
  visited: Map<string, AutomergeUrl>,
): Promise<void> {
  const refs = collectReferences(clone.doc());

  for (const ref of refs) {
    if (visited.has(ref)) continue;
    try {
      await deepCloneDoc(repo, ref as AutomergeUrl, visited);
    } catch {
      // Unresolvable reference (unavailable doc): leave it pointing at the
      // original rather than failing the whole clone.
    }
  }

  clone.change((draft: unknown) => {
    rewriteValue(draft, visited);
  });
}

// A plain automerge url with a `#heads` pin allowed and ignored. Heads must be
// dropped before find/clone so we operate on the live document.
function baseUrl(url: string): string {
  return url.split("#")[0];
}

// Matches an automerge url plus any `#heads` pin trailing it, in both plain
// and URL-encoded (`%3A` for `:`, `%23` for `#`) spellings. The heads pin is
// captured with the match so a rewrite replaces the whole pinned reference.
const PLAIN_URL_PATTERN = /automerge:[A-Za-z0-9]+(?:#[A-Za-z0-9|]+)?/g;
const ENCODED_URL_PATTERN = /automerge%3A[A-Za-z0-9]+(?:%23[A-Za-z0-9|%7C]+)?/g;

// Every valid document url referenced anywhere in `value`, heads stripped.
// The `@patchwork` metadata subtree is skipped — its fields (type, title)
// never carry document links worth cloning.
function collectReferences(value: unknown, refs: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLAIN_URL_PATTERN)) {
      const url = baseUrl(match[0]);
      if (isValidAutomergeUrl(url)) refs.add(url);
    }
    for (const match of value.matchAll(ENCODED_URL_PATTERN)) {
      const url = baseUrl(decodeURIComponent(match[0]));
      if (isValidAutomergeUrl(url)) refs.add(url);
    }
    return refs;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, refs);
    return refs;
  }

  if (value && typeof value === "object" && !isImmutableString(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "@patchwork") continue;
      collectReferences(child, refs);
    }
  }

  return refs;
}

// Rewrite every mapped reference inside a mutable draft (called within a
// `change`). Only plain-string values are touched; ImmutableStrings (synced
// build artifacts) can't be edited in place and are left alone.
function rewriteValue(value: unknown, visited: Map<string, AutomergeUrl>): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i];
      if (typeof item === "string") {
        const next = rewriteString(item, visited);
        if (next !== item) value[i] = next;
      } else {
        rewriteValue(item, visited);
      }
    }
    return;
  }

  if (value && typeof value === "object" && !isImmutableString(value)) {
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (key === "@patchwork") continue;
      if (typeof child === "string") {
        const next = rewriteString(child, visited);
        if (next !== child) record[key] = next;
      } else {
        rewriteValue(child, visited);
      }
    }
  }
}

function rewriteString(value: string, visited: Map<string, AutomergeUrl>): string {
  return value
    .replace(PLAIN_URL_PATTERN, (match) => visited.get(baseUrl(match)) ?? match)
    .replace(ENCODED_URL_PATTERN, (match) => {
      const mapped = visited.get(baseUrl(decodeURIComponent(match)));
      return mapped ? encodeURIComponent(mapped) : match;
    });
}
