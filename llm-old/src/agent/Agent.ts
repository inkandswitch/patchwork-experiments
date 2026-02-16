import {
  AutomergeUrl,
  DocHandle,
  parseAutomergeUrl,
  Repo,
  stringifyAutomergeUrl,
} from "@automerge/automerge-repo";
import {
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
} from "@inkandswitch/patchwork-plugins";
import {
  DocLink,
  FolderDoc,
  HasPatchworkMetadata,
} from "@inkandswitch/patchwork-filesystem";
import type { ChatDoc, ChatMessage } from "../chat/types";
import type {
  LLMMessage,
  LLMProviderDescription,
  LLMProviderImplementation,
  LoadedLLMProvider,
} from "../llm-providers/types";
import type { LLMContextDescription, LoadedLLMContext } from "../llm-context";
import { parseBlocks } from "./parser";
import { getFolderDocLinks, getChangedDocLinks } from "./folder-utils";
import { createDocOfDatatype } from "../lib";

// Agent document schema
export type AgentDoc = {
  contactUrl: AutomergeUrl;
  modelId: string;
  chatDocUrl?: AutomergeUrl;
  contextFolderUrl: AutomergeUrl;
  previousDocLinks?: DocLink[];
};

/**
 * Main step function - runs one iteration of the agent loop.
 *
 * @param agentDocUrl - The URL of the agent document
 * @param repo - The Automerge repo
 * @param rerunReason - Optional reason for why the agent is being re-run.
 *   This is needed because if a context provider determines we're not done
 *   (e.g., open todos remain), simply re-running with the same messages would
 *   cause the LLM to produce the same response. By injecting this reason as a
 *   fake user message, we give the LLM new input that guides it toward what
 *   it should be doing next.
 */
export async function step(
  agentDocUrl: AutomergeUrl,
  repo: Repo,
  rerunReason?: string
): Promise<void> {
  console.log("step agent");

  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const agentDoc = agentDocHandle.doc();
  const { modelId, chatDocUrl, contactUrl, contextFolderUrl } = agentDoc;

  if (!chatDocUrl) {
    return;
  }

  // Initialize previousDocLinks if not set
  if (!agentDoc.previousDocLinks) {
    const initialDocLinks = await getFolderDocLinks(contextFolderUrl, repo);
    agentDocHandle.change((doc) => {
      doc.previousDocLinks = initialDocLinks;
    });
  }

  // Load chat document
  const chatDocHandle = await repo.find<ChatDoc>(chatDocUrl);
  const chatDoc = chatDocHandle.doc();

  // Load LLM provider
  const llmProvider = await loadLLMProvider(modelId);
  if (!llmProvider) {
    console.error("Failed to load LLM provider");
    return;
  }

  const historyMessages = buildLLMHistory(chatDoc.messages, contactUrl);

  // If there's a rerun reason, append it as a fake user message
  if (rerunReason) {
    historyMessages.push({ role: "user", content: rerunReason });
  }

  const promptParts = await buildSystemPromptParts(agentDocUrl, repo);
  const systemPrompt = promptParts.map((part) => part.content).join("\n\n");
  const systemPromptMessages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  let currentBotMessageId: string | null = null;
  let hasActionWithReturnValue = false;
  let hasActionError = false;

  const responseStream = llmProvider.chatCompletionStream(
    [...systemPromptMessages, ...historyMessages],
    {
      model: modelId,
    }
  );

  for await (const event of parseBlocks(responseStream)) {
    // Add default description if missing for action/thinking blocks
    const block = event.block;
    if (block.type === "action" && !block.description) {
      block.description = "do some action";
    } else if (block.type === "thinking" && !block.description) {
      block.description = "thinking";
    }

    switch (event.type) {
      case "create": {
        const id = crypto.randomUUID();
        chatDocHandle.change((doc) => {
          doc.messages.push({
            id,
            ...(contactUrl && { author: contactUrl }),
            timestamp: Date.now(),
            content: block,
          });
        });
        currentBotMessageId = id;
        break;
      }

      case "update": {
        chatDocHandle.change((doc) => {
          const message = doc.messages.find(
            (m) => m.id === currentBotMessageId
          );
          if (message) {
            // todo: do incremental update
            message.content = block;
          }
        });
      }
    }

    // try to execute action
    const currentBotMessage = chatDocHandle
      .doc()
      .messages.find((m) => m.id === currentBotMessageId);
    if (
      !currentBotMessage ||
      !(currentBotMessage.content.type === "action") ||
      !currentBotMessage.content.action
    ) {
      continue;
    }

    const { id, target, args } = currentBotMessage.content.action;

    let result: { type: "success" | "error"; value: unknown };
    try {
      const returnValue = await executeAction(target, id, args, repo);
      result = {
        type: "success",
        value: returnValue ?? null,
      };
      // Track if this action returned a meaningful value (not null/undefined)
      if (returnValue !== undefined && returnValue !== null) {
        hasActionWithReturnValue = true;
      }
    } catch (error) {
      result = {
        type: "error",
        value: (error as Error).toString(),
      };
      hasActionError = true;
    }

    chatDocHandle.change((doc) => {
      const message = doc.messages.find((m) => m.id === currentBotMessageId);
      if (
        !message ||
        message.content.type !== "action" ||
        !message.content.action
      ) {
        return;
      }
      message.content.action.result = result;
    });

    // If action failed, ignore remaining tokens and rerun step immediately
    if (hasActionError) {
      break;
    }
  }

  // If an action failed, rerun step so the LLM can see the error and retry
  if (hasActionError) {
    await step(agentDocUrl, repo);
    return;
  }

  // If an action returned a value, run the step again so the LLM can see the result
  if (hasActionWithReturnValue) {
    await step(agentDocUrl, repo);
    return;
  }

  // Check if any LLM context plugin is not done (e.g., pending actions to execute)
  const nextRerunReason = await getRerunReasonFromContexts(agentDocUrl, repo);
  if (nextRerunReason) {
    await step(agentDocUrl, repo);
    return;
  }

  // We're truly done - compute changed docLinks and create a snapshot folder
  await createChangedDocsMessage(agentDocHandle, repo);
}

