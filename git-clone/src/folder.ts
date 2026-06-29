import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { FileBlob } from "./clone";
import { lookupMimeType } from "./mime";
import type { DocLink, FileDoc, FolderDoc } from "./types";

type TreeNode = {
  dirs: Map<string, TreeNode>;
  files: Map<string, Uint8Array>;
};

const emptyNode = (): TreeNode => ({ dirs: new Map(), files: new Map() });

/**
 * Build a tree of Patchwork `folder` + `file` documents from a flat list of
 * working-tree files, and return the root folder's URL.
 *
 * The document shapes match pushwork's `patchwork-folder` shape exactly, so the
 * result is browsable in Patchwork (Space / folder views) and round-trippable
 * with `pushwork clone`.
 */
export function buildFolderFromFiles(
  repo: Repo,
  files: FileBlob[],
  rootTitle: string,
): AutomergeUrl {
  const tree = buildTree(files);
  return createFolderDoc(repo, tree, rootTitle);
}

function buildTree(files: FileBlob[]): TreeNode {
  const root = emptyNode();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      let next = node.dirs.get(segment);
      if (!next) {
        next = emptyNode();
        node.dirs.set(segment, next);
      }
      node = next;
    }
    node.files.set(parts[parts.length - 1], file.bytes);
  }
  return root;
}

function createFolderDoc(
  repo: Repo,
  node: TreeNode,
  title: string,
): AutomergeUrl {
  const docs: DocLink[] = [];
  const names = [
    ...new Set([...node.dirs.keys(), ...node.files.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const childDir = node.dirs.get(name);
    if (childDir) {
      const url = createFolderDoc(repo, childDir, name);
      docs.push({ name, type: "folder", url });
    } else {
      const bytes = node.files.get(name)!;
      const handle = repo.create<FileDoc>(makeFileDoc(name, bytes));
      docs.push({ name, type: linkFileType(name), url: handle.url });
    }
  }

  const handle = repo.create<FolderDoc>({
    "@patchwork": { type: "folder" },
    title,
    docs,
  });
  return handle.url;
}

function makeFileDoc(name: string, bytes: Uint8Array): FileDoc {
  const extension = extname(name);
  return {
    "@patchwork": { type: "file" },
    content: bytesToContent(bytes),
    extension,
    mimeType: lookupMimeType(extension),
    name,
  };
}

/**
 * Store UTF-8 text as a (CRDT-mergeable) string, everything else as raw bytes.
 * Mirrors pushwork's `bytesToContent` for non-artifact files.
 */
function bytesToContent(bytes: Uint8Array): string | Uint8Array {
  if (bytes.includes(0)) return bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes;
  }
  const reencoded = new TextEncoder().encode(text);
  if (reencoded.length !== bytes.length) return bytes;
  for (let i = 0; i < bytes.length; i++) {
    if (reencoded[i] !== bytes[i]) return bytes;
  }
  return text;
}

function extname(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function linkFileType(name: string): string {
  return extname(name) || "file";
}
