import { type AutomergeUrl, isValidAutomergeUrl, parseAutomergeUrl, type Repo } from "@automerge/automerge-repo";
import { importModuleFromFolderDocUrl } from "@inkandswitch/patchwork-filesystem";
import { type DatatypeDescription, getRegistry, type LoadedDatatype, type LoadedTool, getSupportedToolsForType as pluginGetSupportedToolsForType } from "@inkandswitch/patchwork-plugins";

// Local storage for tools and datatypes loaded from modules
const localTools = new Map<string, LoadedTool>();
const localDatatypes = new Map<string, LoadedDatatype>();

/**
 * Load tools and datatypes from a module at the given automerge URL.
 * Sets up a watcher so that if the module document changes, plugins are reloaded.
 */
export async function loadPluginsFromModule(automergeUrl: AutomergeUrl, repo: Repo) {
  const mod = await importModuleSafe(automergeUrl);
  if (!mod) return;

  await loadAndStorePlugins(mod);

  const { documentId } = parseAutomergeUrl(automergeUrl);

  repo.find(documentId).then((handle) => {
    let previousSyncAtTime = (handle.doc() as any)?.lastSyncAt || 0;
    handle.on("change", async () => {
      const lastSyncAt = (handle.doc() as any)?.lastSyncAt || 0;
      if (lastSyncAt <= previousSyncAtTime) return;
      previousSyncAtTime = lastSyncAt;

      const versionedImport = handle.view(handle.heads()).url;
      console.log(`Module changed: ${automergeUrl}, reloading at ${versionedImport}`);

      const updatedMod = await importModuleSafe(versionedImport);
      if (updatedMod) await loadAndStorePlugins(updatedMod);
    });
  });
}

/**
 * Get all loaded tools that support the given datatype.
 * Combines results from locally loaded modules and the patchwork-plugins registry.
 * Local tools override registry tools with the same id.
 */
export function getSupportedToolsForType(type: string): LoadedTool[] {
  // Get tools from the patchwork-plugins registry
  const registryTools = pluginGetSupportedToolsForType(type);

  // Get matching local tools
  const matchingLocalTools = Array.from(localTools.values()).filter((tool) => tool.supportedDatatypes === "*" || tool.supportedDatatypes?.includes(type) || tool.supportedDatatypes?.includes("*"));

  // Combine, with local tools overriding registry tools by id
  const toolMap = new Map<string, LoadedTool>();
  for (const tool of registryTools) {
    toolMap.set(tool.id, tool);
  }
  for (const tool of matchingLocalTools) {
    toolMap.set(tool.id, tool);
  }

  return Array.from(toolMap.values());
}

/**
 * Get a datatype by its id.
 * First checks locally loaded modules, then falls back to the patchwork-plugins registry.
 */
export function getDatatypeById(datatype: string): LoadedDatatype | undefined {
  // First check local datatypes
  const local = localDatatypes.get(datatype);
  if (local) return local;

  // Fall back to patchwork-plugins registry
  const plugin = getRegistry<DatatypeDescription>("patchwork:datatype").get(datatype);
  if (plugin && "module" in plugin) return plugin as LoadedDatatype;
  return undefined;
}

// --- Helper functions ---

/**
 * Safely import a module from an automerge URL or a regular import path.
 */
async function importModuleSafe(importName: string): Promise<any | null> {
  try {
    const valid = isValidAutomergeUrl(importName);
    return valid ? importModuleFromFolderDocUrl(importName) : import(/* @vite-ignore */ importName);
  } catch (error) {
    console.error(`Failed to import ${importName}`, error);
    return null;
  }
}

/**
 * Extract tools and datatypes from a loaded module and store them locally.
 * Modules are expected to export a `plugins` array of loadable plugin descriptions.
 */
async function loadAndStorePlugins(mod: any) {
  const plugins = mod?.plugins;
  if (!Array.isArray(plugins)) return;

  for (const plugin of plugins) {
    if (!plugin.type || !plugin.id) continue;

    try {
      const implementation = typeof plugin.load === "function" ? await plugin.load() : plugin.module;
      if (!implementation) continue;

      const { load: _load, ...description } = plugin;
      const loaded = { ...description, module: implementation };

      if (plugin.type === "patchwork:tool") {
        localTools.set(plugin.id, loaded as LoadedTool);
      } else if (plugin.type === "patchwork:datatype") {
        localDatatypes.set(plugin.id, loaded as LoadedDatatype);
      }
    } catch (error) {
      console.error(`Failed to load plugin ${plugin.id}:`, error);
    }
  }
}
