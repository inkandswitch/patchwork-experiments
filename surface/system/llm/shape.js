import { z } from 'https://esm.sh/zod@4.3';
import { from, render, html, For, createSignal } from '../solid.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { runLlmTurns } from './process.js';

const OutputBlockSchema = z.union([
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('script'),
    code: z.string(),
    description: z.string().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
]);

const RunSchema = z.object({
  prompt: z.string(),
  output: z.array(OutputBlockSchema),
  done: z.boolean().optional(),
});

const LlmContentSchema = z.object({
  config: z.object({
    apiUrl: z.string(),
    model: z.string(),
  }),
  runs: z.array(RunSchema),
});

export const schema = {
  init() {
    return {
      config: {
        apiUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-4o-mini',
      },
      runs: [],
    };
  },
  parse(value) {
    const v =
      typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    return LlmContentSchema.parse({
      config: {
        apiUrl: typeof v.config?.apiUrl === 'string' ? v.config.apiUrl : 'https://openrouter.ai/api/v1',
        model: typeof v.config?.model === 'string' ? v.config.model : 'openai/gpt-4o-mini',
      },
      runs: Array.isArray(v.runs) ? v.runs : [],
    });
  },
};

function rootRefView(host) {
  let current = host;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function getApiKey() {
  if (typeof window === 'undefined') return '';
  return window.__PAPER_LLM_API_KEY__ ?? '';
}

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

      await runLlmTurns({
        systemPrompt: SYSTEM_PROMPT,
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
        canvasElement: frameRefView,
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
            (data()?.runs?.length ?? 0) > 0
              ? html`<${For} each=${() => data()?.runs ?? []}>${(run) =>
                  html`<div style=${{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
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
                      ${() => run.prompt}
                    </div>
                    <${For} each=${() => run.output ?? []}>${(block) =>
                      html`${() =>
                        block.type === 'text'
                          ? html`<div
                              style=${{
                                font: '12px/1.4 system-ui, sans-serif',
                                'white-space': 'pre-wrap',
                                'word-break': 'break-word',
                              }}
                            >
                              ${() => block.content}
                            </div>`
                          : html`<div
                              style=${() => ({
                                font: '11px/1.4 ui-monospace, monospace',
                                background: '#fff',
                                border: '1px solid #e4e4e7',
                                'border-radius': '6px',
                                padding: '6px',
                              })}
                            >
                              <div style=${{ color: '#52525b', 'margin-bottom': '4px' }}>
                                ${() => block.description || 'script'}
                              </div>
                              <pre style=${{ margin: '0', overflow: 'auto' }}>${() => block.code}</pre>
                              ${() =>
                                block.output != null || block.error != null
                                  ? html`<pre
                                      style=${() => ({
                                        margin: '6px 0 0',
                                        padding: '6px',
                                        background: block.error ? '#fef2f2' : '#f0fdf4',
                                        'border-radius': '4px',
                                      })}
                                    >${() =>
                                      block.error ? `Error: ${block.error}` : block.output || ''}</pre>`
                                  : null}
                            </div>`
                      }`
                    }</>
                  </div>`
                }</>`
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
                value=${() => data()?.config?.apiUrl ?? ''}
                onInput=${(e) => {
                  const v = e.currentTarget.value;
                  ref.change((p) => {
                    p.config.apiUrl = v;
                  });
                }}
                style=${{ font: '11px', padding: '4px', width: '100%', 'box-sizing': 'border-box' }}
              />
            </label>
            <label style=${{ display: 'flex', 'flex-direction': 'column', gap: '2px', width: '120px' }}>
              <span style=${{ font: '10px', color: '#71717a' }}>Model</span>
              <input
                type="text"
                value=${() => data()?.config?.model ?? ''}
                onInput=${(e) => {
                  const v = e.currentTarget.value;
                  ref.change((p) => {
                    p.config.model = v;
                  });
                }}
                style=${{ font: '11px', padding: '4px', width: '100%', 'box-sizing': 'border-box' }}
              />
            </label>
          </div>
          <textarea
            placeholder="Message… (⌘↵ to send)"
            value=${prompt}
            onInput=${(e) => setPrompt(e.currentTarget.value)}
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
            onClick=${() => void handleSubmit()}
            disabled=${() => submitting() || !prompt().trim()}
            style=${{
              padding: '6px 12px',
              font: '12px system-ui',
              cursor: submitting() ? 'wait' : 'pointer',
              'align-self': 'flex-end',
            }}
          >
            ${() => (submitting() ? 'Running…' : 'Send')}
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
