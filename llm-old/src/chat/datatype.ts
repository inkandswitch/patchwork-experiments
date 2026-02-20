import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import {
  DatatypeImplementation,
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
} from "@inkandswitch/patchwork-plugins";
import { AgentDoc } from "../agent/agent";
import { ContactDoc } from "../type";
import { ChatDoc } from "./types";
import type { LLMContextDescription, LoadedLLMContext } from "../llm-context";

export const ChatDataType: DatatypeImplementation<ChatDoc> = {
  init: (doc: ChatDoc, repo: Repo) => {
    const contactDocHandle = repo.create<ContactDoc>({
      type: "registered",
      name: "Agent",
    });

    const contextFolderHandle = repo.create<FolderDoc>({
      title: "Context Folder",
      docs: [],
    });

    const agentDocHandle = repo.create<AgentDoc>({
      contactUrl: contactDocHandle.url,
      modelId: "anthropic/claude-sonnet-4",
      contextFolderUrl: contextFolderHandle.url,
    });

    doc.title = "Chat";
    doc.messages = [];
    doc.agentDocUrl = agentDocHandle.url;

    const agentDocUrl = agentDocHandle.url;

    initContextPlugins(agentDocUrl, repo).catch((err) => {
      console.error("Error initializing context plugins:", err);
    });
  },
  getTitle(doc) {
    return doc.title;
  },

  setTitle(doc: ChatDoc, title: string) {
    doc.title = title;
  },
};

/**
 * Initialize all context plugins that have an init function.
 */
async function initContextPlugins(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<void> {
  const registry = getRegistry<LLMContextDescription>("patchwork:llm-context");
  const allContextPlugins = registry.all();

  for (const plugin of allContextPlugins) {
    try {
      let loadedPlugin: LoadedLLMContext;
      if (isLoadablePlugin(plugin)) {
        const loaded = await registry.load(plugin.id);
        if (!loaded || !isLoadedPlugin(loaded)) {
          console.error(`Failed to load context plugin: ${plugin.id}`);
          continue;
        }
        loadedPlugin = loaded as LoadedLLMContext;
      } else if (isLoadedPlugin(plugin)) {
        loadedPlugin = plugin as LoadedLLMContext;
      } else {
        continue;
      }

      // Call init if the plugin has one
      if (loadedPlugin.module.init) {
        await loadedPlugin.module.init(agentDocUrl, repo);
        console.log(`Initialized context plugin: ${plugin.id}`);
      }
    } catch (err) {
      console.error(`Error initializing context plugin ${plugin.id}:`, err);
    }
  }
}
