import {
  createDocOfDatatype2,
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
  LoadedPlugin,
  DatatypeDescription,
} from "@inkandswitch/patchwork-plugins";
import { Repo } from "@automerge/automerge-repo";

// these functions should exist in patchwork

export const createDocOfDatatype = async <T = unknown>(
  datatypeId: string,
  repo: Repo
) => {
  const datatype = (await getRegistry("patchwork:datatype").load(
    datatypeId
  )) as LoadedPlugin<DatatypeDescription, any>;

  if (!datatype) {
    throw new Error(`Datatype "${datatypeId}" not found`);
  }

  if (isLoadablePlugin(datatype)) {
    const registry = getRegistry("patchwork:datatype");
    await registry.load(datatype.id);
  }
  if (!isLoadedPlugin(datatype)) {
    throw new Error("plugin not loaded after loading");
  }
  const docHandle = await createDocOfDatatype2<T>(datatype, repo);
  return docHandle;
};
