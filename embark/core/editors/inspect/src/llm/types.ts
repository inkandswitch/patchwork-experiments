// Message shapes for the card-regeneration loop, trimmed from the llm tool's
// types: messages live only in memory for the duration of a run (the log panel
// renders them), so there is no document schema here.

export type ScriptBlock = {
  type: "script";
  code: string;
  description?: string;
  output?: string;
  error?: string;
};

export type TextBlock = {
  type: "text";
  text: string;
};

export type ContentBlock = TextBlock | ScriptBlock;

export type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type ParsedBlock =
  | { index: number; type: "text"; content: string; complete: boolean }
  | {
      index: number;
      type: "script";
      code: string;
      description?: string;
      complete: boolean;
    };

// The slice of a card document the regeneration loop touches. The full shape
// lives in @embark/card, which inspect deliberately doesn't depend on.
export type CardDocLike = {
  "@patchwork"?: { type?: string; title?: string };
  src?: string;
};
