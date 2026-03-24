import { from, render, html, For, createSignal } from '../solid.js';
import { buildSystemPrompt } from './system-prompt.js';
import { runLlmTurns } from './process.js';
import { schema } from './schema.js';

export { schema };

export default function mount(element) {
  const frameRefView = rootRefView(element);
  if (!frameRefView) {
    const pre = document.createElement('pre');
    pre.textContent = 'llm panel: could not resolve frame ref-view';
    element.appendChild(pre);
    return () => pre.remove();
  }

  const ref = element.ref.as(schema);
  const data = from(ref);
  const [prompt, setPrompt] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  let abortController = null;

  function getRuns() {
    return data()?.runs ?? [];
  }

  function hasRuns() {
    return getRuns().length > 0;
  }

  function getApiUrl() {
    return data()?.config?.apiUrl ?? '';
  }

  function getModel() {
    return data()?.config?.model ?? '';
  }

  function setApiUrl(value) {
    ref.change((p) => { p.config.apiUrl = value; });
  }

  function setModel(value) {
    ref.change((p) => { p.config.model = value; });
  }

  function isDisabled() {
    return submitting() || !prompt().trim();
  }

  function buttonLabel() {
    return submitting() ? 'Running…' : 'Send';
  }

  function buttonCursor() {
    return submitting() ? 'wait' : 'pointer';
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
        filesystem: element.filesystem,
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

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function onApiUrlInput(e) {
    setApiUrl(e.currentTarget.value);
  }

  function onModelInput(e) {
    setModel(e.currentTarget.value);
  }

  function onPromptInput(e) {
    setPrompt(e.currentTarget.value);
  }

  const dispose = render(
    () =>
      html`<div
        style=${{
          display: 'flex',
          'flex-direction': 'column',
          width: '100%',
          height: '100%',
          background: '#fafafa',
          'border-radius': '6px',
          'box-shadow': '0 1px 6px rgba(0,0,0,0.14)',
          overflow: 'hidden',
          'box-sizing': 'border-box',
        }}
      >
        <div
          style=${{
            height: '32px',
            'flex-shrink': '0',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '0 8px',
            background: 'rgba(0,0,0,0.04)',
            'border-bottom': '1px solid rgba(0,0,0,0.1)',
          }}
        >
          <span style=${{ font: '12px/1 system-ui, sans-serif', color: '#333', 'font-weight': '600' }}>LLM</span>
        </div>
        <div
          style=${{
            flex: '1',
            'min-height': '0',
            overflow: 'auto',
            padding: '8px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '10px',
          }}
        >
          ${() =>
            hasRuns()
              ? html`<${For} each=${getRuns}>${(run) => renderRun(run)}<//>`
              : html`<div style=${{ font: '12px system-ui', color: '#71717a' }}>Send a message to start.</div>`}
        </div>
        <div
          style=${{
            padding: '8px',
            'border-top': '1px solid rgba(0,0,0,0.08)',
            display: 'flex',
            'flex-direction': 'column',
            gap: '6px',
            'flex-shrink': '0',
          }}
        >
          <div style=${{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <label style=${{ display: 'flex', 'flex-direction': 'column', gap: '2px', flex: '1', 'min-width': '120px' }}>
              <span style=${{ font: '10px', color: '#71717a' }}>API URL</span>
              <input
                type="text"
                value=${getApiUrl}
                onInput=${onApiUrlInput}
                style=${{ font: '11px', padding: '4px', width: '100%', 'box-sizing': 'border-box' }}
              />
            </label>
            <label style=${{ display: 'flex', 'flex-direction': 'column', gap: '2px', width: '120px' }}>
              <span style=${{ font: '10px', color: '#71717a' }}>Model</span>
              <input
                type="text"
                value=${getModel}
                onInput=${onModelInput}
                style=${{ font: '11px', padding: '4px', width: '100%', 'box-sizing': 'border-box' }}
              />
            </label>
          </div>
          <textarea
            placeholder="Message… (⌘↵ to send)"
            value=${prompt}
            onInput=${onPromptInput}
            onKeyDown=${onKeyDown}
            disabled=${submitting}
            rows=${3}
            style=${{
              width: '100%',
              'box-sizing': 'border-box',
              resize: 'vertical',
              font: '12px system-ui',
              padding: '6px',
            }}
          />
          <button
            type="button"
            onClick=${(e) => void handleSubmit()}
            disabled=${isDisabled}
            style=${() => ({
              padding: '6px 12px',
              font: '12px system-ui',
              cursor: buttonCursor(),
              'align-self': 'flex-end',
            })}
          >
            ${buttonLabel}
          </button>
        </div>
      </div>`,
    element,
  );

  return () => {
    abortController?.abort();
    dispose();
  };
}

function rootRefView(host) {
  let current = host;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function getApiKey() {
  return globalThis.VITE_OPENROUTER_API_KEY ?? '';
}

function renderRun(run) {
  const getPrompt = () => run.prompt;
  const getOutput = () => run.output ?? [];

  return html`<div style=${{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
    <div
      style=${{
        'align-self': 'flex-end',
        'max-width': '95%',
        padding: '6px 8px',
        background: '#e0e7ff',
        'border-radius': '8px',
        font: '12px/1.4 system-ui, sans-serif',
        'white-space': 'pre-wrap',
        'word-break': 'break-word',
      }}
    >
      ${getPrompt}
    </div>
    <${For} each=${getOutput}>${(block) => renderOutputBlock(block)}<//>
  </div>`;
}

function renderOutputBlock(block) {
  if (block.type === 'text') {
    const getContent = () => block.content;
    return html`<div
      style=${{
        font: '12px/1.4 system-ui, sans-serif',
        'white-space': 'pre-wrap',
        'word-break': 'break-word',
      }}
    >
      ${getContent}
    </div>`;
  }

  const getDescription = () => block.description || 'script';
  const getCode = () => block.code;
  const hasResult = () => block.output != null || block.error != null;
  const resultBackground = () => block.error ? '#fef2f2' : '#f0fdf4';
  const resultText = () =>
    block.error ? `Error: ${block.error}` : block.output || '';

  return html`<div
    style=${{
      font: '11px/1.4 ui-monospace, monospace',
      background: '#fff',
      border: '1px solid #e4e4e7',
      'border-radius': '6px',
      padding: '6px',
    }}
  >
    <div style=${{ color: '#52525b', 'margin-bottom': '4px' }}>
      ${getDescription}
    </div>
    <pre style=${{ margin: '0', overflow: 'auto' }}>${getCode}</pre>
    ${() =>
      hasResult()
        ? html`<pre
            style=${() => ({
              margin: '6px 0 0',
              padding: '6px',
              background: resultBackground(),
              'border-radius': '4px',
            })}
          >${resultText}</pre>`
        : null}
  </div>`;
}
