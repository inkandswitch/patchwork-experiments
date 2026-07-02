import type { DocHandle, Repo } from "@automerge/automerge-repo";
import {
  createDocOfDatatype2,
  getRegistry,
  type DatatypeDescription,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";
import type { ThreepaneConfigDoc, TinyPatchworkConfigDoc, ToolRef } from "./types";

type SubdocField = "rootFolderUrl" | "moduleSettingsUrl" | "contactUrl";

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
 * Default context tools for an account that has never configured any (no
 * `contextToolIds` migrated from elsewhere, and no existing threepane config
 * doc). Mirrors threepane's `AccountDatatype.init` default, including the
 * upstream-stale `context-view` id, for parity: `useSlotTools` resolves it to
 * its raw id with no matching registry entry, so it simply renders nothing.
 */
const DEFAULT_CONTEXT_TOOL_IDS = [
  "comments-view",
  "history-view",
  "context-view",
];

/**
 * Ensure the shared frame-layout config doc (`tools["threepane"]`) exists and
 * has `tray`/`contextbar` lanes, migrating legacy `contextToolIds` into the
 * latter exactly like threepane's own `ensureThreepaneConfig` — so an account
 * switching between the tiling and threepane frames sees the same context
 * tools and system tray either way, and (shared) frame-configurator edits
 * apply regardless of which frame is active.
 *
 * Uses the `threepane:config` datatype directly (not `loadDatatypeWhenReady`,
 * which would wait forever) so that when threepane isn't installed we simply
 * skip — the tray/context bar just stay empty. Idempotent and
 * concurrency-safe.
 */
async function ensureThreepaneConfig(
  accountHandle: DocHandle<TinyPatchworkConfigDoc>,
  repo: Repo,
) {
  const existing = accountHandle.doc()?.tools?.["threepane"];
  if (existing) {
    // Backfill lanes added by later builds of this config doc.
    const configHandle = await repo.find<ThreepaneConfigDoc>(existing);
    configHandle.change((doc) => {
      if (!doc.tray) doc.tray = { tools: [] };
      if (!doc.contextbar) doc.contextbar = { tabs: [] };
    });
    return;
  }
  const registry = getRegistry<DatatypeDescription>("patchwork:datatype");
  const datatype = await registry.load("threepane:config");
  if (!datatype) return; // threepane not installed → no tray/context config
  if (accountHandle.doc()?.tools?.["threepane"]) return; // raced with another tab

  const account = accountHandle.doc();
  const accountDocUrl = accountHandle.url;
  const contextTabs: ToolRef[] = (
    account?.contextToolIds ?? DEFAULT_CONTEXT_TOOL_IDS
  ).map((id) => [id, accountDocUrl]);

  const configHandle = await createDocOfDatatype2<ThreepaneConfigDoc>(
    datatype,
    repo,
  );
  configHandle.change((doc) => {
    if (!doc.contextbar) doc.contextbar = { tabs: [] };
    doc.contextbar.tabs = contextTabs;
  });

  accountHandle.change((doc) => {
    if (!doc.tools) doc.tools = {};
    if (!doc.tools["threepane"]) doc.tools["threepane"] = configHandle.url;
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
  await Promise.all([
    ensureSubdoc(accountHandle, repo, "rootFolderUrl", "folder"),
    ensureSubdoc(
      accountHandle,
      repo,
      "moduleSettingsUrl",
      "patchwork:module-settings",
    ),
    ensureContact(accountHandle, repo),
    ensureThreepaneConfig(accountHandle, repo),
  ]);
}
