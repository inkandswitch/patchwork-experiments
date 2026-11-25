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
  /** A reply's: the run that made this message and writes into it (generate-task.js). */
  run?: string;
  /** A reply's: how the run named by `run` ended it. */
  ended?: 'finished' | 'stopped' | 'failed';
  /** A failed reply's: what went wrong, the provider's words when it said any. */
  error?: string;
};
