import type { LLMProviderPlugin } from "./types";

export * from "./types";

export const openRouterProvider: LLMProviderPlugin = {
  type: "patchwork:llm-provider",
  id: "openrouter",
  name: "OpenRouter",
  supportedModels: [
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4-turbo",
    "openai/gpt-4o",
    "google/gemini-pro-1.5",
    "meta-llama/llama-3.1-405b-instruct",
  ],
  async available() {
    const envKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    const localKey = localStorage.getItem("openrouter-api-key");
    return !!(envKey || localKey);
  },
  async load() {
    return {
      async chatCompletion(messages, options) {
        const apiKey =
          import.meta.env.VITE_OPENROUTER_API_KEY ||
          localStorage.getItem("openrouter-api-key");
        if (!apiKey) throw new Error("No OpenRouter API key found");

        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": window.location.origin,
              "X-Title": "Patchwork",
            },
            body: JSON.stringify({
              messages,
              model: options?.model || "anthropic/claude-sonnet-4",
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`OpenRouter API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
      },
      async *chatCompletionStream(messages, options) {
        const apiKey =
          import.meta.env.VITE_OPENROUTER_API_KEY ||
          localStorage.getItem("openrouter-api-key");
        if (!apiKey) throw new Error("No OpenRouter API key found");

        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": window.location.origin,
              "X-Title": "Patchwork",
            },
            body: JSON.stringify({
              messages,
              model: options?.model || "anthropic/claude-sonnet-4",
              stream: true,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`OpenRouter API error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                yield delta;
              }
            } catch (e) {
              console.error("Error parsing SSE:", e);
            }
          }
        }
      },
    };
  },
};
