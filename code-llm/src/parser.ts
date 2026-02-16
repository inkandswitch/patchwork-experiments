import type { ParsedBlock } from "./types";

/**
 * Simple streaming parser that extracts <script> blocks from an async token stream.
 *
 * Yields ParsedBlock items with an id and complete flag:
 *   - { type: "text", complete: true }    for text chunks between scripts
 *   - { type: "script", complete: false } while a script block is still streaming
 *   - { type: "script", complete: true }  when a </script> closing tag is found
 *
 * The parser is a minimal state machine with two states: "text" and "script".
 * It scans for <script> and </script> tags. No attribute parsing, no nesting.
 *
 * Each logical block (text region or script block) gets a unique incrementing id.
 * While inside a script block, the parser yields blocks with complete=false
 * carrying the accumulated code so far, allowing the UI to render incrementally.
 */
export async function* parseScriptBlocks(
  stream: AsyncIterable<string>
): AsyncGenerator<ParsedBlock> {
  let buffer = "";
  let state: "text" | "script" = "text";
  let scriptBuffer = "";
  let blockId = 0;

  const OPEN_TAG = "<script>";
  const CLOSE_TAG = "</script>";

  for await (const chunk of stream) {
    buffer += chunk;

    while (true) {
      if (state === "text") {
        const openIdx = buffer.indexOf(OPEN_TAG);

        if (openIdx !== -1) {
          // Emit any text before the <script> tag
          if (openIdx > 0) {
            yield { id: blockId, type: "text", content: buffer.slice(0, openIdx), complete: true };
          }
          buffer = buffer.slice(openIdx + OPEN_TAG.length);
          state = "script";
          scriptBuffer = "";
          blockId++;
        } else {
          // Check for a potential partial <script> tag at the end of the buffer
          const partialIdx = findPartialTag(buffer, OPEN_TAG);
          if (partialIdx < buffer.length) {
            // Emit safe text before the potential partial tag
            if (partialIdx > 0) {
              yield { id: blockId, type: "text", content: buffer.slice(0, partialIdx), complete: true };
            }
            buffer = buffer.slice(partialIdx);
          } else {
            // No partial tag, emit everything
            if (buffer.length > 0) {
              yield { id: blockId, type: "text", content: buffer, complete: true };
              buffer = "";
            }
          }
          break; // Wait for more data
        }
      } else {
        // state === "script"
        const closeIdx = buffer.indexOf(CLOSE_TAG);

        if (closeIdx !== -1) {
          scriptBuffer += buffer.slice(0, closeIdx);
          yield { id: blockId, type: "script", code: scriptBuffer, complete: true };
          buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
          state = "text";
          scriptBuffer = "";
          blockId++;
        } else {
          // Check for a partial </script> at the end
          const partialIdx = findPartialTag(buffer, CLOSE_TAG);
          if (partialIdx < buffer.length) {
            scriptBuffer += buffer.slice(0, partialIdx);
            buffer = buffer.slice(partialIdx);
          } else {
            scriptBuffer += buffer;
            buffer = "";
          }
          // Yield in-progress code so the UI can render incrementally
          if (scriptBuffer.length > 0) {
            yield { id: blockId, type: "script", code: scriptBuffer, complete: false };
          }
          break; // Wait for more data
        }
      }
    }
  }

  // End of stream: flush remaining content
  if (state === "text") {
    if (buffer.length > 0) {
      yield { id: blockId, type: "text", content: buffer, complete: true };
    }
  } else {
    // Unclosed script block -- emit whatever we have as text
    scriptBuffer += buffer;
    if (scriptBuffer.length > 0) {
      yield { id: blockId, type: "text", content: `<script>${scriptBuffer}`, complete: true };
    }
  }
}

/**
 * Find the index where a potential partial tag starts at the end of the buffer.
 * Returns buffer.length if no partial match is found.
 */
function findPartialTag(buffer: string, tag: string): number {
  for (
    let i = Math.max(0, buffer.length - tag.length + 1);
    i < buffer.length;
    i++
  ) {
    const remaining = buffer.slice(i);
    if (tag.startsWith(remaining)) {
      return i;
    }
  }
  return buffer.length;
}
