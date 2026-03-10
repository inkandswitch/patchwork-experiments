/**
 * Simplified LLM process loop for Petri net documents.
 *
 * Runs a single process: calls LLM streaming endpoint, parses <script>
 * blocks from the response, evals them, feeds results back, and repeats.
 * All output is written to the PetrinetLLMDoc via Automerge handle.change().
 *
 * The LLM has direct access to a single target document exposed as `handle`
 * in the eval context. No skills, no workspace COW, no multi-doc repo.
 */

import type { Repo } from '@automerge/automerge-repo';
import { updateText, type AutomergeUrl } from '@automerge/automerge-repo';
import { parseScriptBlocks } from './parser';
import type { PetrinetLLMDoc, OutputBlock, ChatMessage } from './types';

function stringifyArg(arg: any): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return '[object]';
  }
}

function createCapturedConsole() {
  const output: string[] = [];
  return {
    log: (...args: any[]) => {
      output.push(args.map(stringifyArg).join(' '));
    },
    error: (...args: any[]) => {
      output.push('[error] ' + args.map(stringifyArg).join(' '));
    },
    warn: (...args: any[]) => {
      output.push('[warn] ' + args.map(stringifyArg).join(' '));
    },
    info: (...args: any[]) => {
      output.push(args.map(stringifyArg).join(' '));
    },
    flush(): string {
      const text = output.join('\n');
      output.length = 0;
      return text;
    },
  };
}

export async function runLLMProcess(
  repo: Repo,
  processDocUrl: AutomergeUrl,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await repo.find<PetrinetLLMDoc>(processDocUrl);
  const doc = handle.doc();

  if (!doc?.prompt) {
    throw new Error('No prompt to run');
  }

  const { apiUrl, model } = doc.config;
  const apiKey = (import.meta as any).env?.VITE_LLM_API_KEY || '';

  const targetHandle = await repo.find(doc.docUrl);
  const capturedConsole = createCapturedConsole();

  (globalThis as any).handle = targetHandle;
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  const MAX_ITERATIONS = 20;

  console.log(`[petrinet-llm] starting run: model=${model}, apiUrl=${apiUrl}, prompt="${doc.prompt.slice(0, 80)}"`);

  let iteration = 0;
  for (; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) {
      console.log('[petrinet-llm] aborted before iteration', iteration);
      break;
    }

    const currentDoc = handle.doc();
    if (!currentDoc) break;

    const messages = buildLLMMessages(currentDoc);
    console.log(`[petrinet-llm] iteration ${iteration}: sending ${messages.length} messages to ${model}`);

    const stream = streamChatCompletion(apiUrl, apiKey, model, messages, signal);

    let foundScript = false;

    for await (const block of parseScriptBlocks(stream)) {
      if (signal?.aborted) break;

      if (block.type === 'text' && block.content.trim().length > 0) {
        handle.change((d) => {
          const last = d.output[d.output.length - 1];
          if (last && last.type === 'text') {
            const outputIdx = d.output.length - 1;
            updateText(
              d,
              ['output', outputIdx, 'content'],
              last.content + block.content,
            );
          } else {
            d.output.push({ type: 'text', content: block.content });
          }
        });
      }

      if (block.type === 'script') {
        handle.change((d) => {
          const last = d.output[d.output.length - 1];
          if (last && last.type === 'script' && last.output === undefined) {
            const outputIdx = d.output.length - 1;
            updateText(d, ['output', outputIdx, 'code'], block.code);
          } else {
            if (block.description) {
              d.output.push({ type: 'script', code: block.code, description: block.description });
            } else {
              d.output.push({ type: 'script', code: block.code });
            }
          }
        });

        if (block.complete) {
          foundScript = true;
          console.log(`[petrinet-llm] iteration ${iteration}: evaluating script (description="${block.description ?? ''}", ${block.code.length} chars)`);

          const result = await evalScript(block.code, capturedConsole);
          console.log(`[petrinet-llm] iteration ${iteration}: eval result`, result.error ? `ERROR: ${result.error}` : `output: ${result.output ?? '(none)'}`);

          handle.change((d) => {
            const outputIdx = d.output.length - 1;
            const scriptBlock = d.output[outputIdx];
            if (scriptBlock.type !== 'script') return;
            scriptBlock.output = '';
            if (result.output) {
              updateText(d, ['output', outputIdx, 'output'], result.output);
            }
            if (result.error) {
              scriptBlock.error = '';
              updateText(d, ['output', outputIdx, 'error'], result.error);
            }
          });

          break;
        }
      }
    }

    console.log(`[petrinet-llm] iteration ${iteration}: stream complete, foundScript=${foundScript}`);

    if (!foundScript) {
      console.log('[petrinet-llm] no script found — run complete');
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn('[petrinet-llm] reached max iterations limit');
  }

  console.log('[petrinet-llm] run finished');
}

