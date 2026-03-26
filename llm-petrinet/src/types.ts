import type { NetState } from './lib';

export type LLMPetriNetDoc = {
  '@patchwork': { type: 'llm-petrinet' };
  tokens: NetState;
  systemPrompts?: {
    optimizer?: string;
    evaluator?: string;
  };
  systemPromptUrls?: {
    optimizer?: string;
    evaluator?: string;
  };
};
