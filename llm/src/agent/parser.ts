// Block types with state discriminator

type;

export type ThinkingBlock = {
  type: "thinking";
  state: "in_progress" | "complete";
  description: string;
  content: string;
};

export type MessageBlock = {
  type: "message";
  state: "complete";
  content: string;
};

export type InProgressActionBlock = {
  type: "action";
  state: "in_progress";
  description: string;
  content: string;
};

export type CompleteActionBlock = {
  type: "action";
  state: "complete";
  description: string;
  action: {
    actionId: string;
    target: string;
    args: Record<string, unknown>;
  };
};

export type ActionBlock = InProgressActionBlock | CompleteActionBlock;

export type ParsedBlock = ThinkingBlock | MessageBlock | ActionBlock;

export type ParseResult = {
  blocks: ParsedBlock[];
  remainingBuffer: string;
};

interface BlockMatch {
  start: number;
  end: number;
  complete: boolean;
  block: ThinkingBlock | ActionBlock;
}

type AddAction<T> = {
  type: "add";
  block: T
}

type UpdateAction<T> = {
  type: "update";
  block: T
}

type Action = 


export async function* parseResponse(buffer: string): Generator<ParsedBlock> {
  const blocks: ParsedBlock[] = [];
  const workingBuffer = buffer;
  const blockMatches: BlockMatch[] = [];

  // Find complete thinking blocks
  const thinkingRegex =
    /<thinking\s+description="([^"]+)">([\s\S]*?)<\/thinking>/g;
  let match;
  while ((match = thinkingRegex.exec(workingBuffer)) !== null) {
    blockMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      complete: true,
      block: {
        type: "thinking",
        state: "complete",
        description: match[1].trim(),
        content: match[2].trim(),
      },
    });
  }

  // Find complete action blocks
  const actionRegex = /<action\s+description="([^"]+)">([\s\S]*?)<\/action>/g;
  while ((match = actionRegex.exec(workingBuffer)) !== null) {
    const description = match[1].trim();
    const jsonContent = match[2].trim();
    try {
      const parsed = JSON.parse(jsonContent);
      blockMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        complete: true,
        block: {
          type: "action",
          state: "complete",
          description,
          action: {
            actionId: parsed.actionId,
            target: parsed.target,
            args: parsed.args || {},
          },
        },
      });
    } catch {
      // Invalid JSON in complete block - skip it
      console.error("Invalid JSON in action block:", jsonContent);
    }
  }

  // Check for incomplete thinking block at end
  let incompleteStart = -1;
  let remainingBuffer = "";

  const hasIncompleteThinking =
    workingBuffer.includes("<thinking") &&
    !workingBuffer
      .slice(workingBuffer.lastIndexOf("<thinking"))
      .includes("</thinking>");

  if (hasIncompleteThinking) {
    const startIndex = workingBuffer.lastIndexOf("<thinking");
    incompleteStart = startIndex;
    const incompleteText = workingBuffer.slice(startIndex);
    const incompleteThinkingRegex =
      /<thinking\s+description="([^"]+)">([^]*?)$/;
    const incMatch = incompleteText.match(incompleteThinkingRegex);
    if (incMatch) {
      blockMatches.push({
        start: startIndex,
        end: workingBuffer.length,
        complete: false,
        block: {
          type: "thinking",
          state: "in_progress",
          description: incMatch[1].trim(),
          content: incMatch[2].trim(),
        },
      });
    }
    remainingBuffer = incompleteText;
  }

  // Check for incomplete action block at end (if no incomplete thinking)
  if (incompleteStart === -1) {
    const hasIncompleteAction =
      workingBuffer.includes("<action") &&
      !workingBuffer
        .slice(workingBuffer.lastIndexOf("<action"))
        .includes("</action>");

    if (hasIncompleteAction) {
      const startIndex = workingBuffer.lastIndexOf("<action");
      incompleteStart = startIndex;
      const incompleteText = workingBuffer.slice(startIndex);
      const incompleteActionRegex = /<action\s+description="([^"]+)">([^]*?)$/;
      const incMatch = incompleteText.match(incompleteActionRegex);
      if (incMatch) {
        blockMatches.push({
          start: startIndex,
          end: workingBuffer.length,
          complete: false,
          block: {
            type: "action",
            state: "in_progress",
            description: incMatch[1].trim(),
            content: incMatch[2].trim(),
          },
        });
      }
      remainingBuffer = incompleteText;
    }
  }

  // Sort blocks by start position
  blockMatches.sort((a, b) => a.start - b.start);

  // Build final block list, inserting message blocks for text between blocks
  let lastEnd = 0;
  const textEndBoundary =
    incompleteStart !== -1 ? incompleteStart : workingBuffer.length;

  // Process only complete blocks for text extraction
  const completeBlockMatches = blockMatches.filter((b) => b.complete);
  for (const blockMatch of completeBlockMatches) {
    if (blockMatch.start > lastEnd) {
      const textBetween = workingBuffer.slice(lastEnd, blockMatch.start);
      if (textBetween.trim()) {
        blocks.push({
          type: "message",
          state: "complete",
          content: textBetween.trim(),
        });
      }
    }
    blocks.push(blockMatch.block);
    lastEnd = blockMatch.end;
  }

  // Add any text after the last complete block (before incomplete block if any)
  if (lastEnd < textEndBoundary) {
    const remainingText = workingBuffer.slice(lastEnd, textEndBoundary);
    if (remainingText.trim()) {
      blocks.push({
        type: "message",
        state: "complete",
        content: remainingText.trim(),
      });
    }
  }

  // Finally, add incomplete block if any
  const incompleteBlock = blockMatches.find((b) => !b.complete);
  if (incompleteBlock) {
    blocks.push(incompleteBlock.block);
  }

  return { blocks, remainingBuffer };
}
