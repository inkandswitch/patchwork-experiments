/**
 * Workspace diff utilities.
 *
 * Walks the original and overlay trees of a WorkspaceDoc to detect changes,
 * computes line-level diffs for side-by-side rendering, and provides a merge
 * function that writes cloned content back to originals with heads propagation.
 */

import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo";
import type { FolderDoc, DocLink } from "@inkandswitch/patchwork-filesystem";
import { diffLines } from "diff";
import type { WorkspaceDoc, FileChange, DiffRow } from "./types";

// ---- Tree walking ----

type TreeEntry = {
  url: AutomergeUrl;
  type: string;
};

/**
 * Recursively walk a FolderDoc tree and build a flat map of path -> entry.
 * When `mappings` is provided, URLs are resolved through the COW overlay
 * (i.e. if a clone exists for a URL, the clone is used instead).
 */
async function walkTree(
  repo: Repo,
  folderUrl: AutomergeUrl,
  mappings: Record<string, AutomergeUrl> | null,
  prefix: string = ""
): Promise<Map<string, TreeEntry>> {
  const result = new Map<string, TreeEntry>();

  const effectiveUrl = mappings
    ? ((mappings[folderUrl] as AutomergeUrl) ?? folderUrl)
    : folderUrl;

  const handle = await repo.find<FolderDoc>(effectiveUrl);
  await handle.whenReady();
  const doc = handle.doc();

  if (!doc || !doc.docs) return result;

  for (const link of doc.docs) {
    const childPath = prefix ? `${prefix}/${link.name}` : link.name;
    const childUrl = link.url;

    if (link.type === "folder") {
      result.set(childPath, { url: childUrl, type: "folder" });
      const subtree = await walkTree(repo, childUrl, mappings, childPath);
      for (const [k, v] of subtree) {
        result.set(k, v);
      }
    } else {
      result.set(childPath, { url: childUrl, type: link.type || "file" });
    }
  }

  return result;
}

// ---- Changeset computation ----

/**
 * Compare original tree vs overlay tree to produce a list of file changes.
 * Folders themselves are not reported -- only leaf files.
 */
export async function computeChangeset(
  repo: Repo,
  workspaceDoc: WorkspaceDoc
): Promise<FileChange[]> {
  const { rootFolderUrl, mappings } = workspaceDoc;
  if (!rootFolderUrl || !mappings || Object.keys(mappings).length === 0) {
    return [];
  }

  const originalTree = await walkTree(repo, rootFolderUrl, null);
  const overlayTree = await walkTree(repo, rootFolderUrl, mappings);

  const changes: FileChange[] = [];

  // Find modified and deleted files
  for (const [path, origEntry] of originalTree) {
    if (origEntry.type === "folder") continue;

    const overlayEntry = overlayTree.get(path);

    if (!overlayEntry) {
      // Deleted: exists in original but not in overlay
      const content = await readFileContent(repo, origEntry.url);
      changes.push({
        path,
        changeType: "deleted",
        originalContent: content,
        originalUrl: origEntry.url,
      });
    } else {
      // Check if modified: the overlay resolved to a different URL
      const resolvedOverlayUrl =
        (mappings[overlayEntry.url] as AutomergeUrl) ?? overlayEntry.url;
      const resolvedOrigUrl = origEntry.url;

      if (resolvedOverlayUrl !== resolvedOrigUrl) {
        const origContent = await readFileContent(repo, resolvedOrigUrl);
        const modContent = await readFileContent(repo, resolvedOverlayUrl);
        if (origContent !== modContent) {
          changes.push({
            path,
            changeType: "modified",
            originalContent: origContent,
            modifiedContent: modContent,
            originalUrl: origEntry.url,
            cloneUrl: resolvedOverlayUrl,
          });
        }
      }
    }
  }

  // Find added files
  const linkedUrls = new Set(workspaceDoc.linkedUrls || []);

  for (const [path, overlayEntry] of overlayTree) {
    if (overlayEntry.type === "folder") continue;
    if (originalTree.has(path)) continue;

    const isLinked = linkedUrls.has(overlayEntry.url);
    const cloneUrl = mappings[overlayEntry.url] as AutomergeUrl | undefined;

    if (isLinked && !cloneUrl) {
      // Linked but not modified — skip
      continue;
    }

    if (isLinked && cloneUrl) {
      // Linked and then modified — show as modified
      const origContent = await readFileContent(repo, overlayEntry.url);
      const modContent = await readFileContent(repo, cloneUrl);
      if (origContent !== modContent) {
        changes.push({
          path,
          changeType: "modified",
          originalContent: origContent,
          modifiedContent: modContent,
          originalUrl: overlayEntry.url,
          cloneUrl,
        });
      }
    } else {
      // Truly new file (created by the agent)
      const resolvedUrl = cloneUrl ?? overlayEntry.url;
      const content = await readFileContent(repo, resolvedUrl);
      changes.push({
        path,
        changeType: "added",
        modifiedContent: content,
        cloneUrl: resolvedUrl,
      });
    }
  }

  // Sort: modified first, then added, then deleted; alphabetically within each group
  const order = { modified: 0, added: 1, deleted: 2 };
  changes.sort(
    (a, b) =>
      order[a.changeType] - order[b.changeType] || a.path.localeCompare(b.path)
  );

  return changes;
}

