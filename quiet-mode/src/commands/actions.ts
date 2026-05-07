import {
  deleteAt,
  updateText,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import {
  type DatatypeDescription,
  type DatatypeImplementation,
  getRegistry,
} from "@inkandswitch/patchwork-plugins";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import { getType } from "@inkandswitch/patchwork-filesystem";
import { getCurrentDocHandle, dispatchOpenEvent } from "./utils.js";
import type { AccountDoc, DocLink } from "./types.js";

export async function getRootFolderHandle(
  accountDocHandle: DocHandle<AccountDoc>,
  repo: Repo
): Promise<DocHandle<FolderDoc> | undefined> {
  const accountDoc = accountDocHandle.doc();
  if (!accountDoc?.rootFolderUrl) return;
  return repo.find<FolderDoc>(accountDoc.rootFolderUrl);
}

export function findCurrentDocIndex(folder: FolderDoc): number {
  const handle = getCurrentDocHandle();
  if (!handle) return -1;
  return folder.docs.findIndex(
    (d: { url: AutomergeUrl }) => d.url === handle.url
  );
}

export async function saveDocToRootFolder(
  accountDocHandle: DocHandle<AccountDoc>,
  repo: Repo,
  isCurrentDocSaved: () => boolean
) {
  const handle = getCurrentDocHandle();
  if (!handle || isCurrentDocSaved()) return;

  const doc = handle.doc();
  if (!doc) return;

  const docType = getType(doc);
  let title = "Untitled";
  if (docType) {
    const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
    const loaded = registry.get(docType);
    if (loaded && "module" in loaded) {
      title = (loaded.module as DatatypeImplementation).getTitle(doc) || title;
    }
  }

  const rootFolder = await getRootFolderHandle(accountDocHandle, repo);
  if (!rootFolder) return;

  rootFolder.change((folder) => {
    folder.docs.unshift({
      name: title,
      url: handle.url,
      type: docType || "",
    });
  });
}

export async function removeDocFromRootFolder(
  accountDocHandle: DocHandle<AccountDoc>,
  repo: Repo
) {
  const rootFolder = await getRootFolderHandle(accountDocHandle, repo);
  if (!rootFolder) return;
  const folder = rootFolder.doc();
  if (!folder?.docs) return;
  const index = findCurrentDocIndex(folder);
  if (index === -1) return;
  rootFolder.change((f) => deleteAt(f.docs, index));
}

export function copyDocUrl() {
  const handle = getCurrentDocHandle();
  if (!handle) return;
  navigator.clipboard.writeText(handle.url);
}

export async function submitRename(
  newName: string,
  accountDocHandle: DocHandle<AccountDoc>,
  repo: Repo
) {
  const handle = getCurrentDocHandle();
  if (!handle) return;

  const trimmed = newName.trim();
  if (!trimmed) return;

  const rootFolder = await getRootFolderHandle(accountDocHandle, repo);
  if (!rootFolder) return;
  const folder = rootFolder.doc();
  if (!folder?.docs) return;
  const index = findCurrentDocIndex(folder);
  if (index === -1) return;

  rootFolder.change((doc) => {
    updateText(doc, ["docs", index, "name"], trimmed);
  });

  const docDoc = handle.doc();
  const docType = getType(docDoc);
  if (docType) {
    const datatypes = getRegistry<DatatypeDescription>("patchwork:datatype");
    const datatype = datatypes.get(docType);
    if (datatype) {
      await datatypes.load(datatype.id);
      if ("module" in datatype) {
        handle.change((doc: any) =>
          (datatype.module as any).setTitle?.(doc, trimmed)
        );
      }
    }
  }
}
