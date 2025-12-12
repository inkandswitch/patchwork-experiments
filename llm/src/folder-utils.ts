import {
  AutomergeUrl,
  Repo,
  stringifyAutomergeUrl,
  parseAutomergeUrl,
  encodeHeads,
} from "@automerge/automerge-repo";
import { getHeads } from "@automerge/automerge";
import { FolderDoc, DocLink } from "@inkandswitch/patchwork-filesystem";

/**
 * Recursively traverses a folder and returns DocLinks for all documents, including nested folders.
 * Each DocLink's url contains the current heads of the document (e.g., automerge:docId#head1|head2).
 *
 * @param folderUrl - The URL of the folder to traverse
 * @param repo - The Automerge repo
 * @returns A flat list of DocLinks with heads encoded in the url
 */
export async function getFolderDocLinks(
  folderUrl: AutomergeUrl,
  repo: Repo
): Promise<DocLink[]> {
  const result: DocLink[] = [];

  const folderHandle = await repo.find<FolderDoc>(folderUrl);
  const folderDoc = folderHandle.doc();

  if (!folderDoc) {
    return result;
  }

  // Add the folder itself with heads
  const { documentId: folderId } = parseAutomergeUrl(folderUrl);
  result.push({
    name: folderDoc.title || "Folder",
    type: "folder",
    url: stringifyAutomergeUrl({
      documentId: folderId,
      heads: encodeHeads(getHeads(folderDoc)),
    }),
  });

  // Add all documents in the folder with heads
  if (folderDoc.docs) {
    for (const docRef of folderDoc.docs) {
      try {
        const handle = await repo.find(docRef.url);
        const doc = handle.doc();
        if (doc) {
          const { documentId } = parseAutomergeUrl(docRef.url);
          const docLink: DocLink = {
            name: docRef.name,
            type: docRef.type,
            url: stringifyAutomergeUrl({
              documentId,
              heads: encodeHeads(getHeads(doc)),
            }),
            icon: docRef.icon,
            copyOf: docRef.copyOf,
          };
          result.push(docLink);

          // Recursively traverse nested folders
          if (docRef.type === "folder") {
            const nestedLinks = await getFolderDocLinks(docRef.url, repo);
            // Skip the first item (the folder itself) since we already added it
            result.push(...nestedLinks.slice(1));
          }
        }
      } catch (e) {
        console.error(`Error loading document ${docRef.url}:`, e);
      }
    }
  }

  return result;
}

/**
 * Compares two lists of DocLinks and returns DocLinks that have been added or changed.
 * Comparison is done by matching the url field (which contains heads).
 *
 * @param oldList - The previous list of DocLinks with heads in url
 * @param newList - The current list of DocLinks with heads in url
 * @returns DocLinks that are new or have changed heads
 */
export function getChangedDocLinks(
  oldList: DocLink[],
  newList: DocLink[]
): DocLink[] {
  const oldUrls = new Set(oldList.map((link) => link.url));
  return newList.filter((link) => !oldUrls.has(link.url));
}
