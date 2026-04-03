import { parseScriptBlocks } from './parser.js';

const MAX_ITERATIONS = 20;

function stringifyArg(arg) {
  if (arg instanceof HTMLImageElement) return imageToDataUrl(arg);
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return '[object]';
  }
}

function imageToDataUrl(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return img.src || '[empty image]';
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function createCapturedConsole() {
  const output = [];
  return {
    log: (...args) => {
      output.push(args.map(stringifyArg).join(' '));
    },
    error: (...args) => {
      output.push('[error] ' + args.map(stringifyArg).join(' '));
    },
    warn: (...args) => {
      output.push('[warn] ' + args.map(stringifyArg).join(' '));
    },
    info: (...args) => {
      output.push(args.map(stringifyArg).join(' '));
    },
    flush() {
      const text = output.join('\n');
      output.length = 0;
      return text;
    },
  };
}

/**
 * @param {string} apiUrl
 * @param {string} apiKey
 * @param {string} model
 * @param {{ role: string, content: string }[]} messages
 * @param {AbortSignal} [signal]
 */
export async function* streamChatCompletion(apiUrl, apiKey, model, messages, signal) {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      // OpenRouter recommends Referer + title for rankings (optional)
      'HTTP-Referer': globalThis.location?.origin ?? 'http://localhost',
      'X-Title': 'Paper',
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * @param {ReturnType<typeof createCapturedConsole>} capturedConsole
 * @param {string} code
 * @param {{ element: unknown, repo?: unknown }} evalBindings
 */
export async function evalScript(code, capturedConsole, evalBindings) {
  capturedConsole.flush();
  /** @type {Record<string, unknown>} */
  const bindings = {
    console: capturedConsole,
    ...evalBindings,
  };

  try {
    // `new Function` bodies are non-strict by default, so `with` is permitted; unqualified names resolve against `bindings`.
    const run = new Function(
      '__bindings',
      `return (async () => {
  with (__bindings) {
${code}
  }
})();`,
    );
    const returnValue = await run(bindings);

    const consoleOutput = capturedConsole.flush();
    const parts = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    const result = {};
    if (parts.length > 0) result.output = parts.join('\n');
    return result;
  } catch (err) {
    const consoleOutput = capturedConsole.flush();
    const result = {
      error: err?.message || String(err),
    };
    if (consoleOutput) result.output = consoleOutput;
    return result;
  }
}

/**
 * @param {{ role: string, content: string }[]} messages
 * @param {{ type: string, content?: string, code?: string, description?: string, output?: string, error?: string }[]} blocks
 */
export function appendOutputMessages(messages, blocks) {
  let assistantParts = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      assistantParts.push(block.content);
    } else if (block.type === 'script') {
      if (block.description) {
        assistantParts.push(`<script data-description="${block.description}">\n${block.code}\n</script>`);
      } else {
        assistantParts.push(`<script>\n${block.code}\n</script>`);
      }

      if (block.output !== undefined || block.error !== undefined) {
        if (assistantParts.length > 0) {
          messages.push({ role: 'assistant', content: assistantParts.join('\n') });
          assistantParts = [];
        }
        
        if (block.error) {
          messages.push({ role: 'user', content: `[Error: ${block.error}]` });
        } else if (block.output) {
          const dataUrlRegex = /data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+/g;
          const dataUrls = block.output.match(dataUrlRegex);
          if (dataUrls) {
            let textOutput = block.output;
            for (const url of dataUrls) {
              textOutput = textOutput.replace(url, '[Image omitted from text]');
            }
            
            const contentArray = [];
            if (textOutput.trim()) {
              contentArray.push({ type: 'text', text: `[Output:\n${textOutput}]` });
            } else {
              contentArray.push({ type: 'text', text: `[Output: <image>]` });
            }
            
            for (const url of dataUrls) {
              contentArray.push({ type: 'image_url', image_url: { url } });
            }
            messages.push({ role: 'user', content: contentArray });
          } else {
            messages.push({ role: 'user', content: `[Output: ${block.output}]` });
          }
        } else {
          messages.push({ role: 'user', content: '[Done]' });
        }
      }
    }
  }

  if (assistantParts.length > 0) {
    messages.push({ role: 'assistant', content: assistantParts.join('\n') });
  }
}

