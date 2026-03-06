/**
 * Format a tool-call fence string for use in a Computer AI chat message.
 *
 * @param {string} tool - Tool name (e.g. 'inspect_iframe', 'eval_in_iframe')
 * @param {Record<string, string>} args - Key-value arguments for the tool call
 * @returns {string} - Complete tool-call fence block
 *
 * @example
 * formatToolCall('eval_in_iframe', { url: 'automerge:X', code: 'document.title' })
 * // "```tool-call\ntool: eval_in_iframe\nurl: automerge:X\ncode: document.title\n```"
 */
export function formatToolCall(tool, args) {
  const lines = [`tool: ${tool}`];
  for (const [key, value] of Object.entries(args)) {
    lines.push(`${key}: ${value}`);
  }
  return "```tool-call\n" + lines.join("\n") + "\n```";
}

/**
 * Parse a plain-text tool result into a JavaScript value (best-effort).
 * Tries JSON.parse first; falls back to returning the raw string.
 *
 * @param {string} text - Raw result text from a tool call response
 * @returns {any} - Parsed JS value, or the original string if parsing fails
 */
export function parseToolResult(text) {
  const trimmed = (text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
