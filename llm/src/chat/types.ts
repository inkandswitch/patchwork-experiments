import { AutomergeUrl } from "@automerge/automerge-repo";

type TextBlock = {
  type: "text";
  content: string;
};

type ThinkingBlock = {
  type: "thinking";
  description: string;
  content: string;
};

type ActionBlock = {
  type: "action";
  description: string;
  action?: {
    target: AutomergeUrl;
    args: string;
    result?: {
      type: "success" | "error";
      value: string;
    };
  };
};

type MessageContent = TextBlock | ActionBlock | ThinkingBlock;

export type ChatMessage = {
  id: string;
  author: AutomergeUrl;
  timestamp: number;
  content: MessageContent;
};

export type ChatDoc = {
  messages: ChatMessage[];
  agentDocUrls: AutomergeUrl[];
};
