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

## 8. The AI's channels (tools)

All coordinates in image space. The response is **one `perform(script)` call**: an
ordered list of steps; a `say` step runs its anchored sub-steps concurrently; the host
executes, paces raw events across the UI's 30 Hz frames, then returns one screenshot
plus any errors. One model call does a whole gesture, which also amortizes latency.
The executor is cancelable (user hotkey).

**Raw events** (vocabulary mirrors Anthropic's computer-use tool so it matches training):
- `mouse_move(x, y, duration?)` — interpolated `pointermove`s over real time (never
  teleport); moves while a button is held carry `buttons`.
- `mouse_down(button)`, `mouse_up(button)`, `scroll(x, y, dx, dy)` (wheel event),
  `key_down(key, modifiers)`, `key_up(key, modifiers)`, `type(text)` (per-char
  keydown/keypress/keyup — still raw), `wait(ms)`.
- Dispatched on the LM canvas as `PointerEvent` / `KeyboardEvent` / `WheelEvent` with a
  dedicated `pointerId`. Gotchas: `isTrusted` is false; `setPointerCapture` on a
  synthetic event may throw (the Kit guards it, newdefs doesn't call it); focus the
  canvas before key events.
- The host tracks the virtual mouse (position, buttons) and draws a **visible AI
  cursor** on the overlay at all times.

**Pen** (our overlay, so shape primitives are fair game):
- `polyline(points, duration?)`, `circle(center, r)`, `arrow(from, to)`, `box`,
  `underline`. Default pace ~400 px/s with a minimum of a few hundred ms, so the model
  may omit timing. Strokes animate over their duration — they are gestures, not stamps.
- `style: 'crisp' | 'hand-drawn'` (jitter + wobble applied by the host). Distinct color
  from the user's ink. Same dissolve rule (2 s linger, configurable per stroke).

**Say:** ElevenLabs (with character timestamps) for quality; browser `speechSynthesis`
with `onboundary` word events as the zero-setup fallback (M3 starts here).

**Word anchors:** the model's speech carries inline markers referencing other steps,
e.g. `"I'll move {s1}this window{/} over {p2}here{/}."` — the host fires `s1`/`p2`
when the TTS reaches those words and stretches a stroke to the word span when it has
no duration. Absolute `wait`/`duration` remain for things not tied to speech.

**Bubbles:** `speech_bubble(text, at?)`, `thought_bubble(text, at?)`, anchored to the
AI cursor by default. Lifetime: while the matching speech plays, then dissolve after
2 s. `hold: true` keeps one up (e.g. waiting on the user) until `dismiss(id)`.

**Eval / inspect:** `eval(source)` via `runtime.eval`, returning the printed result or
the error. Source reading through the existing class/method introspection. Note every
eval writes to all peers; ⏸ reuse the pwm bridge's arm/disarm gating.

**Screenshot:** `screenshot()` returns the current composite (canvas + live ink).

## 9. Agent loop (M4)

message → model → `perform` → screenshot + results → … until the model stops. Key
handling: `editable-llm-chat` bakes a key in at build time; we need something better
(a field in the drawer, stored locally, never in the doc).

## 10. Vibe / system prompt (M5)

The system prompt frames the response as a **performance**: point, then talk, then act.
It sets the agent's "vibe" — e.g. hand-drawn wobbly ink and a conversational voice for a
human-collaborator feel, or crisp ink and a flat voice for a clear "computer voice". The
prompt is editable in a pull-out drawer like the Workspace drawer; ❓ stored per document
(shared, in the Automerge doc) or per user.

## 11. Deferred and open

- ⏸ `objectsUnder(points)` hook returning `{ref, description}` pairs (`ref` = an
  expression the model can `eval`). Decide after seeing how the model does without it.
- ⏸ Peers don't see the ink, the AI cursor or bubbles (local overlay). Later: broadcast
  via the lm-eph channel; the AI could literally be a peer hand.
- ⏸ Persisting sessions/transcripts in the doc.
- ⏸ Interrupting the AI mid-performance with a new spoken request.
- ❓ Whisper inside Patchwork's page (CDN import, huggingface.co fetch, mic prompt) — §7.

## 12. Milestones

1. **M1 — record & show.** ✅ Overlay, hotkey, mouse steal, ink + dissolve, audio
   recording, per-stroke/final snapshots, timeline logged to the console with a stubbed
   transcript.
2. **M2 — transcript.** ✅ Whisper; real word-timestamped transcript in the timeline.
3. **M3 — executor.** Pen primitives, `say` (speechSynthesis first), bubbles, raw events
   with mouse physics and the AI cursor, word anchors. Driven by hand-written scripts
   from the console, no model yet.
4. **M4 — agent.** Model call with the tools, `perform` scripts, screenshot loop, key
   handling.
5. **M5 — polish.** Vibe drawer, ElevenLabs, eval gating, hand-drawn style.