/**
 * @param {string} systemPrompt
 * @param {{ prompt: string, output: { type: string, content?: string, code?: string, description?: string, output?: string, error?: string }[] }[]} runs
 */
export function buildChatMessages(systemPrompt, runs) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const run of runs) {
    messages.push({ role: 'user', content: run.prompt });
    appendOutputMessages(messages, run.output || []);
  }
  return messages;
}

/**
 * @param {object} options
 * @param {string} options.systemPrompt
 * @param {() => { prompt: string, output: unknown[] }[]} options.getRuns
 * @param {(fn: (panel: { runs: { prompt: string, output: unknown[], done?: boolean }[] }) => void) => void} options.mutatePanel
 * @param {() => { apiUrl: string, model: string, apiKey: string }} options.getConfig
 * @param {HTMLElement} options.element - outermost frame \`ref-view\` (script \`element\` binding via \`with\`)
 * @param {AbortSignal} [options.signal]
 */
export async function runLlmTurns(options) {
  const { systemPrompt, getRuns, mutatePanel, getConfig, element, signal } = options;

  const evalBindings = {
    element,
    filesystem: element.filesystem,
    repo: globalThis.repo,
  };

  const capturedConsole = createCapturedConsole();

  let iteration = 0;
  for (; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) break;

    const runsSnapshot = getRuns();
    const messages = buildChatMessages(systemPrompt, runsSnapshot);
    const { apiUrl, model, apiKey } = getConfig();

    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === 'text' && block.content.trim().length > 0) {
        mutatePanel((panel) => {
          const run = panel.runs[panel.runs.length - 1];
          const out = run.output;
          const last = out[out.length - 1];
          if (last && last.type === 'text') {
            const Am = globalThis.Automerge;
            const idx = panel.runs.length - 1;
            const outIdx = out.length - 1;
            if (Am?.updateText) {
              Am.updateText(panel, ['runs', idx, 'output', outIdx, 'content'], (last.content || '') + block.content);
            } else {
              last.content = (last.content || '') + block.content;
            }
          } else {
            out.push({ type: 'text', content: block.content });
          }
        });
      }

      if (block.type === 'script') {
        mutatePanel((panel) => {
          const run = panel.runs[panel.runs.length - 1];
          const out = run.output;
          const last = out[out.length - 1];
          if (last && last.type === 'script' && last.output === undefined && last.error === undefined) {
            const Am = globalThis.Automerge;
            const idx = panel.runs.length - 1;
            const outIdx = out.length - 1;
            if (Am?.updateText) {
              Am.updateText(panel, ['runs', idx, 'output', outIdx, 'code'], block.code);
            } else {
              last.code = block.code;
            }
            if (block.description !== undefined) last.description = block.description;
          } else {
            out.push({
              type: 'script',
              code: block.code,
              description: block.description,
            });
          }
        });

        if (block.complete) {
          foundScript = true;
          const codeToEval = block.code;
          const result = await evalScript(codeToEval, capturedConsole, evalBindings);

          mutatePanel((panel) => {
            const run = panel.runs[panel.runs.length - 1];
            const out = run.output;
            const scriptBlock = out[out.length - 1];
            if (scriptBlock?.type === 'script') {
              scriptBlock.output = result.output ?? '';
              if (result.error) scriptBlock.error = result.error;
            }
          });

          break;
        }
      }
    }

    if (!foundScript) {
      break;
    }
  }

  mutatePanel((panel) => {
    const run = panel.runs[panel.runs.length - 1];
    if (run) run.done = true;
  });
}
