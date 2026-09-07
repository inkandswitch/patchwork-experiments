# PWM live bridge

How the agent joins Dan’s running Morphic / QBF world and acts on the shared screen.

## End state we want

```
Dan’s Patchwork tab  ←── Automerge sync ──→  Agent runtime (Cursor / Node)
       Morphic heap                              runtime.eval(source)
            ▲                                         │
            └──── same DocHandle / automerge: URL ────┘
```

First proof: both screens show a `TextMorph` with **Hello from Grok 4.5!**

## Two cooperating halves

### A. World side (runs inside Morphic — Dan pastes once)

File: [`worldSide.js`](./worldSide.js)

Installs `Lively.$pwm` with:

- `install()` — one-shot setup (safe to re-run)
- `hello()` — drop the greeting TextMorph (local rehearsal / smoke)
- `acceptEval(source)` — gated entry: only runs when `$pwm.armed === true`
- `arm()` / `disarm()` — Dan’s permission switch for agent-authored evals
- Inbox drain: if shared `Lively.pwmInbox` (array of strings) has entries and armed, eval them one by one

Dan arms when he wants the agent to act; disarms otherwise.

### B. Agent side (this Cursor / a small Node helper)

1. **Rehearsal (works today, no URL):** load Morphic into a local Automerge test doc, `runtime.eval` the Hello snippet. Covered by `src/pwmHello.test.ts`.
2. **Live join (needs Dan’s URL + sync endpoint):** open a Repo against the same sync network Patchwork uses, `find(docUrl)`, bind `createLivelymergeRuntime(handle)`, then either:
   - `runtime.eval(source)` directly (agent is a peer), or
   - push strings onto `Lively.pwmInbox` and let the world side drain them (stricter gate)

**Live join works (2026-09-02):** headless peer + `runtime.eval` on Dan’s doc via Subduction relay `wss://subduction.sync.inkandswitch.com` (`--mode subduction`). Hello TextMorph appeared on Dan’s screen; later moved live to `pt(420, 360)`. Prefer `$pwm.arm` / inbox for gated follow-on evals.

### Transpile → install (browser path)

The Morphic system browser uses `replaceMethod(className, fragment)` — LM transpiles a single class member and installs it on the live prototype. PWM mirrors that:

```bash
pnpm pwm:eval --url automerge:… --replace WorldMorph --fragment pwm/fragments/WorldMorph_pwmPing.js
# then: --code 'Lively.pwmPing()'
```

Repo durability: after Dan OK’s, splice the same fragment into `newdefs.js` / `QBF.js` so cold starts match the live heap.

## Hello sketch (LM source)

```js
(() => {
  let t = new TextMorph(rect(60, 60, 320, 48), 'Hello from Grok 4.5!');
  Lively.addMorph(t);
  return t;
})()
```

Use `addMorph` (shared) so every replica sees it. Prefer `addEphemeralMorph` only for private agent chrome.

## Permission model

| Action | Gate |
|--------|------|
| Propose source in chat | always |
| Write `newdefs.js` / `QBF.js` | Dan asks / confirms |
| Live `runtime.eval` / inbox push | `Lively.$pwm.arm()` while collaborating |
| Persistent morphs on the world | prefer shared only for intentional demos |

## What Dan should send next

1. Patchwork URL of the open Livelymerge world (browser link and/or `automerge:…` id)
2. If known: sync server WebSocket URL Patchwork uses for that session
3. Confirm whether he has pastable world-side install (`worldSide.js`) available in a do-it

Then we attempt Hello on the shared screen.
