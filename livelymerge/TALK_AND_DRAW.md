# Talk & Draw: asking an AI with disappearing ink — Design

Working name. Status: design agreed 2026-11-03; M1 built the same day (`src/assist/`, mounted from `Livelymerge.tsx`). Console: `window.talkAndDraw.start()` / `.end()`, last message in `window.lastTalkAndDraw`. Decisions marked ✅,
deferred items marked ⏸, open questions marked ❓.

## 1. Goal

Let a user ask an AI to explain something or do something in a running Livelymerge (LM)
world by **talking and drawing** at the same time, with "disappearing ink" strokes that
disambiguate speech ("move *this* window over *here*"). The AI answers in the same medium:
it talks, draws with its own disappearing ink, shows bubbles, and acts on the UI with the
same raw mouse and keyboard events a human would produce, plus `eval` for inspecting and
changing the system.

Motivation: the Anthropic models' computer-use training lets them make sense of a
screenshot and decide where to click, drag, and type. We want that against *any* UI built
in LM — Dan's Morphic (`newdefs.js`), the Kit (`dandefs.js`), or something nobody has
built yet — without the UI author having to do anything.

## 2. Principles

1. ✅ **UI-independent.** Everything lives in the host (the LM tool), outside the LM heap
   and outside every defs file. A UI is not required to implement anything. Both
   existing UIs attach their listeners to the one shared canvas and render into it, and
   that is the only contract we rely on.
2. ✅ **Raw input, not semantic actions.** What a "click", "long press" (700 ms in
   newdefs), or "drag" means is the UI's business. The AI gets `mouse_move`,
   `mouse_down`, `mouse_up`, `scroll`, `key_down`, `key_up`, `wait`. The host only
   supplies *mouse physics* (interpolated moves over real time, button state on moves),
   which is not UI semantics.
3. ✅ **The model sees pictures; data is only the anchor.** Strokes are meaningful
   drawings. They reach the model as ink baked into screenshots; the stroke's id, time
   span and bounding box only tie a timeline marker to the picture.
4. ✅ **No freezing.** The UI keeps running under the session (animations, other users).
   Stale-screen risk is handled by per-stroke snapshots, a final composite, and a
   `screenshot` tool the agent can call any time.
5. ✅ **Symmetric channels, word-anchored timing.** The user's input is speech + ink on
   one clock. The AI's output is speech + ink + events + bubbles, with actions anchored
   to words of its own speech rather than absolute milliseconds.
6. ✅ **Let the model figure things out.** No `objectsUnder` hook for now (⏸ §11). The
   model combines the images with `eval` and source inspection to resolve what it is
   looking at. We decide whether a hook is needed after seeing how far that gets.

## 3. Architecture

```
Livelymerge.tsx (tool)
 ├─ <canvas>  ← window.canvas / window.ctx; the UI draws here, 1x (CSS px == canvas px)
 ├─ <canvas class=overlay>  ← ink (user + AI), AI cursor, bubbles; pointer-events only
 │                             while a session is active
 └─ src/assist/
     ├─ overlay.ts      ink layer + dissolve + AI cursor + bubbles (own rAF)
     ├─ session.ts      hotkey, mouse steal, audio recording, stroke log, snapshots
     ├─ snapshot.ts     composite (canvas pixels + strokes at full opacity), scaling
     ├─ transcribe.ts   Whisper via Transformers.js (M2)
     ├─ message.ts      builds the model message (timeline + images)
     ├─ executor.ts     runs the AI's script: events, pen, say, bubbles, eval (M3)
     ├─ agent.ts        model loop with tools (M4)
     └─ promptDrawer.tsx editable system prompt / "vibe" (M5)
```

Nothing in `src/assist/` touches `runtime.change`, proxies, or `$`-state. `eval` goes
through the existing `runtime.eval` / `printIt`. Keeping this outside the LM heap avoids
the GC-visibility and proxy pitfalls the frame-loop code warns about.

## 4. The user session

- ✅ **Start:** cmd-space (Spotlight owns it on a stock macOS, so this assumes Spotlight
  is rebound) or ctrl-space. cmd-option-tab was dropped. **End:** Esc, caught by a
  capture-phase `window` listener so the UI never sees it. Pressing the hotkey while the AI is
  performing cancels the performance (§8).
- ✅ **Mouse steal:** the overlay gets `pointer-events: auto` and pointer capture for the
  session. Mouse down + move draws; the UI beneath receives nothing. Keyboard: only Esc
  is meaningful during a session; other keys are ignored.
