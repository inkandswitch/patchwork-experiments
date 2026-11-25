export type EditableChatDoc = {
  '@patchwork': { type: 'editable-llm-chat' };
  config: {
    apiUrl: string;
    model: string;
    /** Machine labels a reply needs (a model only one machine has); none, any machine or this page may write it. */
    needs?: string[];
  };
  messages: EditableChatMessage[];
};

export type EditableChatMessage = {
  /** Made when the message is pushed; what everything addresses it by. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** A reply's: the run writing it, or that last wrote it (generate-task.js). */
  run?: string;
  /** A reply's: how its writing ended. */
  ended?: 'finished' | 'stopped' | 'failed';
  /** A failed reply's: what the provider said. */
  error?: string;
};
