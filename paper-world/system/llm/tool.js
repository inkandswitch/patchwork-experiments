import { from, render, html, For, createSignal } from '../solid.js';
import { marked } from 'https://esm.sh/marked@15';
import { buildSystemPrompt } from './system-prompt.js';
import { runLlmTurns } from './process.js';
import llmSchema from './schema.js';
import styles from './shape.css' with { type: 'css' };

document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];



const MODELS = [
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-haiku-3.5', name: 'Claude Haiku 3.5' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
  { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano' },
  { id: 'openai/o4-mini', name: 'o4-mini' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash' },
];

export default function mount(element) {
  const frameRefView = rootRefView(element);
  if (!frameRefView) {
    const pre = document.createElement('pre');
    pre.textContent = 'llm panel: could not resolve frame ref-view';
    element.appendChild(pre);
    return () => pre.remove();
  }

  const ref = element.getOrCreate(llmSchema);
  const data = from(ref);
  const [prompt, setPrompt] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [tab, setTab] = createSignal('chat');
  const [systemPromptText, setSystemPromptText] = createSignal('');
  let abortController = null;

  function getRuns() {
    return data()?.runs ?? [];
  }

  function hasRuns() {
    return getRuns().length > 0;
  }

  function getModel() {
    return data()?.config?.model ?? '';
  }

  function setModel(value) {
    ref.change((p) => { p.config.model = value; });
  }

  function isDisabled() {
    return submitting() || !prompt().trim();
  }

  function onModelChange(e) {
    setModel(e.currentTarget.value);
  }

  function onPromptInput(e) {
    setPrompt(e.currentTarget.value);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  async function handleSubmit() {
    const text = prompt().trim();
    if (!text || submitting()) return;

    abortController?.abort();
    abortController = new AbortController();
    const { signal } = abortController;

    setSubmitting(true);
    try {
      ref.change((panel) => {
        panel.runs.push({ prompt: text, output: [], done: false });
      });
      setPrompt('');

      const systemPrompt = await buildSystemPrompt(element.filesystem);

      await runLlmTurns({
        systemPrompt,
        getRuns: () => {
          const runs = ref.value().runs;
          return JSON.parse(JSON.stringify(runs));
        },
        mutatePanel: (fn) => ref.change(fn),
        getConfig: () => {
          const cfg = ref.value().config;
          return {
            apiUrl: cfg.apiUrl,
            model: cfg.model,
            apiKey: getApiKey(),
          };
        },
        element: frameRefView,
        signal,
      });
    } catch (err) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      ref.change((panel) => {
        const run = panel.runs[panel.runs.length - 1];
        if (run && !run.done) {
          run.output.push({ type: 'text', content: `[Error: ${msg}]` });
          run.done = true;
        }
      });
    } finally {
      setSubmitting(false);
    }
  }

  
  function handleStop() {
    if (abortController) {
      abortController.abort();
      abortController = null;
      setSubmitting(false);
      // Mark the last run as done
      ref.change((panel) => {
        const run = panel.runs[panel.runs.length - 1];
        if (run && !run.done) {
          run.output.push({ type: 'text', content: '*[Stopped by user]*' });
          run.done = true;
        }
      });
    }
  }

  function handleCopy() {
    const runs = getRuns();
    if (runs.length === 0) return;
    const text = runs.map((run) => formatRun(run)).join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
  }

  async function showPromptTab() {
    setTab('prompt');
    try {
      const text = await buildSystemPrompt(element.filesystem);
      setSystemPromptText(text);
    } catch (err) {
      setSystemPromptText(`Error building prompt: ${err?.message || err}`);
    }
  }

  const dispose = render(
    () =>
      html`<div class="llm-panel">
        <div class="llm-header">
          <button
            class=${() => tab() === 'chat' ? 'llm-tab-active' : 'llm-tab'}
            onClick=${() => setTab('chat')}
          >Chat</button>
          <button
            class=${() => tab() === 'prompt' ? 'llm-tab-active' : 'llm-tab'}
            onClick=${showPromptTab}
          >Prompt</button>
          <div class="llm-header-spacer" />
          <button
            class="llm-tab"
            onClick=${handleCopy}
            title="Copy chat to clipboard"
          >Copy</button>
          <select
            class="llm-model-select"
            onChange=${onModelChange}
            onPointerDown=${(e) => e.stopPropagation()}
          >
            ${MODELS.map((m) =>
              html`<option value=${m.id} selected=${m.id === getModel()}>${m.name}</option>`,
            )}
          </select>
        </div>
        ${() => tab() === 'chat'
          ? html`<div class="llm-body">
              ${() =>
                hasRuns()
                  ? html`<${For} each=${getRuns}>${(run) => renderRun(run)}<//>`
                  : html`<div class="llm-empty">Send a message to start.</div>`}
            </div>
            <div class="llm-compose">
              <textarea
                class="llm-textarea"
                placeholder="Message… (↵ to send, ⇧↵ for newline)"
                value=${prompt}
                onInput=${onPromptInput}
                onKeyDown=${onKeyDown}
                disabled=${submitting}
                rows=${3}
              />
              <div class="llm-compose-buttons">
                ${() => submitting()
                  ? html`<button
                      class="llm-stop"
                      type="button"
                      onClick=${handleStop}
                    >Stop</button>`
                  : null}
                <button
                  class="llm-send"
                  type="button"
                  onClick=${() => void handleSubmit()}
                  disabled=${isDisabled}
                >
                  ${() => submitting() ? 'Running…' : 'Send'}
                </button>
              </div>
            </div>`
          : html`<div class="llm-prompt-view">
              <pre class="llm-prompt-pre">${systemPromptText}</pre>
            </div>`}
      </div>`,
    element,
  );



  // Auto-scroll: only scroll to bottom if user is already near the bottom.
  // This avoids yanking the view away when the user has scrolled up to read.
  let userScrolledUp = false;
  const SCROLL_THRESHOLD = 40; // px from bottom to still count as "at bottom"

  function isNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD;
  }

  function onBodyScroll(e) {
    userScrolledUp = !isNearBottom(e.target);
  }

  const bodyObserver = new MutationObserver(() => {
    const body = element.querySelector('.llm-body');
    if (body && !userScrolledUp) {
      body.scrollTop = body.scrollHeight;
    }
  });

  function attachScrollListener(body) {
    if (!body) return;
    body.removeEventListener('scroll', onBodyScroll);
    body.addEventListener('scroll', onBodyScroll, { passive: true });
  }

  // Start observing once the DOM is ready
  requestAnimationFrame(() => {
    const body = element.querySelector('.llm-body');
    if (body) {
      body.scrollTop = body.scrollHeight;
      attachScrollListener(body);
      bodyObserver.observe(body, { childList: true, subtree: true, characterData: true });
    }
    // Also observe the panel itself in case .llm-body gets re-created (tab switch)
    const panel = element.querySelector('.llm-panel');
    if (panel) {
      const panelObserver = new MutationObserver(() => {
        const b = element.querySelector('.llm-body');
        if (b) {
          userScrolledUp = false; // reset on tab switch
          b.scrollTop = b.scrollHeight;
          attachScrollListener(b);
          bodyObserver.disconnect();
          bodyObserver.observe(b, { childList: true, subtree: true, characterData: true });
        }
      });
      panelObserver.observe(panel, { childList: true });
    }
  });

  return () => {
    abortController?.abort();
    bodyObserver.disconnect();
    const body = element.querySelector('.llm-body');
    if (body) body.removeEventListener('scroll', onBodyScroll);
    dispose();
  };
}

function rootRefView(host) {
  return host.parentElement?.closest('ref-view') ?? host;
}

function getApiKey() {
  return globalThis.VITE_OPENROUTER_API_KEY ?? '';
}

function formatRun(run) {
  const parts = [`**User:** ${run.prompt}`];
  for (const block of run.output ?? []) {
    if (block.type === 'text') {
      parts.push(block.content);
    } else if (block.type === 'script') {
      const header = block.description ? `script: ${block.description}` : 'script';
      parts.push(`\`\`\`js // ${header}\n${block.code}\n\`\`\``);
      if (block.error) parts.push(`> Error: ${block.error}`);
      else if (block.output) parts.push(`> ${block.output}`);
    }
  }
  return parts.join('\n\n');
}

function renderRun(run) {
  const getPrompt = () => run.prompt;
  const getOutput = () => run.output ?? [];

  return html`<div class="llm-run">
    <div class="llm-bubble-user">${getPrompt}</div>
    <${For} each=${getOutput}>${(block) => renderOutputBlock(block)}<//>
  </div>`;
}

function renderOutputBlock(block) {
  if (block.type === 'text') {
    const getHtml = () => {
      try {
        return marked.parse(block.content || '');
      } catch {
        return block.content || '';
      }
    };
    return html`<div class="llm-markdown" innerHTML=${getHtml} />`;
  }

  const getDescription = () => block.description || 'script';
  const getCode = () => block.code;
  const hasResult = () => block.output != null || block.error != null;

  return html`<div class="llm-script-block">
    <div class="llm-script-desc">${getDescription}</div>
    <pre class="llm-script-code">${getCode}</pre>
    ${() => hasResult() ? renderScriptResult(block) : null}
  </div>`;
}

const DATA_URL_REGEX = /data:image\/[a-zA-Z0-9+.-]+;base64,[a-zA-Z0-9+/=]+/g;

function renderScriptResult(block) {
  if (block.error) {
    return html`<pre class="llm-script-result llm-script-result-err">${() => `Error: ${block.error}`}</pre>`;
  }

  const output = block.output || '';
  const dataUrls = output.match(DATA_URL_REGEX);

  if (!dataUrls) {
    return html`<pre class="llm-script-result llm-script-result-ok">${output}</pre>`;
  }

  let textOutput = output;
  for (const url of dataUrls) {
    textOutput = textOutput.replace(url, '');
  }
  textOutput = textOutput.trim();

  return html`<div class="llm-script-result llm-script-result-ok">
    ${textOutput ? html`<pre style="margin:0">${textOutput}</pre>` : null}
    ${dataUrls.map((url) => html`<img class="llm-script-image" src=${url} />`)}
  </div>`;
}
