import {
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";

// Deep-copy a document and everything it links to. We clone the document, then
// walk its contents for values that are automerge urls; each linked doc is
// cloned in turn and the stored url is rewritten to point at the fresh clone.
// The result is a fully independent copy that shares no documents with the
// original — duplicating a card also duplicates its spec, folder, and files.
//
// Exception: the root `@patchwork` object holds patchwork metadata (type, copy
// bookkeeping, etc.). We never look inside it, so any urls there are left as-is.
export async function deepCloneDocument(
  repo: Repo,
  url: AutomergeUrl,
): Promise<AutomergeUrl> {
  // Memoize source → clone so shared subdocuments are cloned once and cyclic
  // links terminate instead of recursing forever.
  return cloneInto(repo, url, new Map());
}

async function cloneInto(
  repo: Repo,
  sourceUrl: AutomergeUrl,
  seen: Map<AutomergeUrl, AutomergeUrl>,
): Promise<AutomergeUrl> {
  const memoized = seen.get(sourceUrl);
  if (memoized) return memoized;

  const sourceHandle = await repo.find(sourceUrl);
  const clone = repo.clone(sourceHandle) as DocHandle<Record<string, unknown>>;
  seen.set(sourceUrl, clone.url);

  const snapshot = clone.doc();
  if (!snapshot) return clone.url;

  // Cloning is async and can't run inside `change`, so first collect every
  // (path → cloned url) rewrite, then apply them all in a single change.
  const rewrites: Rewrite[] = [];
  await collectRewrites(repo, snapshot, [], rewrites, seen, true);

  if (rewrites.length > 0) {
    clone.change((draft) => {
      for (const { path, url } of rewrites) setAtPath(draft, path, url);
    });
  }

  return clone.url;
}

type Rewrite = { path: (string | number)[]; url: AutomergeUrl };

async function collectRewrites(
  repo: Repo,
  value: unknown,
  path: (string | number)[],
  rewrites: Rewrite[],
  seen: Map<AutomergeUrl, AutomergeUrl>,
  isRoot: boolean,
): Promise<void> {
  const linked = automergeUrl(value);
  if (linked) {
    try {
      rewrites.push({ path, url: await cloneInto(repo, linked, seen) });
    } catch {
      // A linked doc we can't load/clone is left pointing at the original.
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      await collectRewrites(repo, value[i], [...path, i], rewrites, seen, false);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      // Skip the document's patchwork metadata at the root: its urls are
      // bookkeeping, not content, and must not be followed or cloned.
      if (isRoot && key === "@patchwork") continue;
      await collectRewrites(
        repo,
        (value as Record<string, unknown>)[key],
        [...path, key],
        rewrites,
        seen,
        false,
      );
    }
  }
}

// Validate via automerge's url parser (it throws on anything that isn't a real
// document url) and normalize to the canonical document url, so arbitrary
// strings in the doc are left alone and heads-pinned urls dedupe cleanly.
function automergeUrl(value: unknown): AutomergeUrl | null {
  if (typeof value !== "string") return null;
  try {
    const { documentId } = parseAutomergeUrl(value as AutomergeUrl);
    return `automerge:${documentId}` as AutomergeUrl;
  } catch {
    return null;
  }
}

function setAtPath(
  target: Record<string, unknown>,
  path: (string | number)[],
  value: AutomergeUrl,
): void {
  let cursor: unknown = target;
  for (let i = 0; i < path.length - 1; i++) {
    cursor = (cursor as Record<string | number, unknown>)[path[i]];
  }
  (cursor as Record<string | number, unknown>)[path[path.length - 1]] = value;
}
