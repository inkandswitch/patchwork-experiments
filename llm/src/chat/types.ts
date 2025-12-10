import { AutomergeUrl } from "@automerge/automerge-repo";

export type TextBlock = {
  type: "text";
  text: string;
};

export type ThinkingBlock = {
  type: "thinking";
  description: string;
  text: string;
};

export type ActionBlock = {
  type: "action";
  description: string;
  action?: {
    id: string;
    target: AutomergeUrl;
    args: string;
    result?: {
      type: "success" | "error";
      value: unknown;
    };
  };
};

export type ContentBlock = TextBlock | ActionBlock | ThinkingBlock;

export type ChatMessage = {
  id: string;
  author: AutomergeUrl;
  timestamp: number;
  content: ContentBlock;
};

export type ChatDoc = {
  title: string;
  messages: ChatMessage[];
  agentDocUrl: AutomergeUrl;
};