// --- LLM message building ---

export function buildLLMMessages(doc: PetrinetLLMDoc): ChatMessage[] {
  const messages: ChatMessage[] = [];

  messages.push({ role: 'system', content: SYSTEM_PROMPT });
  messages.push({ role: 'user', content: doc.prompt });

  if (doc.output.length > 0) {
    appendOutputMessages(messages, doc.output);
  }

  return messages;
}

function appendOutputMessages(messages: ChatMessage[], blocks: OutputBlock[]): void {
  let assistantParts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      assistantParts.push(block.content);
    } else if (block.type === 'script') {
      if (block.description) {
        assistantParts.push(
          `<script data-description="${block.description}">\n${block.code}\n</script>`,
        );
      } else {
        assistantParts.push(`<script>\n${block.code}\n</script>`);
      }

      if (block.output !== undefined) {
        if (assistantParts.length > 0) {
          messages.push({ role: 'assistant', content: assistantParts.join('\n') });
          assistantParts = [];
        }
        let resultText: string;
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

export const SYSTEM_PROMPT = `You are a coding agent with direct access to an Automerge document and the ability to execute JavaScript.

You can execute code by writing it inside <script> tags. Add a data-description attribute to briefly describe what the code does:

<script data-description="Inspect the current document state">
console.log(handle.doc())
</script>

Available APIs in your execution context:

  handle.url        — the document URL
  handle.doc()      — get the current document state
  handle.change(fn) — mutate the document

  console.log(...)  — output text (captured and shown to you)
  return value      — return a value from the script (shown to you as output)

After each <script> block you will see the console output, return value, or any errors.
Use this to inspect results and decide your next steps.

Write text outside of script tags to explain your reasoning.
Keep your code concise and focused on the task.`;

// --- LLM streaming ---

async function* streamChatCompletion(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[petrinet-llm] API error ${response.status} from ${url}:`, text);
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

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
}

async function evalScript(
  code: string,
  capturedConsole: ReturnType<typeof createCapturedConsole>,
): Promise<{ output?: string; error?: string }> {
  capturedConsole.flush();
  (globalThis as any).__llmCapturedConsole = capturedConsole;

  try {
    const wrappedCode = `(async () => { const console = globalThis.__llmCapturedConsole;\n${code}\n})()`;
    const returnValue = await eval(wrappedCode);

    const consoleOutput = capturedConsole.flush();
    const parts: string[] = [];
    if (consoleOutput) parts.push(consoleOutput);
    if (returnValue !== undefined) parts.push(stringifyArg(returnValue));

    const result: { output?: string; error?: string } = {};
    if (parts.length > 0) result.output = parts.join('\n');
    return result;
  } catch (err: any) {
    const consoleOutput = capturedConsole.flush();
    const result: { output?: string; error?: string } = {
      error: err.message || String(err),
    };
    if (consoleOutput) result.output = consoleOutput;
    return result;
  }
}
