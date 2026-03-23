---
name: llm
description: In-canvas assistant panel—API settings, chat runs, and structured output blocks including executable scripts.
---

# LLM

This shape stores **panel state**: where to send chat requests, model id, and an append-only list of **runs** (prompt plus streamed output blocks). The UI streams completions, parses mixed text and script segments from the stream, and can execute scripts in a controlled environment described in `system-prompt.js`.

## Types

The whole panel is one ref validated as `LlmContentSchema`:

```ts
type LlmOutputText = { type: 'text'; content: string };

type LlmOutputScript = {
  type: 'script';
  code: string;
  description?: string;
  output?: string;
  error?: string;
};

type LlmOutputBlock = LlmOutputText | LlmOutputScript;

type LlmRun = {
  prompt: string;
  output: LlmOutputBlock[];
  done?: boolean;
};

type LlmPanel = {
  config: {
    apiUrl: string;
    model: string;
  };
  runs: LlmRun[];
};
```

Runtime parsing lives in Zod in `shape.js` (`LlmContentSchema` and nested unions); `parse` fills defaults for `config` when fields are missing.

## Programmatic usage

Append a run shell (the UI normally fills `output` while streaming):

```js
// `ref` is the panel shape ref (after the llm `ref-view` is mounted):
ref.change((panel) => {
  panel.runs.push({ prompt: 'Summarize', output: [], done: false });
});
```

Update config:

```js
ref.change((panel) => {
  panel.config.model = 'vendor/model-id';
  panel.config.apiUrl = 'https://api.example.com/v1';
});
```

Empty template (`schema.init()` from `shape.js`):

```js
const empty = {
  config: {
    apiUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  runs: [],
};
```

## Model of the code

- **`shape.js`** — Schemas, Solid UI, entry into the multi-turn runner.
- **`process.js`** — HTTP streaming, turn loop, script sandbox wiring (must match what the system prompt documents).
- **`parser.js`** — Incremental parse of streamed markup into text vs script segments.
- **`system-prompt.js`** — Static instructions and the advertised script API surface.

## Examples

- **Default model or base URL:** Change `init()` defaults and `parse` fallbacks together so existing documents still load.
- **New output block kind:** Extend `OutputBlockSchema` and every place that renders or executes runs; prefer backward-compatible `parse` for stored runs.

## Guidelines

- Do not document script globals in `system-prompt.js` that `process.js` does not inject.
- Preserve abort handling and error recording on runs so failed streams do not run unbounded retries.
- If you change the HTTP client (auth, URL shape, stream format), update it in one place and re-check any docs that describe the same contract.
