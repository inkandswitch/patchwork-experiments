import * as Automerge from "@automerge/automerge";
import { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type {
  LLMMessage,
  LLMProviderDescription,
  LoadedLLMProvider,
  LLMProviderImplementation,
} from "../llm-providers/types";
import type { ChatDoc, ChatMessage } from "../chat/types";
import {
  getRegistry,
  isLoadablePlugin,
  isLoadedPlugin,
} from "@inkandswitch/patchwork-plugins";
import { last } from "./utils";

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

  chatDocHandle.change((doc) => {
    doc.messages.push({
      id: `msg-${Date.now()}-${Math.random()}`,
      author: contactUrl,
      content: {
        type: "text",
        text: "",
      },
      timestamp: Date.now(),
    });
  });

  const currentBotMessage = last(chatDocHandle.doc().messages)!;

  for await (const chunk of llmProvider.chatCompletionStream(llmMessages, {
    model: modelId,
  })) {
    chatDocHandle.change((doc) => {
      for (let i = 0; i < doc.messages.length; i++) {
        const message = doc.messages[i];
        if (
          message.id === currentBotMessage.id &&
          message.content.type === "text"
        ) {
          Automerge.splice(
            doc,
            ["messages", i, "content", "text"],
            message.content.text.length,
            0,
            chunk
          );
          break;
        }
      }
    });
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
