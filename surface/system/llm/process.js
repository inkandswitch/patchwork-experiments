import { parseScriptBlocks } from './parser.js';

const MAX_ITERATIONS = 20;

function stringifyArg(arg) {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return '[object]';
  }
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
 * @param {string} filename
 */
export function safeDocsBasename(filename) {
  const base = String(filename).replace(/\\/g, '/').split('/').pop() ?? '';
  if (!base || base.includes('..') || base.includes('/')) {
    throw new Error(`Invalid doc name: ${filename}`);
  }
  return base;
}

/**
 * @param {{ readFile: (path: string) => Promise<string> }} filesystem
 * @param {string} filename
 */
export async function readDocFromFilesystem(filesystem, filename) {
  const base = safeDocsBasename(filename);
  return await filesystem.readFile(`docs/${base}`);
}

/**
 * @param {ReturnType<typeof createCapturedConsole>} capturedConsole
 * @param {string} code
 * @param {{ canvas: unknown, readDoc: (f: string) => Promise<string>, repo?: unknown }} evalGlobals
 */
export async function evalScript(code, capturedConsole, evalGlobals) {
  capturedConsole.flush();
  globalThis.__llmCapturedConsole = capturedConsole;
  globalThis.__paperLlmEvalGlobals = evalGlobals;

  try {
    const wrappedCode = `(async () => {
  const console = globalThis.__llmCapturedConsole;
  const canvas = globalThis.__paperLlmEvalGlobals.canvas;
  const readDoc = globalThis.__paperLlmEvalGlobals.readDoc;
  const repo = globalThis.__paperLlmEvalGlobals.repo;
${code}
})()`;
    const returnValue = await eval(wrappedCode);

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
  } finally {
    delete globalThis.__paperLlmEvalGlobals;
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
        let resultText;
        if (block.error) resultText = `[Error: ${block.error}]`;
        else if (block.output) resultText = `[Output: ${block.output}]`;
        else resultText = '[Done]';
        messages.push({ role: 'user', content: resultText });
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
 * @param {HTMLElement} options.canvasElement - frame ref-view
 * @param {{ readFile: (path: string) => Promise<string> }} options.filesystem
 * @param {AbortSignal} [options.signal]
 */
export async function runLlmTurns(options) {
  const { systemPrompt, getRuns, mutatePanel, getConfig, canvasElement, filesystem, signal } = options;

  const readDoc = async (filename) => readDocFromFilesystem(filesystem, filename);

  const evalGlobals = {
    canvas: canvasElement,
    readDoc,
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
            last.content = (last.content || '') + block.content;
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
            last.code = block.code;
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
          const result = await evalScript(codeToEval, capturedConsole, evalGlobals);

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
