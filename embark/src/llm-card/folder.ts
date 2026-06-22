import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { DirectoryDoc, FileDoc, LlmCardDoc } from "./types";

// Generated files are served as ES modules, so every leaf carries this hint
// (the service worker turns `mimeType` into the response content-type).
const JS_MIME = "text/javascript";

// Ensure the card has a directory doc to hold its generated files and return
// its url. A directory doc maps file paths to automerge urls of FileDocs (see
// core/filesystem resolve.ts); the service worker walks it to serve files.
export async function ensureFolder(
  repo: Repo,
  cardHandle: DocHandle<LlmCardDoc>,
): Promise<AutomergeUrl> {
  const existing = cardHandle.doc()?.folderUrl;
  if (existing) return existing;

  const dir = repo.create<DirectoryDoc>({
    "@patchwork": { type: "directory", title: "llm-card effect" },
  });
  cardHandle.change((doc) => {
    doc.folderUrl = dir.url;
  });
  return dir.url;
}

// Write a file into the folder. A FRESH FileDoc is created every call and the
// directory entry is repointed at it, so the directory doc's heads advance on
// every write - that is what the loader relies on to cache-bust the import url.
export async function writeFile(
  repo: Repo,
  folderUrl: AutomergeUrl,
  path: string,
  content: string,
): Promise<void> {
  const file = repo.create<FileDoc>({ content, mimeType: JS_MIME });
  const dir = await repo.find<DirectoryDoc>(folderUrl);
  dir.change((doc) => {
    doc[path] = file.url;
  });
}

// Read a file's source back, following the directory entry to its FileDoc.
export async function readFile(
  repo: Repo,
  folderUrl: AutomergeUrl,
  path: string,
): Promise<string | undefined> {
  const dir = await repo.find<DirectoryDoc>(folderUrl);
  const entry = dir.doc()?.[path];
  if (typeof entry !== "string") return undefined;
  const file = await repo.find<FileDoc>(entry as AutomergeUrl);
  const content = file.doc()?.content;
  return typeof content === "string" ? content : undefined;
}

// List the file paths currently in the folder (every key except metadata).
export async function listFiles(
  repo: Repo,
  folderUrl: AutomergeUrl,
): Promise<string[]> {
  const dir = await repo.find<DirectoryDoc>(folderUrl);
  const doc = dir.doc();
  if (!doc) return [];
  return Object.keys(doc).filter((key) => key !== "@patchwork");
}
