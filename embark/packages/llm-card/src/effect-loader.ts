import {
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import type { EffectModule, FolderDoc } from "./types";

// Load the generated effect module and return its default export.
//
// The module is served by the host service worker straight out of the card's
// folder (a "directory" doc). We pin the import url to the folder doc's CURRENT
// heads: `stringifyAutomergeUrl({ documentId, heads })` yields
// `automerge:<id>#<heads>`, which we percent-encode and prefix with `/` so the
// `#` survives as a path segment (the service worker decodes the pathname back
// into the special url - matching the redirect format in automerge-worker.ts).
//
// Because the heads advance on every writeFile, the url changes every
// generation, so the browser/SW module cache (keyed by url) misses and fresh
// code is loaded.
export async function loadEffect(
  repo: Repo,
  folderUrl: AutomergeUrl,
  entry: string,
): Promise<EffectModule["default"]> {
  const folder = await repo.find<FolderDoc>(folderUrl);
  const pinned = stringifyAutomergeUrl({
    documentId: folder.documentId,
    heads: folder.heads(),
  });
  const importUrl = `/${encodeURIComponent(pinned)}/${entry}`;

  const mod = (await import(/* @vite-ignore */ importUrl)) as EffectModule;
  if (typeof mod.default !== "function") {
    throw new Error(`${entry} has no default export function`);
  }
  return mod.default;
}