/**
 * Creates a snapshot folder containing documents that have changed since the last step.
 * Adds an embed message to the chat with the snapshot folder.
 */
async function createChangedDocsMessage(
  agentDocHandle: DocHandle<AgentDoc>,
  repo: Repo
): Promise<void> {
  const agentDoc = agentDocHandle.doc();
  const { contextFolderUrl, previousDocLinks, chatDocUrl, contactUrl } =
    agentDoc;

  // Get current state of all docs
  const currentDocLinks = await getFolderDocLinks(contextFolderUrl, repo);

  // Find what has changed
  const changedDocLinks = getChangedDocLinks(
    previousDocLinks || [],
    currentDocLinks
  );

  // touch all folders so packages update
  for (const docLink of currentDocLinks) {
    if (docLink.type !== "folder") {
      continue;
    }

    const docUrlWithoutHeads = getDocUrlWithoutHeads(docLink.url);
    const docHandle = await repo.find<HasPatchworkMetadata>(docUrlWithoutHeads);
    docHandle.change((doc) => {
      (doc as any).lastSyncAt = Date.now();
    });
  }

  // Always update previousDocLinks to current state for next comparison
  agentDocHandle.change((doc) => {
    doc.previousDocLinks = currentDocLinks;
  });

  // Do nothing if no files have changed
  if (changedDocLinks.length === 0) {
    return;
  }

  console.log(`${changedDocLinks.length} documents changed, creating snapshot`);

  // Create a new folder for the changed docs
  const snapshotFolderHandle = await createDocOfDatatype<FolderDoc>(
    "folder",
    repo
  );

  // Set up the folder with changed docLinks
  snapshotFolderHandle.change((doc) => {
    doc.title = `Changes ${new Date().toISOString()}`;
    doc.docs = changedDocLinks;
  });

  console.log("Created snapshot folder:", snapshotFolderHandle.url);

  // Add embed message to chat
  if (chatDocUrl) {
    const chatDocHandle = await repo.find<ChatDoc>(chatDocUrl);
    chatDocHandle.change((doc) => {
      doc.messages.push({
        id: `msg-${Date.now()}-${Math.random()}`,
        ...(contactUrl && { author: contactUrl }),
        timestamp: Date.now(),
        content: {
          type: "embed",
          documentUrl: snapshotFolderHandle.url,
          toolId: "folder-viewer",
        },
      });
    });
  }
}

function getDocUrlWithoutHeads(docUrl: AutomergeUrl): AutomergeUrl {
  const { documentId } = parseAutomergeUrl(docUrl);
  return stringifyAutomergeUrl({ documentId });
}

export type PromptPart = {
  pluginId: string;
  pluginName: string;
  content: string;
};

export async function buildSystemPromptParts(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<PromptPart[]> {
  const registry = getRegistry<LLMContextDescription>("patchwork:llm-context");
  const allContextPlugins = registry.all();

  const promptParts: PromptPart[] = [];

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

      const content = await loadedPlugin.module.prompt(agentDocUrl, repo);
      if (content) {
        promptParts.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          content,
        });
      }
    } catch (err) {
      console.error(`Error loading context plugin ${plugin.id}:`, err);
    }
  }

  return promptParts;
}

