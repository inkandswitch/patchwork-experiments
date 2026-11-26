export type EditableChatDoc = {
  '@patchwork': { type: 'editable-llm-chat' };
  config: {
    apiUrl: string;
    model: string;
  };
  messages: EditableChatMessage[];
};

export type EditableChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