async function readFileContent(
  repo: Repo,
  url: AutomergeUrl
): Promise<string> {
  try {
    const handle = await repo.find(url);
    await handle.whenReady();
    const doc = handle.doc() as any;
    if (!doc || doc.content === undefined) return "";

    if (typeof doc.content === "string") return doc.content;
    if (doc.content instanceof Uint8Array)
      return new TextDecoder().decode(doc.content);
    return String(doc.content);
  } catch {
    return "";
  }
}

// ---- Line diff for side-by-side rendering ----

/**
 * Compute a side-by-side diff from two strings.
 * Returns an array of DiffRow, where each row has a left and right DiffLine.
 * Spacer lines are inserted to keep sides aligned.
 */
export function computeSideBySideDiff(
  oldText: string,
  newText: string
): DiffRow[] {
  const changes = diffLines(oldText, newText);
  const rows: DiffRow[] = [];

  let oldLineNo = 1;
  let newLineNo = 1;

  let i = 0;
  while (i < changes.length) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      // Unchanged
      const lines = splitLines(change.value);
      for (const line of lines) {
        rows.push({
          left: {
            type: "unchanged",
            oldLineNo: oldLineNo++,
            content: line,
          },
          right: {
            type: "unchanged",
            newLineNo: newLineNo++,
            content: line,
          },
        });
      }
      i++;
      continue;
    }

    // Collect adjacent removed + added as a modification pair
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    if (change.removed) {
      removedLines.push(...splitLines(change.value));
      i++;
      if (i < changes.length && changes[i].added) {
        addedLines.push(...splitLines(changes[i].value));
        i++;
      }
    } else if (change.added) {
      addedLines.push(...splitLines(change.value));
      i++;
    }

    const maxLen = Math.max(removedLines.length, addedLines.length);

    for (let j = 0; j < maxLen; j++) {
      const left: DiffRow["left"] =
        j < removedLines.length
          ? { type: "removed", oldLineNo: oldLineNo++, content: removedLines[j] }
          : { type: "spacer", content: "" };

      const right: DiffRow["right"] =
        j < addedLines.length
          ? { type: "added", newLineNo: newLineNo++, content: addedLines[j] }
          : { type: "spacer", content: "" };

      rows.push({ left, right });
    }
  }

  return rows;
}

/** Split a diff chunk value into lines, dropping the trailing empty string from a final newline. */
function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

// ---- Merge ----

