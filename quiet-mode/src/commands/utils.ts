import { onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import {
  type DatatypeDescription,
  type Plugin,
  createDocOfDatatype2,
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
} from "@inkandswitch/patchwork-plugins";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";
import type { AutomergeRepoKeyhive } from "@automerge/automerge-repo-keyhive";

export function getCurrentDocHandle(): DocHandle<any> | undefined {
  return (window as any).currentDocHandle;
}

export function dispatchOpenEvent(detail: OpenDocumentEventDetail) {
  const target = document.querySelector("patchwork-view") ?? document.body;
  target.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail,
      bubbles: true,
      composed: true,
    })
  );
}

export async function createNewDoc(
  repo: Repo,
  datatype: Plugin<DatatypeDescription>,
  hive?: AutomergeRepoKeyhive
) {
  if (isLoadablePlugin(datatype)) {
    const registry = getRegistry("patchwork:datatype");
    await registry.load(datatype.id);
  }
  if (!isLoadedPlugin(datatype)) {
    throw new Error("plugin not loaded after loading");
  }

  const docHandle = await createDocOfDatatype2(datatype, repo);
  if (hive) {
    await hive.addSyncServerPullToDoc(docHandle.url);
  }
  const doc = docHandle.doc();
  const name = datatype.module.getTitle(doc);

  return {
    name,
    type: datatype.id,
    url: docHandle.url,
  };
}

export function filterMatches(title: string, query: string): boolean {
  const lower = title?.toLowerCase();
  return (
    !!lower &&
    query
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => lower.includes(term))
  );
}

export function useFilteredDatatypes(
  filter: (item: DatatypeDescription) => boolean
): Plugin<DatatypeDescription>[] {
  const datatypeRegistry =
    getRegistry<DatatypeDescription>("patchwork:datatype");
  const [plugins, setPlugins] = createStore(datatypeRegistry.filter(filter));
  const dispose = datatypeRegistry.on("changed", () =>
    setPlugins(reconcile(datatypeRegistry.filter(filter)))
  );
  onCleanup(dispose);
  return plugins;
}

export function makeListKeyHandler(
  getCount: () => number,
  getHighlight: () => number,
  setHighlight: (fn: (i: number) => number) => void,
  onSelect: () => void
) {
  return (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, getCount() - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSelect();
    }
  };
}