- ✅ **Audio:** `getUserMedia` + `MediaRecorder`, chunks kept in memory. `t0 =
  performance.now()` at `recorder.onstart`; stroke times are relative to `t0`; Whisper
  timestamps are relative to audio start, which is the same instant to within recorder
  latency (fine at word granularity).
- ✅ **Ink:** pointerdown starts a stroke, pointermove appends `{x, y, t}`, pointerup
  ends it. Rendered smoothed (quadratic through midpoints), ~3.5 px, bright purple, on
  the overlay above everything. **Dissolve:** 2 s after pointerup, fade over ~0.75 s.
  The timer starts at pointerup, never mid-stroke.
- ✅ **Snapshots, rendered from stroke data, never from the overlay:**
  - at session start: the bare canvas;
  - at each stroke end: canvas pixels + *all* session strokes so far at full opacity,
    drawn slightly thicker than on screen and labelled with the stroke number;
  - at Esc: the final composite with every stroke.
  The on-screen dissolve can therefore never leak into what the model sees. Per-stroke
  snapshots answer "what was under this stroke when it was drawn"; the final composite
  is where multi-stroke figures (arrows, X's, little diagrams) are read as a whole.
- ✅ Capture happens synchronously in the overlay's pointerup handler, i.e. between the
  UI's frames, so the canvas always holds a complete frame. The DOM above the canvas
  (workspace drawer, doc stats) is not captured; that is tool chrome, not UI content.

## 5. Coordinates and image size

- The LM canvas is 1x: canvas pixels == CSS pixels == pointer-event coordinates.
- ✅ Images sent to the model are the canvas scaled by one factor `s ≤ 1` so the long
  edge stays under the API's resize threshold (~1568 px), aspect ratio preserved. One
  `s` per session; recomputed only if the canvas resizes (the user controls the aspect
  ratio).
- ✅ The message header states canvas width/height, image width/height and `s`.
- ✅ **The model answers in image coordinates everywhere** — events, pen strokes,
  bubbles. The host divides by `s`.

## 6. The message

```
Canvas 1440x900, images 1280x800 (scale 0.889). Session started 14:02:11.
Timeline (seconds from session start):
[0.00] move [0.31] this
[stroke 1, 0.25–0.90, bbox (412,230)-(610,380)]   → image "after stroke 1"
[1.10] over [1.30] here
[stroke 2, 1.40–1.75, bbox (896,492)-(912,508)]   → image "after stroke 2"
--- end of session at 2.4s ---                     → image "final"
```

- Words with timestamps (from Whisper, word-level) interleaved with stroke markers by
  time. Stroke markers carry id, time span, bbox; nothing about shape — the image does
  that.
- Images: start, one per stroke end, final composite. Two to five images per request
  is cheap.
- Raw stroke points are not in the message; ⏸ a `stroke_points(id)` tool can expose
  them later if the model wants precision.
- **M1 deliverable:** this exact structure logged to the JS console (text + the images
  as data URLs / `console.log('%c', 'background:url(...)')` thumbnails), with a stubbed
  transcript and the recorded audio duration.

## 7. Transcription (M2) — built

- ✅ Transformers.js (v4) running Whisper, `return_timestamps: 'word'`, run **after Esc**
  on the whole recording. Model: `onnx-community/whisper-base.en_timestamped` — word
  timestamps need the `_timestamped` exports (cross-attentions); the plain exports
  throw. Base's timing is noticeably better than tiny's.
- ✅ Verified 2026-11-03 in node and in the browser (`src/assist/transcribe.ts`):
  WebGPU with wasm fallback; first load ≈30 s (model download, cached afterwards),
  then ≈2 s to transcribe 5 s of speech. The model starts loading at session start so
  it is usually ready by Esc; the badge shows progress.
- ✅ The library is loaded from jsDelivr at runtime, not bundled: bundling emitted a
  26 MB ONNX wasm into `dist` (pushwork would push it into the document) and its
  onnxruntime-node postinstall broke `pnpm install`. Model files come from
  huggingface.co either way.
- ❓ Not yet verified inside Patchwork itself: that its page lets the tool import from
  jsDelivr and fetch from huggingface.co, and that the mic prompt appears.
- Fallbacks if Patchwork fights it: Web Speech API in Chrome (phrase-level
  timestamps), a local whisper server over `fetch`.

## 8. The AI's channels (tools) — M3 built

All coordinates in image space. The response is **one `perform(script)` call**: an
ordered list of steps; a `say` step runs its anchored sub-steps concurrently; the host
executes, paces raw events across the UI's 30 Hz frames, then returns one result per
step plus a screenshot. One model call does a whole gesture, which also amortizes
latency. The executor is cancelable (user hotkey, or `cancel()`): speech stops, any
held mouse button is released, remaining steps are skipped.

Implementation: `src/assist/executor.ts` (steps), `pen.ts` (shapes, wobble, animation),
`events.ts` (synthetic input + mouse physics), `say.ts` (anchors + speechSynthesis),
`overlay.ts` (AI ink, cursor, bubbles). From the console:
`talkAndDraw.perform(script, { scale?, penStyle? })`, `talkAndDraw.cancel()`.
✅ Verified 2026-11-03 in a scratch page with a fake canvas UI: a synthetic drag moved
its box (offsetX/Y correct, ~50 pointermoves over 700 ms), typed keys carried shift
and charCode, eval errors came back as step results, cancel released the button.

```js
talkAndDraw.perform([
  { type: 'say', text: "I'll move {s1}this window{/} over {p2}here{/}.", bubble: true,
    anchors: { s1: [{ type: 'pen', shape: 'circle', center: {x: 380, y: 250}, r: 95, style: 'hand-drawn' }],
               p2: [{ type: 'pen', shape: 'circle', center: {x: 700, y: 450}, r: 10 }] } },
  { type: 'pen', shape: 'arrow', from: {x: 480, y: 300}, to: {x: 660, y: 420} },
  { type: 'mouse_move', x: 380, y: 250 }, { type: 'mouse_down' },
  { type: 'mouse_move', x: 700, y: 450, duration: 700 }, { type: 'mouse_up' },
  { type: 'thought_bubble', text: 'Done.', at: {x: 700, y: 450} },
  { type: 'eval', source: '6 * 7' },
])
```

**Raw events** (vocabulary mirrors Anthropic's computer-use tool so it matches training):
- `mouse_move {x, y, duration?}` — interpolated `pointermove`s over real time (never
  teleport; default ~1500 px/s, eased); moves while a button is held carry `buttons`.
- `mouse_down {button?}`, `mouse_up {button?}`, `scroll {dx, dy, x?, y?}` (wheel event),
  `key_down {key, code?, modifiers?}`, `key_up`, `type {text}` (per-char
  keydown/keypress/keyup — still raw), `wait {ms}`.
- Dispatched on the LM canvas as `PointerEvent` / `KeyboardEvent` / `WheelEvent` with
  `pointerId` 7777 and real `clientX/Y` (both UIs read `offsetX/Y`, which the browser
  derives from those). Gotchas: `isTrusted` is false; `setPointerCapture` on a
  synthetic event may throw (the Kit guards it, newdefs doesn't call it); the canvas is
  focused before key events.
- The host tracks the virtual mouse (position, buttons) and draws a **visible AI
  cursor** on the overlay (orange arrow with an "AI" tag, a ring while a button is
  down); it fades 1.5 s after the performance ends.

**Pen** (`{type: 'pen', shape, duration?, style?, linger?}`; our overlay, so shape
primitives are fair game):
- `polyline {points}`, `circle {center, r}`, `arrow {from, to}` (shaft + head, two
  strokes), `box {x0, y0, x1, y1}`, `underline {from, to}`. Default pace 400 px/s with a
  300 ms floor, so the model may omit timing. Strokes animate — gestures, not stamps.
- `style: 'crisp' | 'hand-drawn'` (low-frequency wobble + jitter, circles overshoot
  ~6% and breathe in radius). Orange, distinct from the user's purple. Same dissolve
  rule (2 s linger then fade; `linger` overrides per stroke).

**Say** (`{type: 'say', text, anchors?, bubble?, rate?}`): browser `speechSynthesis`
for now, word boundary events drive the anchors; when a voice gives no boundaries an
estimate (15 chars/s) paces them. ElevenLabs with character timestamps later.
`bubble: true` shows the text as a speech bubble while speaking (dissolves 2 s after).

**Word anchors:** `"I'll move {s1}this window{/} over {p2}here{/}."` — `anchors.s1`
runs when the TTS reaches "this"; a pen stroke inside with no duration is stretched to
the span's estimated length. `{id}` without `{/}` marks the single next word.

**Bubbles:** `speech_bubble` / `thought_bubble {text, at?, id?, hold?, duration?}`,
anchored to `at`, else the AI cursor. Auto-dismiss after ~60 ms/char + 2 s unless
`hold`; `dismiss {id}` removes one.

**Eval / inspect:** `eval {source}` via `runtime.printIt`, returning the printed result
or the error as the step's result. Note every eval writes to all peers; ⏸ reuse the pwm
bridge's arm/disarm gating.

**Screenshot:** `screenshot` returns the current composite (canvas + live ink of both
colors) as a data URL; every `perform` also returns one at the end.

## 9. Agent loop (M4) — built

`src/assist/agent.ts` + `prompt.ts`. At Esc, after transcription, the session's message
becomes the first user turn — header, transcript, timeline, then every snapshot as a
labelled image block — and goes to Claude through the official SDK, called directly from
the browser (`dangerouslyAllowBrowser`). Tools: `perform` (the M3 script, one call per
choreographed turn), `screenshot`, `eval`. Each `perform` returns per-step results plus
the screenshot taken after its last step; the loop runs until the model stops calling
tools (max 12 turns). Closing text is spoken with a bubble; a refusal is spoken too.
The hotkey cancels the loop and the current performance.

- ✅ Model: `claude-opus-5-5` by default (`effort: medium` for latency), with the
  server-side refusal fallback chain enabled (`fallbacks: "default"`; not for Haiku).
  Pick another in the drawer or `talkAndDraw.setModel(...)` (stored per browser).
- ✅ API key: asked for with a prompt the first time it is needed (the first Esc), kept
  in `localStorage` for this origin, never in the document. A rejected key is cleared
  automatically; `talkAndDraw.clearApiKey()` clears it by hand.
- ✅ `talkAndDraw.agentEnabled = false` goes back to logging only; `talkAndDraw.ask()`
  re-sends the last session; the agent's turns, tool calls and evals are logged in a
  console group.
- ❓ Not yet verified against a live model from inside Patchwork.

## 10. The drawer (M5, first cut) — built

`src/assist/ui.ts`. The Talk & Draw badge (bottom right, DOM, always visible; purple
pulse while listening, orange while the model thinks or performs) opens a drawer on the
right third of the tool at full height:
- **Model** picker: Haiku 5.5, Sonnet 5.5, Opus 5.5 (default), Fable 5.1. Stored per browser.
- **API key**: status, Set… (prompt), Clear.
- **System prompt**: the whole prompt, editable; saved per browser as you type, with
  Restore default. It frames the response as a performance (point, then talk, then act)
  and ends with a "vibe" paragraph — hand-drawn and conversational by default; edit it for
  a flat "computer voice" instead.
- **Transcript**: what went to the model (header, transcript, timeline, snapshot
  thumbnails) and what came back (text, tool calls with their inputs, results with
  screenshots, evals, errors, token counts). The console group stays as well.
- Header buttons: Re-send last, Cancel. `talkAndDraw.drawer(true|false)` from the console.
- ❓ Storing the prompt in the document (shared) rather than per browser is still open.

## 11. Shared notes — built

`src/assist/notes.ts`. Agents keep a manual of THIS document's UI in a persistent LM
global, `aiNotes`: an array of `{topic, text, author, when}` objects (separate objects
so concurrent users' additions merge; one big string would be a single Automerge op and
overwrite). The host reads it through the runtime's transpiling eval at the start of
every run and puts it in the first user turn — no tool call spent — and the model gets
`remember(topic, text)` (upsert by topic) and `forget(topic)`. The prompt tells it to
record how the UI works (gestures, handles, classes, globals), never task facts or screen
positions, and to fix notes that turn out wrong. The drawer shows the notes with a × to
prune, and "Max turns" (default 24, per browser) replaces the fixed 12. A UI can seed the
manual by defining `aiNotes` itself; knowledge is per document, since each document
carries its own defs.

## 12. Deferred and open

- ⏸ `objectsUnder(points)` hook returning `{ref, description}` pairs (`ref` = an
  expression the model can `eval`). Decide after seeing how the model does without it.
- ⏸ Peers don't see the ink, the AI cursor or bubbles (local overlay). Later: broadcast
  via the lm-eph channel; the AI could literally be a peer hand.
- ⏸ Persisting sessions/transcripts in the doc.
- ⏸ Interrupting the AI mid-performance with a new spoken request.
- ❓ Whisper inside Patchwork's page (CDN import, huggingface.co fetch, mic prompt) — §7.

## 13. Milestones

1. **M1 — record & show.** ✅ Overlay, hotkey, mouse steal, ink + dissolve, audio
   recording, per-stroke/final snapshots, timeline logged to the console with a stubbed
   transcript.
2. **M2 — transcript.** ✅ Whisper; real word-timestamped transcript in the timeline.
3. **M3 — executor.** ✅ Pen primitives, `say` (speechSynthesis first), bubbles, raw
   events with mouse physics and the AI cursor, word anchors. Driven by hand-written
   scripts from the console, no model yet.
4. **M4 — agent.** ✅ Model call with the tools, `perform` scripts, screenshot loop, key
   handling.
5. **M5 — polish.** ✅ Drawer (model, key, prompt, transcript). Still to do: ElevenLabs, eval gating.
