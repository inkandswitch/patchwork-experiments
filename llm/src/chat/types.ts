import { AutomergeUrl } from "@automerge/automerge-repo";

type TextBlock = {
  type: "text";
  text: string;
};

type ThinkingBlock = {
  type: "thinking";
  description: string;
  text: string;
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
  title: string;
  messages: ChatMessage[];
  agentDocUrl: AutomergeUrl;
};
