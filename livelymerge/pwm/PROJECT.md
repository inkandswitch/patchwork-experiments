# Play with Me (PWM)

A collaboration project spanning two live systems in Livelymerge:

| Short name | Meaning |
|------------|---------|
| **Morphic** | The rudimentary self-supporting programming environment in Patchwork (`newdefs.js` and friends) |
| **QBF** | The simple multiplayer game authored inside that Morphic (`QBF.js`) |

**PWM** is not a third game engine. It is the project of making the LLM agent in this chat a **live collaborator** in Morphic and QBF sessions.

---

## Goal

Establish **you** (the LLM agent in this Cursor session) as a collaborator in various live programming sessions in (at least) Morphic and QBF.

Concretely: take a Patchwork URL from Dan, join the shared world, and—with permission—author code that is not only checked into `newdefs.js` / `QBF.js`, but **transpiled and entered into the running system**. First milestone: put a `TextMorph` on the shared screen with the string:

> Hello from Grok 4.5!

---

## How we might achieve it

Layered path from “chat can edit files” to “agent acts in the live world.”

### 1. Shared document address
Dan provides an Automerge / Patchwork doc URL (`automerge:…` or the Patchwork app link that wraps it). That URL is the world we both inhabit.

### 2. Agent-side runtime handle
Stand up (or reuse) a Livelymerge runtime against that `DocHandle`—same contract as `LivelymergeEditor` / `createLivelymergeRuntime(docHandle)`. From here the agent can `runtime.eval(...)` inside LM transactions, not only edit static sources.

### 3. Permission gate
Until trust is earned, every live mutation goes through an explicit OK from Dan (“apply this eval?”, “commit this method?”). File edits to `newdefs.js` / `QBF.js` remain the durable record; live eval is the rehearsal stage.

### 4. Transpile → install → run
Author LM-facing source (class/method fragments or small scripts) → transpile with the existing LM pipeline → install into the live heap (assign methods, `addMorph`, `startStepping`, …) → optionally mirror the same text back into the repo so the next cold start matches what we did live.

### 5. First proof on the shared canvas
```js
// sketch — names may match Morphic vocabulary we settle on
let t = new TextMorph(rect(40, 40, 280, 40), 'Hello from Grok 4.5!');
Lively.addMorph(t);
```
If both screens show that morph, PWM’s first loop is closed.

### 6. Deeper collaboration (later)
- Inspect / halo / step schedules as the agent “looks”
- QBF: join a Game #, propose tile or UI changes live
- Ephemeral vs persistent intentionality (`$` vs shared) as a first-class authoring concern
- Agent-owned ephemeral chrome vs shared artifacts Dan wants to keep

### 7. Safety rails
- Default to ephemeral attach for experiments; promote with `bePersistent` only when asked
- Prefer `$transform` / local stepping for animation demos (lean ops)
- Never push secrets; never mutate without the permission gate while we are still bootstrapping

---

## Status

## Status

**Phase:** Complete — Morphic + QBF live collaborator loop verified  
**Done:**
- Take Patchwork / Automerge URL and join as Subduction peer (`pwm/join.ts`)  
- Shared-screen Hello TextMorph + live reposition (Dan confirmed)  
- `replaceMethod` transpile→install on `WorldMorph.pwmPing` and `QBFMorph.pwmTag` (Dan confirmed pong + QBF collab banner)  
- Repo authorship: fragments mirrored into `newdefs.js` and `QBF.js`  
- Tooling: `--file` / `--replace` / `pwm/mirrorFragment.ts` / world-side gate / tests  

**Known wrinkle:** stock `openQBF` attaches ephemerally; shared PWM demos need `bePersistent` (or a future shared-open helper). **Dan closed the agent’s shared QBF — it gobbled ops** (ticking board promoted to shared). Tomorrow: lean shared-QBF pattern, not naive `bePersistent`.

**Tomorrow:**
- Reduce per-action confirm/`run` friction for trusted live collab  
- Explore voice commands as an input path into PWM actions  
- Fix shared-QBF ops cost (ephemeral ticks / lean open)  

See [PROJECT_LOG.md](./PROJECT_LOG.md) for the chronological record.
