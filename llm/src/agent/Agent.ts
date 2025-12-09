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

console.log("new agent!!!");

// Agent document schema
export type AgentDoc = {
  contactUrl: AutomergeUrl;
  modelId: string;
  chatDocUrl?: AutomergeUrl;
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

  // Build message history from our message types
  const llmMessages: LLMMessage[] = [
    ...buildLLMHistory(chatDoc.messages, contactUrl),
  ];

  let currentBotMessageId: string | null = null;

  const responseStream = llmProvider.chatCompletionStream(llmMessages, {
    model: modelId,
  });

  for await (const event of parseBlocks(responseStream)) {
    console.log("event", event);
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
  }
}

function buildLLMHistory(
  messages: ChatMessage[],
  agentContactUrl: AutomergeUrl
): LLMMessage[] {
  return messages.map((message) => {
    if (message.content.type === "text") {
      if (message.author === agentContactUrl) {
        return { role: "assistant", content: message.content.text };
      } else {
        return { role: "user", content: message.content.text };
      }
    }

    throw new Error("not implemented");
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
