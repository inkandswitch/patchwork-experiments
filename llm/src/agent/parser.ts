import type {
  ActionBlock,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
} from "../chat/types";

type ParserState = "text" | "in_action" | "in_thinking";

export type CreateBlockEvent = {
  type: "create";
  block: ContentBlock;
};

export type UpdateBlockEvent = {
  type: "update";
  block: ContentBlock;
};

export type ParseEvent = CreateBlockEvent | UpdateBlockEvent;

const OPENING_TAG_REGEX = /<(action|thinking)\s+description="([^"]*)">/;

/**
 * Streaming parser that processes an AsyncGenerator of string chunks
 * and emits ParseEvents for content blocks.
 *
 * Block types:
 * - <action description="...">JSON content</action>
 * - <thinking description="...">text content</thinking>
 * - Everything else is plain text
 */
export async function* parseBlocks(
  stream: AsyncGenerator<string>
): AsyncGenerator<ParseEvent> {
  let buffer = "";
  let state: ParserState = "text";
  let currentTextBlock: TextBlock | null = null;
  let currentSpecialBlock: ActionBlock | ThinkingBlock | null = null;
  let blockContent = "";

  for await (const chunk of stream) {
    buffer += chunk;

    while (true) {
      if (state === "text") {
        const match = buffer.match(OPENING_TAG_REGEX);

        if (match && match.index !== undefined) {
          // Emit text before the tag
          if (match.index > 0) {
            const textBefore = buffer.slice(0, match.index);
            if (currentTextBlock) {
              currentTextBlock.text += textBefore;
              yield { type: "update", block: currentTextBlock };
            } else {
              currentTextBlock = { type: "text", text: textBefore };
              yield { type: "create", block: currentTextBlock };
            }
          }

          // Reset text block since we're starting a special block
          currentTextBlock = null;

          const tagType = match[1] as "action" | "thinking";
          const description = match[2];

          if (tagType === "action") {
            currentSpecialBlock = { type: "action", description };
            state = "in_action";
          } else {
            currentSpecialBlock = { type: "thinking", description, text: "" };
            state = "in_thinking";
          }

          yield { type: "create", block: currentSpecialBlock };
          blockContent = "";
          buffer = buffer.slice(match.index + match[0].length);
        } else {
          // No complete opening tag found
          // Check if there might be a partial tag at the end
          const partialTagIndex = findPotentialPartialOpenTag(buffer);

          if (partialTagIndex < buffer.length) {
            // Emit safe text before potential partial tag
            if (partialTagIndex > 0) {
              const textToEmit = buffer.slice(0, partialTagIndex);
              if (currentTextBlock) {
                currentTextBlock.text += textToEmit;
                yield { type: "update", block: currentTextBlock };
              } else {
                currentTextBlock = { type: "text", text: textToEmit };
                yield { type: "create", block: currentTextBlock };
              }
            }
            buffer = buffer.slice(partialTagIndex);
          } else {
            // No potential partial tag, emit all
            if (buffer.length > 0) {
              if (currentTextBlock) {
                currentTextBlock.text += buffer;
                yield { type: "update", block: currentTextBlock };
              } else {
                currentTextBlock = { type: "text", text: buffer };
                yield { type: "create", block: currentTextBlock };
              }
              buffer = "";
            }
          }
          break; // Wait for more data
        }
      } else {
        // In action or thinking block
        const closingTag = state === "in_action" ? "</action>" : "</thinking>";
        const closeIndex = buffer.indexOf(closingTag);

        if (closeIndex !== -1) {
          // Found closing tag
          blockContent += buffer.slice(0, closeIndex);

          if (currentSpecialBlock) {
            if (currentSpecialBlock.type === "action") {
              try {
                currentSpecialBlock.action = JSON.parse(blockContent.trim());
              } catch (e) {
                console.error("Failed to parse action JSON:", blockContent, e);
              }
            } else {
              currentSpecialBlock.text = blockContent;
            }
            yield { type: "update", block: currentSpecialBlock };
          }

          buffer = buffer.slice(closeIndex + closingTag.length);
          state = "text";
          currentSpecialBlock = null;
          blockContent = "";
        } else {
          // No closing tag yet, check for partial closing tag at end
          const tagType = state === "in_action" ? "action" : "thinking";
          const partialCloseIndex = findPotentialPartialCloseTag(
            buffer,
            tagType
          );

          if (partialCloseIndex < buffer.length) {
            blockContent += buffer.slice(0, partialCloseIndex);
            buffer = buffer.slice(partialCloseIndex);
          } else {
            blockContent += buffer;
            buffer = "";
          }

          // For thinking blocks, emit streaming updates
          if (currentSpecialBlock && currentSpecialBlock.type === "thinking") {
            currentSpecialBlock.text = blockContent;
            yield { type: "update", block: currentSpecialBlock };
          }

          break; // Wait for more data
        }
      }
    }
  }

  // Handle remaining buffer at end of stream
  if (state === "text") {
    if (buffer.length > 0) {
      if (currentTextBlock) {
        currentTextBlock.text += buffer;
        yield { type: "update", block: currentTextBlock };
      } else {
        yield { type: "create", block: { type: "text", text: buffer } };
      }
    }
  } else {
    // Unclosed block at end of stream - finalize it with remaining content
    blockContent += buffer;
    if (currentSpecialBlock) {
      if (currentSpecialBlock.type === "action") {
        try {
          currentSpecialBlock.action = JSON.parse(blockContent.trim());
        } catch {
          // Leave action undefined if JSON is invalid
        }
      } else {
        currentSpecialBlock.text = blockContent;
      }
      yield { type: "update", block: currentSpecialBlock };
    }
  }
}

/**
 * Find the index where a potential partial opening tag starts at the end of the buffer.
 * Returns buffer.length if no potential partial tag is found.
 */
function findPotentialPartialOpenTag(buffer: string): number {
  const maxTagLength = '<thinking description="">'.length;

  for (
    let i = Math.max(0, buffer.length - maxTagLength);
    i < buffer.length;
    i++
  ) {
    if (buffer[i] === "<") {
      const remaining = buffer.slice(i);

      // Check if this could be the start of <action or <thinking
      if (
        '<action description="'.startsWith(remaining) ||
        '<thinking description="'.startsWith(remaining)
      ) {
        return i;
      }
    }
  }

  return buffer.length;
}

/**
 * Find the index where a potential partial closing tag starts at the end of the buffer.
 * Returns buffer.length if no potential partial tag is found.
 */
function findPotentialPartialCloseTag(
  buffer: string,
  tagType: "action" | "thinking"
): number {
  const closeTag = `</${tagType}>`;

  for (
    let i = Math.max(0, buffer.length - closeTag.length);
    i < buffer.length;
    i++
  ) {
    if (buffer[i] === "<") {
      const remaining = buffer.slice(i);
      if (closeTag.startsWith(remaining)) {
        return i;
      }
    }
  }

  return buffer.length;
}
