import type { DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createDocOfDatatype2,
  getRegistry,
  type DatatypeDescription,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";
import type { TinyPatchworkConfigDoc } from "./types";

type SubdocField =
  | "rootFolderUrl"
  | "moduleSettingsUrl"
  | "contactUrl"
  | "tilingLayoutUrl";

/**
 * Wait for a datatype to be loadable, returning the loaded datatype. Subdoc
 * datatypes (folder, module-settings) can live in separately-loaded bundles,
 * so we tolerate late registration.
 */
async function loadDatatypeWhenReady<D>(
  id: string,
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
  accountHandle: DocHandle<TinyPatchworkConfigDoc>,
  repo: Repo,
  field: SubdocField,
  datatypeId: string,
) {
  if (accountHandle.doc()?.[field]) return;
  const datatype = await loadDatatypeWhenReady<S>(datatypeId);
  if (!datatype) {
    console.warn(
      `tiling-frame: datatype "${datatypeId}" never registered; skipping ${field}`,
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
 * Ensure the account has a `contactUrl`. Tools that attribute authorship
 * (comments, drawing, chat, …) read `window.accountDocHandle.doc().contactUrl`,
 * so a missing contact silently breaks them. We create an anonymous contact
 * *directly* rather than via the datatype registry: the `contact` bundle may
 * not be loaded, and `loadDatatypeWhenReady` would otherwise wait forever for a
 * registration event that never arrives. A real identity set by the host always
 * wins (the field is only written when empty).
 */
async function ensureContact(
  accountHandle: DocHandle<TinyPatchworkConfigDoc>,
  repo: Repo,
) {
  if (accountHandle.doc()?.contactUrl) return;
  const contact = repo.create<{
    "@patchwork": { type: string };
    type: string;
  }>();
  contact.change((doc) => {
    doc["@patchwork"] = { type: "contact" };
    doc.type = "anonymous";
  });
  accountHandle.change((doc) => {
    if (!doc.contactUrl) doc.contactUrl = contact.url;
  });
}

/**
 * Default context tools, mirroring patchwork-base's `AccountDatatype.init`. We
 * seed the same list (including the upstream-stale `context-view`) for parity;
 * `useContextTools` skips any id that doesn't resolve to a loaded tool. A list
 * the host already configured always wins (only written when absent).
 */
const DEFAULT_CONTEXT_TOOL_IDS = [
  "comments-view",
  "history-view",
  "context-view",
];

function ensureContextToolIds(
  accountHandle: DocHandle<TinyPatchworkConfigDoc>,
) {
  if (accountHandle.doc()?.contextToolIds) return;
  accountHandle.change((doc) => {
    if (!doc.contextToolIds) doc.contextToolIds = [...DEFAULT_CONTEXT_TOOL_IDS];
  });
}

/**
 * Lazily populate the subdoc URLs the tiling frame depends on. Idempotent:
 * fields already set (including those set concurrently by another tab) win.
 */
export async function ensureAccountSubdocs(
  accountHandle: DocHandle<TinyPatchworkConfigDoc>,
  repo: Repo,
) {
  ensureContextToolIds(accountHandle);
  await Promise.all([
    ensureSubdoc(accountHandle, repo, "rootFolderUrl", "folder"),
    ensureSubdoc(
      accountHandle,
      repo,
      "moduleSettingsUrl",
      "patchwork:module-settings",
    ),
    ensureContact(accountHandle, repo),
    ensureSubdoc(
      accountHandle,
      repo,
      "tilingLayoutUrl",
      "patchwork-frame-tiling:layout",
    ),
  ]);
}
