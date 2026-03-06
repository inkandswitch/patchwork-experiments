import type { ParsedBlock } from './types.js'

/**
 * Simple streaming parser that extracts <script> blocks from an async token stream.
 *
 * Yields ParsedBlock items with an id and complete flag:
 *   - { type: "text", complete: true }    for text chunks between scripts
 *   - { type: "script", complete: false } while a script block is still streaming
 *   - { type: "script", complete: true }  when a </script> closing tag is found
 */
export async function* parseScriptBlocks(
  stream: AsyncIterable<string>
): AsyncGenerator<ParsedBlock> {
  let buffer = ''
  let state: 'text' | 'script' = 'text'
  let scriptBuffer = ''
  let blockId = 0
  let currentDescription: string | undefined

  const SCRIPT_PREFIX = '<script'
  const CLOSE_TAG = '</script>'

  for await (const chunk of stream) {
    buffer += chunk

    while (true) {
      if (state === 'text') {
        const scriptIdx = buffer.indexOf(SCRIPT_PREFIX)

        if (scriptIdx !== -1) {
          const afterPrefixIdx = scriptIdx + SCRIPT_PREFIX.length

          if (afterPrefixIdx >= buffer.length) {
            if (scriptIdx > 0) {
              yield { id: blockId, type: 'text', content: buffer.slice(0, scriptIdx), complete: true }
              buffer = buffer.slice(scriptIdx)
            }
            break
          }

          const afterChar = buffer[afterPrefixIdx]
          if (afterChar !== '>' && afterChar !== ' ' && afterChar !== '\t' && afterChar !== '\n') {
            const safeEnd = afterPrefixIdx
            yield { id: blockId, type: 'text', content: buffer.slice(0, safeEnd), complete: true }
            buffer = buffer.slice(safeEnd)
            continue
          }

          const tagEndIdx = buffer.indexOf('>', afterPrefixIdx)

          if (tagEndIdx !== -1) {
            const openingTag = buffer.slice(scriptIdx, tagEndIdx + 1)
            const descMatch = openingTag.match(/data-description="([^"]*)"/)
            currentDescription = descMatch ? descMatch[1] : undefined

            if (scriptIdx > 0) {
              yield { id: blockId, type: 'text', content: buffer.slice(0, scriptIdx), complete: true }
            }
            buffer = buffer.slice(tagEndIdx + 1)
            state = 'script'
            scriptBuffer = ''
            blockId++
          } else {
            if (scriptIdx > 0) {
              yield { id: blockId, type: 'text', content: buffer.slice(0, scriptIdx), complete: true }
              buffer = buffer.slice(scriptIdx)
            }
            break
          }
        } else {
          const partialIdx = findPartialTag(buffer, SCRIPT_PREFIX)
          if (partialIdx < buffer.length) {
            if (partialIdx > 0) {
              yield { id: blockId, type: 'text', content: buffer.slice(0, partialIdx), complete: true }
            }
            buffer = buffer.slice(partialIdx)
          } else {
            if (buffer.length > 0) {
              yield { id: blockId, type: 'text', content: buffer, complete: true }
              buffer = ''
            }
          }
          break
        }
      } else {
        const closeIdx = buffer.indexOf(CLOSE_TAG)

        if (closeIdx !== -1) {
          scriptBuffer += buffer.slice(0, closeIdx)
          yield {
            id: blockId,
            type: 'script',
            code: scriptBuffer,
            description: currentDescription,
            complete: true,
          }
          buffer = buffer.slice(closeIdx + CLOSE_TAG.length)
          state = 'text'
          scriptBuffer = ''
          currentDescription = undefined
          blockId++
        } else {
          const partialIdx = findPartialTag(buffer, CLOSE_TAG)
          if (partialIdx < buffer.length) {
            scriptBuffer += buffer.slice(0, partialIdx)
            buffer = buffer.slice(partialIdx)
          } else {
            scriptBuffer += buffer
            buffer = ''
          }
          if (scriptBuffer.length > 0) {
            yield {
              id: blockId,
              type: 'script',
              code: scriptBuffer,
              description: currentDescription,
              complete: false,
            }
          }
          break
        }
      }
    }
  }

  if (state === 'text') {
    if (buffer.length > 0) {
      yield { id: blockId, type: 'text', content: buffer, complete: true }
    }
  } else {
    scriptBuffer += buffer
    if (scriptBuffer.length > 0) {
      yield { id: blockId, type: 'text', content: `<script>${scriptBuffer}`, complete: true }
    }
  }
}

function findPartialTag(buffer: string, tag: string): number {
  for (
    let i = Math.max(0, buffer.length - tag.length + 1);
    i < buffer.length;
    i++
  ) {
    const remaining = buffer.slice(i)
    if (tag.startsWith(remaining)) {
      return i
    }
  }
  return buffer.length
}
