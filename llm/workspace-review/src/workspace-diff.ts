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
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { diffLines } from "diff";
import type { WorkspaceDoc, MappingEntry, FileChange, DiffRow } from "./types";

// ---- Tree walking ----

type TreeEntry = {
  url: AutomergeUrl;
  path: string;
  type: string;
  docType: string; // @patchwork.type of the document
};

/**
 * Recursively walk a FolderDoc tree and build a flat map of URL -> entry.
 * When `mappings` is provided, folder URLs are resolved through the COW
 * overlay (i.e. if a clone exists for a folder, the clone is used instead).
 * Keying by URL avoids collisions when multiple entries share the same name.
 */
async function walkTree(
  repo: Repo,
  folderUrl: AutomergeUrl,
  mappings: Record<string, MappingEntry> | null,
  prefix: string = ""
): Promise<Map<AutomergeUrl, TreeEntry>> {
  const result = new Map<AutomergeUrl, TreeEntry>();

  const effectiveUrl = mappings
    ? (mappings[folderUrl]?.cloneUrl ?? folderUrl)
    : folderUrl;

  const handle = await repo.find<FolderDoc>(effectiveUrl);
  await handle.whenReady();
  const doc = handle.doc();

  if (!doc || !doc.docs) return result;

  for (const link of doc.docs) {
    const childPath = prefix ? `${prefix}/${link.name}` : link.name;
    const childUrl = link.url;

    if (link.type === "folder") {
      result.set(childUrl, { url: childUrl, path: childPath, type: "folder", docType: "folder" });
      const subtree = await walkTree(repo, childUrl, mappings, childPath);
      for (const [k, v] of subtree) {
        result.set(k, v);
      }
    } else {
      const docType = await readDocType(repo, childUrl, mappings);
      result.set(childUrl, { url: childUrl, path: childPath, type: link.type || "file", docType });
    }
  }

  return result;
}

/** Read the @patchwork.type from a document, resolving through the overlay if needed. */
async function readDocType(
  repo: Repo,
  url: AutomergeUrl,
  mappings: Record<string, MappingEntry> | null
): Promise<string> {
  try {
    const effectiveUrl = mappings
      ? (mappings[url]?.cloneUrl ?? url)
      : url;
    const handle = await repo.find(effectiveUrl);
    await handle.whenReady();
    const doc = handle.doc() as any;
    return doc?.["@patchwork"]?.type ?? "file";
  } catch {
    return "file";
  }
}

// ---- Changeset computation ----

