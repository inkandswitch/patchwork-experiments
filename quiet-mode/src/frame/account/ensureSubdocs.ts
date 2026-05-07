import type { DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createDocOfDatatype2,
  getRegistry,
  type DatatypeDescription,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";
import type { AccountDoc } from "../types";

type SubdocField = "rootFolderUrl" | "moduleSettingsUrl" | "contactUrl";

/**
 * Wait for a datatype to be loadable, returning the loaded datatype.
 *
 * The account datatype is bundled with the frame and is always registered
 * by the time this runs, but subdoc datatypes (contact, etc.) can live in
 * separately-loaded plugin bundles, so we have to tolerate late registration.
 */
async function loadDatatypeWhenReady<D>(
  id: string
): Promise<LoadedDatatype<D> | undefined> {
  const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
  const immediate = await registry.load(id);
  if (immediate) return immediate as LoadedDatatype<D>;
  return new Promise((resolve) => {
    const off = registry.on("registered", async (plugin) => {
      if (plugin.id !== id) return;
      off();
      resolve((await registry.load(id)) as LoadedDatatype<D> | undefined);
    });
  });
}

async function ensureSubdoc<S>(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo,
  field: SubdocField,
  datatypeId: string
) {
  if (accountHandle.doc()?.[field]) return;
  const datatype = await loadDatatypeWhenReady<S>(datatypeId);
  if (!datatype) {
    console.warn(
      `frame: datatype "${datatypeId}" never registered; skipping ${field}`
    );
    return;
  }
  if (accountHandle.doc()?.[field]) return;
  const subHandle = await createDocOfDatatype2<S>(datatype, repo);
  accountHandle.change((doc) => {
    if (!doc[field]) doc[field] = subHandle.url;
  });
}

/**
 * Lazily populate every subdoc URL the frame depends on. Idempotent: fields
 * already set (including those set concurrently by another tab) win.
 */
export async function ensureAccountSubdocs(
  accountHandle: DocHandle<AccountDoc>,
  repo: Repo
) {
  await Promise.all([
    ensureSubdoc(accountHandle, repo, "rootFolderUrl", "folder"),
    ensureSubdoc(
      accountHandle,
      repo,
      "moduleSettingsUrl",
      "patchwork:module-settings"
    ),
    ensureSubdoc(accountHandle, repo, "contactUrl", "contact"),
  ]);
}