/**
 * Merge all workspace overlay changes back into the original documents.
 *
 * Phase 1: Content merge -- copy clone content to originals.
 * Phase 2: Heads propagation -- update head-pinned URLs bottom-up.
 * Phase 3: Clear mappings.
 */
export async function mergeChanges(
  repo: Repo,
  workspaceHandle: DocHandle<WorkspaceDoc>
): Promise<void> {
  const ws = workspaceHandle.doc();
  if (!ws || !ws.mappings || Object.keys(ws.mappings).length === 0) return;

  const mappings = { ...ws.mappings };

  // Build reverse mapping: cloneUrl -> originalUrl
  const reverseMap = new Map<string, AutomergeUrl>();
  for (const [origUrl, cloneUrl] of Object.entries(mappings)) {
    reverseMap.set(cloneUrl, origUrl as AutomergeUrl);
  }

  // Phase 1: Content merge
  for (const [originalUrl, cloneUrl] of Object.entries(mappings)) {
    const originalHandle = await repo.find(originalUrl as AutomergeUrl);
    await originalHandle.whenReady();
    const cloneHandle = await repo.find(cloneUrl);
    await cloneHandle.whenReady();

    const originalDoc = originalHandle.doc() as any;
    const cloneDoc = cloneHandle.doc() as any;

    if (!originalDoc || !cloneDoc) continue;

    if (cloneDoc.content !== undefined) {
      // File: copy content
      originalHandle.change((d: any) => {
        d.content = cloneDoc.content;
      });
    } else if (Array.isArray(cloneDoc.docs)) {
      // Folder: sync the docs array, translating cloned URLs back to originals
      const translatedDocs = (cloneDoc.docs as DocLink[]).map(
        (link: DocLink) => {
          const origUrl = reverseMap.get(link.url);
          return origUrl ? { ...link, url: origUrl } : link;
        }
      );

      originalHandle.change((d: any) => {
        d.docs = translatedDocs;
      });
    }
  }

  // Phase 2: Heads propagation -- update head-pinned URLs bottom-up
  await propagateHeads(repo, ws.rootFolderUrl);

  // Phase 3: Clear mappings and linked URLs
  workspaceHandle.change((ws) => {
    ws.mappings = {} as Record<string, AutomergeUrl>;
    ws.linkedUrls = [] as unknown as AutomergeUrl[];
  });
}

/**
 * Walk the folder tree bottom-up. For any DocLink whose URL contains pinned
 * heads, update it to reference the current heads of the target document.
 * Processing bottom-up ensures children are finalized before parents.
 */
async function propagateHeads(
  repo: Repo,
  folderUrl: AutomergeUrl
): Promise<void> {
  const handle = await repo.find<FolderDoc>(folderUrl);
  await handle.whenReady();
  const doc = handle.doc();

  if (!doc || !doc.docs) return;

  // Recurse into child folders first (bottom-up)
  for (const link of doc.docs) {
    if (link.type === "folder") {
      await propagateHeads(repo, link.url);
    }
  }

  // Now update any head-pinned URLs in this folder's docs
  let needsUpdate = false;
  const updatedDocs: { index: number; newUrl: AutomergeUrl }[] = [];

  for (let i = 0; i < doc.docs.length; i++) {
    const link = doc.docs[i];
    const parsed = parseAutomergeUrl(link.url);

    if (parsed.heads && parsed.heads.length > 0) {
      // This URL has pinned heads -- update to current heads
      const childHandle = await repo.find(link.url);
      await childHandle.whenReady();
      const currentHeads = childHandle.heads();

      if (currentHeads) {
        const newUrl = stringifyAutomergeUrl({
          documentId: parsed.documentId,
          heads: currentHeads,
        });

        if (newUrl !== link.url) {
          updatedDocs.push({ index: i, newUrl });
          needsUpdate = true;
        }
      }
    }
  }

  if (needsUpdate) {
    handle.change((d) => {
      for (const { index, newUrl } of updatedDocs) {
        (d.docs[index] as any).url = newUrl;
      }
    });
  }
}