/**
 * Compare original tree vs overlay tree to produce a list of file changes.
 * Matching is done by document URL (not path) so duplicate names don't collide.
 * Folders themselves are not reported -- only leaf documents.
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

  console.log("[workspace-diff] mappings:", Object.keys(mappings).length, "entries");
  console.log("[workspace-diff] originalTree:", originalTree.size, "entries");
  for (const [url, entry] of originalTree) {
    console.log(`  original: ${entry.path} (${entry.type}/${entry.docType}) url=${url}`);
  }
  console.log("[workspace-diff] overlayTree:", overlayTree.size, "entries");
  for (const [url, entry] of overlayTree) {
    console.log(`  overlay: ${entry.path} (${entry.type}/${entry.docType}) url=${url}`);
  }

  const changes: FileChange[] = [];
  const createdUrls = new Set(workspaceDoc.createdUrls || []);

  // For each document in the original tree, match by URL in the overlay tree
  for (const [url, origEntry] of originalTree) {
    if (origEntry.type === "folder") {
      console.log(`[workspace-diff] skipping folder: ${origEntry.path} url=${url}`);
      continue;
    }

    const overlayEntry = overlayTree.get(url);

    if (!overlayEntry) {
      console.log(`[workspace-diff] DELETED: ${origEntry.path} url=${url} (not in overlay)`);
      const content = origEntry.docType === "file"
        ? await readFileContent(repo, origEntry.url)
        : undefined;
      changes.push({
        path: origEntry.path,
        changeType: "deleted",
        docType: origEntry.docType,
        originalContent: content,
        originalUrl: origEntry.url,
      });
      continue;
    }

    const pathChanged = origEntry.path !== overlayEntry.path;
    const mappingEntry = mappings[url];
    console.log(`[workspace-diff] comparing url=${url}: origPath="${origEntry.path}" overlayPath="${overlayEntry.path}" pathChanged=${pathChanged} hasMapping=${!!mappingEntry}`);

    if (mappingEntry) {
      // Document was cloned (modified, or moved+modified)
      const cloneUrl = mappingEntry.cloneUrl;
      const originalUrlWithHeads = mappingEntry.originalUrlWithHeads;

      if (origEntry.docType === "file") {
        const origContent = await readFileContent(repo, origEntry.url);
        const modContent = await readFileContent(repo, cloneUrl);
        const contentChanged = origContent !== modContent;

        if (pathChanged && contentChanged) {
          changes.push({
            path: overlayEntry.path,
            oldPath: origEntry.path,
            changeType: "moved",
            docType: origEntry.docType,
            originalContent: origContent,
            modifiedContent: modContent,
            originalUrl: origEntry.url,
            cloneUrl,
            originalUrlWithHeads,
          });
        } else if (pathChanged) {
          // Moved but content identical (clone exists but no text diff)
          changes.push({
            path: overlayEntry.path,
            oldPath: origEntry.path,
            changeType: "moved",
            docType: origEntry.docType,
            originalUrl: origEntry.url,
            cloneUrl,
            originalUrlWithHeads,
          });
        } else if (contentChanged) {
          changes.push({
            path: origEntry.path,
            changeType: "modified",
            docType: origEntry.docType,
            originalContent: origContent,
            modifiedContent: modContent,
            originalUrl: origEntry.url,
            cloneUrl,
            originalUrlWithHeads,
          });
        }
        // else: clone exists but content is identical and path unchanged — treat as unchanged
        else {
          changes.push({
            path: origEntry.path,
            changeType: "unchanged",
            docType: origEntry.docType,
            originalUrl: origEntry.url,
          });
        }
      } else {
        // Non-file doc with a clone
        if (pathChanged) {
          changes.push({
            path: overlayEntry.path,
            oldPath: origEntry.path,
            changeType: "moved",
            docType: origEntry.docType,
            originalUrl: origEntry.url,
            cloneUrl,
            originalUrlWithHeads,
          });
        } else {
          changes.push({
            path: origEntry.path,
            changeType: "modified",
            docType: origEntry.docType,
            originalUrl: origEntry.url,
            cloneUrl,
            originalUrlWithHeads,
          });
        }
      }
    } else if (pathChanged) {
      // No clone but path differs — pure move
      changes.push({
        path: overlayEntry.path,
        oldPath: origEntry.path,
        changeType: "moved",
        docType: origEntry.docType,
        originalUrl: origEntry.url,
      });
    } else {
      // Same URL, same path, no mapping — unchanged
      changes.push({
        path: origEntry.path,
        changeType: "unchanged",
        docType: origEntry.docType,
        originalUrl: origEntry.url,
      });
    }
  }

  // Find added files — new docs created by the agent are tracked in createdUrls
  for (const [url, entry] of overlayTree) {
    if (entry.type === "folder") continue;
    if (!createdUrls.has(url)) continue;

    const content = entry.docType === "file"
      ? await readFileContent(repo, entry.url)
      : undefined;
    changes.push({
      path: entry.path,
      changeType: "added",
      docType: entry.docType,
      modifiedContent: content,
      cloneUrl: entry.url,
    });
  }

  console.log("[workspace-diff] total changes:", changes.length);
  for (const c of changes) {
    console.log(`  ${c.changeType}: ${c.path}${c.oldPath ? ` (from ${c.oldPath})` : ""} docType=${c.docType}`);
  }

  // Sort: modified first, then moved, added, deleted, unchanged last
  const order: Record<string, number> = {
    modified: 0, moved: 1, added: 2, deleted: 3, unchanged: 4,
  };
  changes.sort(
    (a, b) =>
      (order[a.changeType] ?? 9) - (order[b.changeType] ?? 9) ||
      a.path.localeCompare(b.path)
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
 * Phase 1: CRDT merge -- merge clone history into originals.
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

  // Phase 1: CRDT merge — merge each clone back into its original.
  // Mapping keys may contain pinned heads, so we strip them to get
  // the live writable handle for the original document.
  for (const [originalUrl, entry] of Object.entries(mappings)) {
    const { documentId } = parseAutomergeUrl(originalUrl as AutomergeUrl);
    const bareUrl = stringifyAutomergeUrl({ documentId });

    const originalHandle = await repo.find(bareUrl);
    await originalHandle.whenReady();
    const cloneHandle = await repo.find(entry.cloneUrl);
    await cloneHandle.whenReady();

    if (!originalHandle.doc() || !cloneHandle.doc()) continue;

    originalHandle.merge(cloneHandle);
  }

  // Phase 2: Heads propagation -- update head-pinned URLs bottom-up
  await propagateHeads(repo, ws.rootFolderUrl);

  // Phase 3: Clear mappings and created URLs
  workspaceHandle.change((ws) => {
    ws.mappings = {} as any;
    ws.createdUrls = [] as unknown as AutomergeUrl[];
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

  // Update URLs to include current heads.
  // HACK: match pushwork's behavior for caching — also pin heads on file-type
  // documents even if they didn't previously have heads.
  let needsUpdate = false;
  const updatedDocs: { index: number; newUrl: AutomergeUrl }[] = [];

  for (let i = 0; i < doc.docs.length; i++) {
    const link = doc.docs[i];
    const parsed = parseAutomergeUrl(link.url);
    const alreadyHadHeads = parsed.heads && parsed.heads.length > 0;

    const shouldPinHeads = alreadyHadHeads || link.type === "file";
    if (!shouldPinHeads) continue;

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

  if (needsUpdate) {
    handle.change((d) => {
      for (const { index, newUrl } of updatedDocs) {
        (d.docs[index] as any).url = newUrl;
      }
    });
  }
}
