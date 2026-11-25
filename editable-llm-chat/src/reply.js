// What a reply is asked as: the request sent to the provider, the task's
// input, and the key it is asked under, made in one place so that the input
// and the key name the same reply (the chat and the message's id).

/** What the model is told before the conversation. */
export const SYSTEM_PROMPT = 'You are a helpful assistant.';

/**
 * The key a reply is asked under: the chat and the reply's id. Asking twice
 * for one reply while it is being written is asking once.
 * @param {string} chatUrl
 * @param {string} messageId
 */
export const replyKey = (chatUrl, messageId) => `editable-llm-chat:reply:${chatUrl}:${messageId}`;

/** The provider's chat completions endpoint for an API base url. */
export const endpointOf = (apiUrl) => `${String(apiUrl).replace(/\/$/, '')}/chat/completions`;

/**
 * The request for the reply with this id: the system prompt and every message
 * before it that has text and is not being written now, as they read now.
 * @param {any} doc  the chat
 * @param {string} messageId
 * @param {(id: string) => boolean} [beingWritten]  whether a message's reply is being written now
 * @returns {{ endpoint: string, model: string, messages: { role: string, content: string }[] }}
 */
export function requestFor(doc, messageId, beingWritten = () => false) {
  const messages = [...(doc?.messages ?? [])];
  const at = messages.findIndex((m) => m?.id === messageId);
  const before = at < 0 ? messages : messages.slice(0, at);
  return {
    endpoint: endpointOf(doc?.config?.apiUrl ?? ''),
    model: String(doc?.config?.model ?? ''),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...before
        .filter((m) => typeof m?.content === 'string' && m.content !== '' && !(m.id && beingWritten(m.id)))
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    ],
  };
}

/**
 * The machine labels a reply needs: the chat's own `config.needs`, when it
 * has any (a model that only one machine has), else none.
 * @param {any} doc
 * @returns {string[] | undefined}
 */
export function needsOf(doc) {
  const needs = doc?.config?.needs;
  return Array.isArray(needs) && needs.length > 0 ? needs.map(String) : undefined;
}

/**
 * What a reply is asked as: the task's input and its key, both from the chat
 * and the message.
 * @param {string} chatUrl
 * @param {string} messageId
 * @param {ReturnType<typeof requestFor>} request
 * @param {string} apiKey
 */
export function replyAsk(chatUrl, messageId, request, apiKey) {
  return {
    input: { chat: chatUrl, message: messageId, request: JSON.parse(JSON.stringify(request)), apiKey },
    key: replyKey(chatUrl, messageId),
  };
}
