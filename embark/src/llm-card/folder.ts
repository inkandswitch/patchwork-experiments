import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type {
  FileDoc,
  FolderDoc,
  LlmCardDoc,
  MarkdownDoc,
} from "./types";

// Generated code is served as ES modules; application/javascript is a valid
// module MIME so the browser loads the file as real ESM via import().
const JS_MIME = "application/javascript";

// Ensure the card has a folder doc to hold its generated files and return its
// url. A folder doc is `{ docs: DocLink[] }` (the patchwork "folder" strategy):
// the service worker resolves a path by matching docs[].name and following the
// link to a FileDoc, which it serves using the file's mimeType.
export async function ensureFolder(
  repo: Repo,
  cardHandle: DocHandle<LlmCardDoc>,
): Promise<AutomergeUrl> {
  const existing = cardHandle.doc()?.folderUrl;
  if (existing) return existing;

  const folder = repo.create<FolderDoc>({
    "@patchwork": { type: "folder", title: "llm-card effect" },
    title: "llm-card effect",
    docs: [],
  });
  cardHandle.change((doc) => {
    doc.folderUrl = folder.url;
  });
  return folder.url;
}

// Create an empty markdown doc to back a card's spec and return its url. Used
// both when a card is first created (datatype init) and lazily on Activate.
export function createSpecDoc(repo: Repo): AutomergeUrl {
  const spec = repo.create<MarkdownDoc>({
    "@patchwork": { type: "markdown" },
    content: "",
  });
  return spec.url;
}

// Ensure the card has a markdown doc for its human-readable spec and return its
// url. The user edits it freely; the generation loop writes the high-level part.
export async function ensureSpec(
  repo: Repo,
  cardHandle: DocHandle<LlmCardDoc>,
): Promise<AutomergeUrl> {
  const existing = cardHandle.doc()?.specUrl;
  if (existing) return existing;

  const url = createSpecDoc(repo);
  cardHandle.change((doc) => {
    doc.specUrl = url;
  });
  return url;
}

// Write a file into the folder. A FRESH FileDoc is created every call and the
// folder's docs entry is repointed at it, so the folder doc's heads advance on
// every write - that is what the loader relies on to cache-bust the import url.
export async function writeFile(
  repo: Repo,
  folderUrl: AutomergeUrl,
  name: string,
  content: string,
  mimeType: string = JS_MIME,
): Promise<void> {
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? name.slice(dotIndex) : "";
  const file = repo.create<FileDoc>({
    "@patchwork": { type: "file", title: name },
    name,
    extension,
    mimeType,
    content,
  });
  const folder = await repo.find<FolderDoc>(folderUrl);
  folder.change((doc) => {
    const link = doc.docs.find((entry) => entry.name === name);
    if (link) link.url = file.url;
    else doc.docs.push({ name, type: "file", url: file.url });
  });
}

// Read a file's source back, following the docs entry to its FileDoc.
export async function readFile(
  repo: Repo,
  folderUrl: AutomergeUrl,
  name: string,
): Promise<string | undefined> {
  const fileUrl = await getFileUrl(repo, folderUrl, name);
  if (!fileUrl) return undefined;
  const file = await repo.find<FileDoc>(fileUrl);
  const content = file.doc()?.content;
  return typeof content === "string" ? content : undefined;
}

// The automerge url of a file in the folder, for pointing a <patchwork-view>
// (the code tab) straight at the FileDoc.
export async function getFileUrl(
  repo: Repo,
  folderUrl: AutomergeUrl,
  name: string,
): Promise<AutomergeUrl | undefined> {
  const folder = await repo.find<FolderDoc>(folderUrl);
  return folder.doc()?.docs?.find((entry) => entry.name === name)?.url;
}

// List the file names currently in the folder.
export async function listFiles(
  repo: Repo,
  folderUrl: AutomergeUrl,
): Promise<string[]> {
  const folder = await repo.find<FolderDoc>(folderUrl);
  return (folder.doc()?.docs ?? []).map((entry) => entry.name);
}

// Advance the folder doc's heads without changing any file. A hand edit in the
// code tab mutates the FileDoc, not the folder, so the loader's heads-pinned
// import url would still hit the module cache; touching the folder forces a miss.
export async function touchFolder(
  repo: Repo,
  folderUrl: AutomergeUrl,
): Promise<void> {
  const folder = await repo.find<FolderDoc>(folderUrl);
  folder.change((doc) => {
    doc.lastSyncAt = Date.now();
  });
}

// Write the card's plain-language spec into its markdown doc.
export async function writeSpec(
  repo: Repo,
  specUrl: AutomergeUrl,
  markdown: string,
): Promise<void> {
  const spec = await repo.find<MarkdownDoc>(specUrl);
  spec.change((doc) => {
    doc.content = markdown;
  });
}

// Read the spec markdown back (the previous version, when iterating).
export async function readSpec(
  repo: Repo,
  specUrl: AutomergeUrl,
): Promise<string | undefined> {
  const spec = await repo.find<MarkdownDoc>(specUrl);
  const content = spec.doc()?.content;
  return typeof content === "string" ? content : undefined;
}