async function getRerunReasonFromContexts(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<string | null> {
  const registry = getRegistry<LLMContextDescription>("patchwork:llm-context");
  const allContextPlugins = registry.all();

  for (const plugin of allContextPlugins) {
    try {
      let loadedPlugin: LoadedLLMContext;
      if (isLoadablePlugin(plugin)) {
        const loaded = await registry.load(plugin.id);
        if (!loaded || !isLoadedPlugin(loaded)) {
          continue;
        }
        loadedPlugin = loaded as LoadedLLMContext;
      } else if (isLoadedPlugin(plugin)) {
        loadedPlugin = plugin as LoadedLLMContext;
      } else {
        continue;
      }

      // If the plugin has a getRerunReason function, check it
      if (loadedPlugin.module.getRerunReason) {
        const reason = await loadedPlugin.module.getRerunReason(
          agentDocUrl,
          repo
        );
        if (reason) {
          console.log(
            `Context plugin ${plugin.id} wants to continue: ${reason}`
          );
          return reason;
        }
      }
    } catch (err) {
      console.error(
        `Error checking getRerunReason for plugin ${plugin.id}:`,
        err
      );
    }
  }

  return null;
}

function buildLLMHistory(
  messages: ChatMessage[],
  agentContactUrl: AutomergeUrl
): LLMMessage[] {
  return messages.map((message) => {
    const isAssistant = message.author === agentContactUrl;
    const role = isAssistant ? "assistant" : "user";

    switch (message.content.type) {
      case "text": {
        return { role, content: message.content.text };
      }

      case "thinking": {
        const thinking = message.content;
        return {
          role: "assistant" as const,
          content: `<thinking description="${thinking.description}">\n${thinking.text}\n</thinking>`,
        };
      }

      case "action": {
        const action = message.content;
        let content = `<action description="${action.description}">`;

        if (action.action) {
          // Include the action call parameters (excluding result)
          const actionCall = {
            id: action.action.id,
            target: action.action.target,
            args: action.action.args,
          };
          content += `\n${JSON.stringify(actionCall, null, 2)}\n`;
        }

        content += `</action>`;

        // Append the result as feedback if present
        if (action.action?.result) {
          const result = action.action.result;
          content += `\n\n[Action ${result.type}]: ${result.value}`;
        }

        return {
          role: "assistant" as const,
          content,
        };
      }

      case "embed": {
        const embed = message.content;
        return {
          role,
          content: `[Embedded document: ${embed.documentUrl}]`,
        };
      }
    }
  });
}

async function loadLLMProvider(
  modelId: string
): Promise<LLMProviderImplementation | null> {
  try {
    const registry = getRegistry<LLMProviderDescription>(
      "patchwork:llm-provider"
    );
    const allProviders = registry.all();

    for (const provider of allProviders) {
      if (!provider.supportedModels.includes(modelId)) {
        continue;
      }

      try {
        if (await provider.available()) {
          let loadedProvider: LoadedLLMProvider;
          if (isLoadablePlugin(provider)) {
            const loaded = await registry.load(provider.id);
            if (!loaded || !isLoadedPlugin(loaded)) {
              console.error(`Failed to load provider: ${provider.id}`);
              continue;
            }
            loadedProvider = loaded as LoadedLLMProvider;
          } else if (isLoadedPlugin(provider)) {
            loadedProvider = provider as LoadedLLMProvider;
          } else {
            continue;
          }

          return loadedProvider.module;
        }
      } catch (err) {
        console.error("Error loading provider:", err);
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error("Error loading LLM provider:", error);
    return null;
  }
}

async function executeAction(
  target: AutomergeUrl,
  actionId: string,
  args: unknown,
  repo: Repo
): Promise<unknown> {
  const registry = getRegistry("patchwork:action");
  const actionPlugin = await registry.load(actionId);

  if (!actionPlugin) {
    throw new Error(`Action plugin not found: ${actionId}`);
  }

  const targetDocHandle = await repo.find(target);
  const targetDoc = targetDocHandle.doc();

  if (actionPlugin.module.argsSchema) {
    // Validate args with schema
    const schema = actionPlugin.module.argsSchema(targetDoc);
    const validatedArgs = schema.parse(args || {});
    return await actionPlugin.module.default(
      targetDocHandle,
      repo,
      validatedArgs
    );
  } else {
    return await actionPlugin.module.default(targetDocHandle, repo);
  }
}
