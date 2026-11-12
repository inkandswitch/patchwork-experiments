# joints

Joints for [scene](../scene/README.md) objects: how one part moves against
what it's attached to. One so far, the **slide**: a part that moves along a
straight line between two stops, closed and open. A door rising into its
frame, a drawer in a cabinet, a sliding hatch on a deck: the same joint,
with different numbers.

```
pnpm install && pnpm build && pnpm test
```

It is component physics, not a game: a slide opens when someone within reach
opens it, and may close itself after a wait (a spring, a door closer). It
counts nothing and keeps no score. It doesn't depend on the scene package: it
reads and writes the trait in the shape below, through the stage's contract
(scene/STAGE.md), and the scene finds it by its trait.

## What this package registers

| type | id | for |
|---|---|---|
| `scene:extension` | `joints` | slides: the Open / Close verb, the motion, closing after a wait (`src/extension.js`; the joint itself is `src/slide.js`) |

It declares no `activities`, so it runs whatever the viewer is doing (a
drawer is opened while editing as well as while walking) and offers no
activity of its own: a slide doesn't make a scene offer Play; a game in it
does. It `requires` nothing: the use prompt is a game's to bring into play.

## The trait

```js
"joints.slide": {
  axis:  [x, y, z],              // the way it opens, in its parent's frame (made unit)
  stops: { closed: m, open: m }, // where each stop is along the axis
  speed: m/s,
  wait?: s,                      // > 0: it closes itself this long after it opened
  at:    "closed" | "open",      // the stop the object's transform is at
  since?: ms, by?: session,      // runtime: when it came to rest open, and whose view opened it
}
```

- The base of the line isn't stored: it's the position less `axis × stops[at]`.
  Moving the part in the editor moves its line with it.
- `at` is about the object (its transform is at that stop), so a copy keeps
  it; `since` and `by` are about now, `runtime`, and a copy leaves them.
- Positions are written to the micrometre, so a part opened and shut comes
  back exactly where it was.
- The inspector's "Add behaviour…" offers it (axis, stops, speed, wait).

## Using it

Two ways, one verb (**Open**, or **Close** when it's open):

- **Walking** (a game that brings the use prompt): look at it from within
  arm's reach (2 m from the eye to the point looked at) and the prompt
  offers **[F] Open**. Only the prompt says where the eye is, so only the
  prompt's verb has a reach, and F pressed out of reach goes by.
- **Its menu and the inspector**, in any activity: Open, with no key and no
  reach. No key, because F is Frame all while editing and a key map has no
  eye to measure from.

While it moves the verb says Opening / Closing; while someone else moves it,
the verb is there but disabled.

## Who moves it, and what is written

- **The doc holds only where it rests.** The view that moves a part shows the
  motion as a pose hold, every frame (everyone sees it, and the stage's
  raycasts and `worldOf` see it too, so a door blocks a walker as it's
  drawn); it writes the stop it reaches **once**, with `since` (when it got
  there) and `by`. A cycle (open, wait, close) is **two writes**.
- **By the clock.** A motion is timed from when it started: where it's drawn
  is the fraction of its travel time gone by, and its write is due at a
  fixed time (below), set on a timer. Frames only draw it, so a view that
  draws none (a hidden tab) still lands and writes on time, and closes what
  it opened after its wait.
- **Closing.** The view that opened it closes it when its wait is up. If that
  view has gone (or stopped running this: each view says it's here with a
  presence key, `here`), any view closes it, a grace period (1.5 s) after the
  later of when it should have closed and when that view noticed. A view that
  joins later and finds a part open with nobody to close it does the same.
- **Two at once.** Two views starting at the same moment both hold it; the
  stage ranks the holds the same way in every view (STAGE.md, `heldBy`), and
  the one told that a peer holds it first lets go without writing. The one
  that loses may be the one that pressed first: ranks are Lamport stamps, so
  the winner pressed before it heard the loser's hold (within a latency and
  a pose interval of the loser's press), and the loser hears the winner's a
  latency and a pose interval after that. So a view writes no sooner than
  `HEAR_MS` = 2 × (450 ms + 50 ms) = 1 s after it started (or when it gets
  there, if later), and two writes of one stop can't happen on a network
  whose latency is under 450 ms.
- **Gone mid-motion.** A view that goes while it moves a part takes its hold
  with it: the part is back where the doc last had it at rest, and nothing
  was written.

## Consumers

The same joint, unchanged, with different numbers:

- a **door** that rises into its frame: `axis: [0, 1, 0]`, a wait, so it
  shuts itself (an imported map's doors are these);
- a **drawer**: `axis` out of the cabinet's front, `stops: { closed: 0, open: 0.4 }`,
  no wait, opened from its menu while the cabinet is being designed;
- a **sliding hatch** on a boat's cabin top (the sailing package's sloop: her
  companionway's hatch, `axis: [0, 0, -1]` forward along the cabin top, 0.55 m
  at 0.5 m/s, no wait), attached under her hull, so it slides in her frame as
  she heels.

Its stops are named closed and open and its verb is Open / Close, so it is
for things that open. A lift moves between two stops too, but it isn't
opened: it wants a verb of its own (Raise / Lower, or a switch), so it isn't
claimed here.

What it doesn't do yet: turn (a hinge is the next joint), stop or reverse
when a body is in the way (that needs the `body` convention: SCOPE §9.3),
or be worked from a distance (a switch, a wire: a trigger that names the part).

## Layout

| file | what |
|---|---|
| `src/index.js` | plugin metadata only (worker-safe), with the trait's description |
| `src/slide.js` | the joint: reading the trait, the stops, and `createSlides(env)`, everything a view does with slides, against an env (pure) |
| `src/extension.js` | the stage's side: the verb, the loop, the timer, the presence key |

## Testing

`pnpm test`:

- `src/slide.test.js`: reading the trait; and **every interleaving** of a
  finite set of events, run on the real `createSlides` against a simulated
  network (each view its own replica of the door's rest, writes merged
  last-writer-wins as concurrent Automerge writes settle, holds ranked as
  the stage ranks them, a pose stream every 50 ms, hellos and byes):
  2 doors (1.8 s and 0.2 s of travel) × 4 latencies (5–440 ms) × the second
  view pressing at none of or one of 12 moments (440, 200, 60 or 20 ms
  BEFORE the first, so the view that loses the ranking pressed first; with
  it; 20 ms after; mid-opening; open; as it closes; mid-closing) × the
  opener leaving at none of or one of 3 moments (mid-opening, waiting open,
  mid-closing) × the second view there from the start or joining while it's
  open × neither, the first or the second view hidden (no frames, timers
  rounded up to the whole second as a browser throttles them): 1,536 cases.
  In every one: writes alternate open, closed (so no cycle has more than
  two), every view left agrees, nobody still holds it, it ends shut exactly
  where it started with its runtime state gone, and every write is one of
  the two stops. Plus the plain cycle, two at once, the opener gone after
  opening, the opener gone mid-motion, a late joiner, a hidden opener, and
  that the bound is real: at 600 ms of latency, the loser pressing first,
  both write an open; at 440 ms, the same presses write one.
- `src/extension.test.js`: the prompt's verb (F, 2 m) and the menu's (no
  key, no reach), the hold each frame by the clock, the one write after it
  has been heard, the close after the wait, a hidden tab landing and closing
  on its timers alone, letting go on stopping, the metadata.

A browser probe elsewhere in this repo works a slide between two real views
on real Automerge docs and checks the two writes in the doc's history.
