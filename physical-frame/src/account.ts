/**
 * Frame-tool account plumbing.
 *
 * physical-frame is a frame tool: its `handle` is the ACCOUNT doc. Its own
 * configuration lives in a separate `PhysicalFrameConfig` subdoc, whose URL is
 * stored on the account doc under `physicalFrameConfigUrl` and lazily created on
 * first mount (the idempotent `ensureSubdoc` pattern from patchwork-frame).
 */

import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  getRegistry,
  createDocOfDatatype2,
} from "@inkandswitch/patchwork-plugins";

/** Fields we read/write on the account doc; the rest is opaque. */
export type AccountDoc = {
  physicalFrameConfigUrl?: AutomergeUrl;
  /** root folder the sidebar lists/creates docs in (lazily ensured) */
  rootFolderUrl?: AutomergeUrl;
  /** tool id for the account sidebar (set by AccountDatatype.init) */
  accountSidebarToolId?: string;
} & Record<string, unknown>;

const CONFIG_DATATYPE_ID = "physical-frame";
/** Fallback when the account doc doesn't name a sidebar tool. */
export const DEFAULT_SIDEBAR_TOOL_ID = "chee/sideboard";

/** Wait for a datatype to be registered + loadable. */
async function loadDatatypeWhenReady(id: string) {
  const registry = getRegistry("patchwork:datatype");
  const immediate = await registry.load(id);
  if (immediate) return immediate;
  return new Promise<Awaited<ReturnType<typeof registry.load>>>((resolve) => {
    const off = registry.on("registered", async (plugin) => {
      if ((plugin as { id?: string }).id !== id) return;
      off();
      resolve(await registry.load(id));
    });
  });
}

/**
 * Idempotent "ensure a subdoc url on the account" (the patchwork-frame
 * `ensureSubdoc` pattern): if `field` is already set, return it; otherwise load
 * the datatype, create a doc, and store its url back. Concurrent tabs converge
 * (the `.change` only writes if still unset). Returns the url, or null if the
 * datatype never registered.
 */
async function ensureAccountSubdoc(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo,
  field: keyof AccountDoc,
  datatypeId: string,
): Promise<AutomergeUrl | null> {
  const existing = accountHandle.doc()?.[field] as AutomergeUrl | undefined;
  if (existing) return existing;
  const datatype = await loadDatatypeWhenReady(datatypeId);
  if (!datatype) {
    console.warn(`[physical-frame] datatype "${datatypeId}" never registered`);
    return null;
  }
  const again = accountHandle.doc()?.[field] as AutomergeUrl | undefined;
  if (again) return again;
  const subHandle = await createDocOfDatatype2(datatype as never, repo);
  accountHandle.change((doc) => {
    if (!doc[field]) (doc[field] as AutomergeUrl) = subHandle.url as AutomergeUrl;
  });
  return (
    (accountHandle.doc()?.[field] as AutomergeUrl | undefined) ??
    (subHandle.url as AutomergeUrl)
  );
}

/** Ensure the physical-frame config subdoc (`physicalFrameConfigUrl`). */
export function ensurePhysicalFrameConfig(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo,
): Promise<AutomergeUrl | null> {
  return ensureAccountSubdoc(
    accountHandle,
    repo,
    "physicalFrameConfigUrl",
    CONFIG_DATATYPE_ID,
  );
}

/** Ensure the account's root folder (`rootFolderUrl`) so the sidebar can list docs. */
export function ensureRootFolder(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo,
): Promise<AutomergeUrl | null> {
  return ensureAccountSubdoc(accountHandle, repo, "rootFolderUrl", "folder");
}
