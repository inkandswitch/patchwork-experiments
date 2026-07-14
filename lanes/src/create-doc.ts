import type { Repo } from "@automerge/automerge-repo";
import {
  createDocOfDatatype2,
  getRegistry,
  type LoadedDatatype,
} from "@inkandswitch/patchwork-plugins";

export async function createDocOfType<D>(
  datatypeId: string,
  repo: Repo,
  change?: (doc: D) => void,
) {
  const registry = getRegistry("patchwork:datatype");
  const datatype = (await registry.load(datatypeId)) as
    | LoadedDatatype<D>
    | undefined;
  if (!datatype) {
    throw new Error(`Datatype "${datatypeId}" not found`);
  }
  return createDocOfDatatype2(datatype, repo, change);
}
