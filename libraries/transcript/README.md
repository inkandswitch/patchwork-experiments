# @chee/patchwork-transcript

A speech-to-text toolkit for Patchwork tools, extracted from `chat`
(chitterchatter's voice-note transcription). Same provider pattern as
[`@chee/patchwork-llm`](../llm): one config on the account doc, resolvable
per-DOM-subtree, with the engine swappable behind it.

It gives you:

- **`transcribe(audio)`** — turn a `Blob` / `ArrayBuffer` / 16 kHz `Float32Array`
  into text using the active provider.
- **Two providers**, chosen by config:
  - **`local`** — in-browser ASR via transformers.js (Moonshine / Whisper ONNX)
    in a dedicated `Worker`, **WebGPU with a WASM fallback**. transformers.js is
    imported from a CDN inside the worker, only when this provider is used.
  - **`openai`** — a multipart POST to any OpenAI-compatible
    `/v1/audio/transcriptions` endpoint (OpenAI Whisper, Groq, a local
    whisper.cpp server, …).
- **`transcribeDoc(url)`** — transcribe the audio a recording/file doc points
  at and **cache the transcript back onto the doc** (so it syncs to peers and is
  read back instantly). This is what chat's voice notes use.
- **`createTranscriptionStream({ track })`** — real-time transcription off a live
  microphone track: Silero VAD segments speech and emits **interim + final**
  transcripts as the user talks. This is what `call`'s live meeting transcript
  uses.
- **`<patchwork-transcript-config-provider>`** — scope a different engine to one
  tool/view.

Plain vanilla JS, no build step. Its only npm dependency is
`@inkandswitch/patchwork-providers` (the request/provide config plumbing).

## Install / consume

The package lives at `libraries/transcript` and is named
`@chee/patchwork-transcript`.

- **Bundled tools (vite):** add a resolve alias and the bundler inlines it,
  worker included (vite understands `new URL("./worker.js", import.meta.url)`):

  ```js
  // vite.config.js
  resolve: {
    alias: {
      "@chee/patchwork-transcript": fileURLToPath(
        new URL("../libraries/transcript/index.js", import.meta.url)
      ),
    },
  }
  ```

  …or consume the published copy the same way chat consumes `@chee/patchwork-llm`
  — via the `@chee/patchwork-bundles` vite plugin and an `automerge:`-URL
  dependency, so every tool shares one worker.

- **Bundleless tools:** import by relative path, or add the package to the host
  importmap to share one copy across tools.

## Usage

```js
import { transcribe, transcribeDoc, onStatus } from "@chee/patchwork-transcript"

// raw audio → text
const text = await transcribe(voiceBlob, {
  onStatus: (m) => setStatus(m),   // "Loading transcription model (WebGPU)…"
  signal,                          // AbortSignal
})

// a recording doc { audio: <fileDocUrl> } → text, cached onto d.transcription
const text = await transcribeDoc(recordingUrl, {
  onResult: (t) => showCaption(t),
})

// already-decoded PCM (e.g. from the Web Audio API) works too
const text = await transcribe(float32PcmAt16k)
```

### Real-time (streaming) transcription

```js
import { createTranscriptionStream } from "@chee/patchwork-transcript"

const session = await createTranscriptionStream({
  track: localStream.getAudioTracks()[0], // library reads + resamples frames
  onStatus:      (m) => setStatus(m),
  onSpeechStart: () => beginUtterance(),
  onInterim:     (text) => showInterim(text),   // fires ~1×/s while talking
  onFinal:       (text) => commit(text),        // fires on each silence
  onSpeechEnd:   () => clearInterim(),
})
session.setEnabled(false)  // mute (drops frames, keeps the model warm)
session.close()            // tear down worker + track reader

// no track? drive it yourself with 16 kHz mono PCM:
session.push(float32At16k)
```

### Config (on the account doc)

Everything lives under `accountDoc.transcript` (a pointer to a settings doc):

```js
{
  provider: "local" | "openai",
  local:  { model: "onnx-community/moonshine-base-ONNX", dtype: null },
  openai: { apiKey, model: "whisper-1", baseUrl: "https://api.openai.com/v1" },
}
```

`readConfig()` / `writeConfig(patch)` read/write it (defaulting missing fields).
`dtype: null` lets the worker pick per-device (q4 decoder on WebGPU, q8 on WASM).

### Scope a different engine to one view

```html
<patchwork-transcript-config-provider provider="openai" model="whisper-1">
  <patchwork-view><!-- a tool using @chee/patchwork-transcript --></patchwork-view>
</patchwork-transcript-config-provider>
```

A consumer that resolves config via `subscribeConfig(element, …)` picks this up;
with no provider in the subtree it falls back to the account doc.

## Worker protocol

`worker.js` (the `local` provider) speaks:

| direction | message |
|-----------|---------|
| in  | `{ type: "preload", model, dtype? }` |
| in  | `{ type: "transcribe", id, audio: Float32Array, model, dtype? }` |
| out | `{ type: "ready", model }` |
| out | `{ type: "status", message }` |
| out | `{ type: "result", id, text }` |
| out | `{ type: "error", id?, message }` |

One transcriber is cached per model id; switching `model` loads the new one.
