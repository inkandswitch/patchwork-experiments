import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import {
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
} from "@inkandswitch/patchwork-plugins";
import type { ChatDoc, ChatMessage } from "../chat/types";
import type {
  LLMMessage,
  LLMProviderDescription,
  LLMProviderImplementation,
  LoadedLLMProvider,
} from "../llm-providers/types";
import { parseBlocks } from "./parser";
import { getSystemPrompts } from "./prompts/index";

// Agent document schema
export type AgentDoc = {
  contactUrl: AutomergeUrl;
  modelId: string;
  chatDocUrl?: AutomergeUrl;
  contextFolderUrl: AutomergeUrl;
};

// Main step function
export async function step(
  agentDocUrl: AutomergeUrl,
  repo: Repo
): Promise<void> {
  const agentDocHandle = await repo.find<AgentDoc>(agentDocUrl);
  const { modelId, chatDocUrl, contactUrl } = agentDocHandle.doc();

  if (!chatDocUrl) {
    return;
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
  const systemPromptMessages: LLMMessage[] = (
    await getSystemPrompts(agentDocHandle, repo)
  ).map((prompt) => ({
    role: "system",
    content: prompt,
  }));

  let currentBotMessageId: string | null = null;

  const responseStream = llmProvider.chatCompletionStream(
    [...systemPromptMessages, ...historyMessages],
    {
      model: modelId,
    }
  );

  for await (const event of parseBlocks(responseStream)) {
    switch (event.type) {
      case "create": {
        const id = crypto.randomUUID();
        chatDocHandle.change((doc) => {
          doc.messages.push({
            id,
            author: contactUrl,
            timestamp: Date.now(),
            content: event.block,
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
            message.content = event.block;
          }
        });
      }
    }

    // try to execute action
    const currentBotMessage = chatDoc.messages.find(
      (m) => m.id === currentBotMessageId
    );
    if (
      !currentBotMessage ||
      !(currentBotMessage.content.type === "action") ||
      !currentBotMessage.content.action
    ) {
      continue;
    }

    const { id, target, args } = currentBotMessage.content.action;

    let result: { type: "success" | "error"; value: string };
    try {
      result = {
        type: "success",
        value: JSON.stringify(
          await executeAction(target, id, JSON.parse(args), repo),
          null,
          2
        ),
      };
    } catch (error) {
      result = {
        type: "error",
        value: (error as Error).toString(),
      };
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
  }
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
