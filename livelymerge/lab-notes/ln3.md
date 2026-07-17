# Local State in Livelymerge

## Introduction

In the _Livelymerge_ project, Dan Ingalls, Peter van Hardenberg, and I (Alex Warth) are building a Lively Kernel-like system whose heap is an Automerge document. (See the previous lab note for the details of our object model.) The whole point of this arrangement is that every object is persistent and shared: if you and I are looking at the same document, we're looking at the same objects, and they'll still be there two weeks from now.

It didn't take much multi-user testing to discover that this is sometimes exactly what you _don't_ want.

Here's the example that forced the issue. In Morphic, you cmd-click a morph to summon its _halo_ — a ring of handles for moving, copying, resizing, etc. A halo is a morph like any other, so in our system it was a persistent, shared object. Which meant: when I cmd-clicked a rectangle, my halo popped up **on your screen**. And if I closed my laptop without dismissing it, it would still be there — for both of us — two weeks later.

The halo is _my_ UI, part of _my_ session. So are my keyboard focus, the hover affordances under my pointer, and the animations I've started. None of this belongs in the document.

We call this **local state**: state that is per-user and ephemeral — it's fine (desirable, even) for it to vanish on reload.

Supporting local state is trickier than it sounds. Here's why: everything that happens in LM — handling a pointer event, redrawing the screen — runs inside a short-lived _transaction_ on the Automerge document (a single call to `change`; there's one per frame). At the end of each transaction, the system garbage-collects any newly-created objects that didn't end up in the heap. So a halo can't just live in a temporary variable — it would be swept away at the end of the frame in which it was created. It has to survive from one transaction to the next, and until now, the only home we had for an object like that was the shared, persistent heap. (For a while we worked around this by stashing things on `window`, the JS global object. That "worked", but it was a hack — that state was invisible to our object model, and it caused exactly the kind of bugs you'd expect.)

## The programmer's view: `$`-properties

The mechanism we landed on is small enough to state in one line: **a property whose name begins with `$` is local.** Local properties are per-replica, they survive across transactions, and they're gone after a reload. Everything else about the object model is unchanged.

```
const morph = {
  owner: someMorph,   // persistent edge — in the document, shared
  submorphs: [a, b],  // persistent edges
  $halo: haloMorph,   // local edge — never serialized, never shared
};
```

Note that it's the _edge_ that is local, not the object on the other end of it. This turns out to be the key design decision, as we'll see below.

## What we use it for

Some real examples from our Morphic implementation.

**Halos.** Every morph carries two submorph lists: `submorphs` (persistent, shared) and `$submorphs` (mine alone). Halos attach via the second one:

```
// Per-user UI: my halo is mine alone (never enters the Automerge document).
this.addEphemeralMorph(new HaloMorph(target));
```

where `addEphemeralMorph` is just:

```
addEphemeralMorph(morph) {
  this.ephemeralSubmorphs().push(morph);
  morph.owner = this;
  ...
}

ephemeralSubmorphs() {
  if (!this.$submorphs) this.$submorphs = [];
  return this.$submorphs;
}
```

Rendering draws the persistent submorphs first and the ephemeral ones on top; hit-testing goes in the opposite order. And here's the economy of the edges-not-objects rule: only the _attachment_ is local. The halo's own subtree — its handles, their shapes, their labels — is made of perfectly ordinary objects, connected by perfectly ordinary properties. They stay local anyway, because the only way to reach them is through that one `$`-edge.

**The stepping schedule.** Morphic animations run via `startStepping`, which registers a step method to be called periodically. Who should run an animation's steps in a multi-user system? If the schedule were shared, _every_ replica would run _every_ step — side effects times N users. (This is the "who runs the processes?" consistency question from the previous note, showing up in practice.) So the schedule is local:

```
startStepping(method, argIfAny, msTime) {
  this.stopStepping(method);
  let spec = new StepSpec(this, method, argIfAny, msTime);
  if (!this.$steppingSpecs) this.$steppingSpecs = [];
  this.$steppingSpecs.push(spec);
  this.world().startSteppingSpec(spec); // adds to the world's $stepList
}
```

Only the replica that started an animation runs its step methods — everyone else sees the results through the document. As a bonus, the per-step bookkeeping (each spec's `nextStepTime`, rewritten on every tick) lives on a local object, so it never generates a single Automerge operation.

**Per-session UI state.** Assigning to a `$`-name at the top level creates a local property _of the global object_ — a per-user global. We use one to root the session's UI state:

```
$uiState = {
  eventListeners: [],       // keeps browser-held closures alive across transactions
  longClickByPointerId: {},
  pointerLocation: null,
};
```

`$uiState` is re-created by `initUI()` at the start of every session, which is exactly the lifetime it should have. The world's `$keyboardFocus` and `$pointerFocus` work the same way.

## The mechanism, briefly

Recall from the previous note that freshly-created objects don't go straight into the Automerge document: they live in a local _shadow document_, and at the end of each transaction the GC _promotes_ the ones that have become reachable from the root. Local state turned out to be a small extension of that same machinery. The whole design reduces to one rule:

> **An object is persistent iff it is reachable from the persistent root via a path that contains no `$`-edges.**

The GC's traversal is blind to `$`-edges — local property values are stored in a sidecar (`objectId × propertyName → value`), never in the heap entries it walks, so they can't leak into the Automerge document even by accident. At the end of each transaction, every shadow object is classified:

- **Promote** — reachable from the root through ordinary edges only: it graduates into the Automerge document (persistent from now on — promotion is one-way, and it's transitive: promoting an object promotes everything it references through ordinary edges).
- **Retain** — not persistently reachable, but reachable from someone's `$`-properties: it stays in the shadow document. This is a halo between frames.
- **Collect** — reachable from neither: reclaimed.

Seen this way, a _fresh_ object is just an object whose persistence hasn't been established yet, and an _ephemeral_ object is one whose persistence never will be. They're the same kind of thing, handled by the same traversal — which is why local state fell out of the fresh-object optimization almost for free.

One implementation detail worth calling out: object ids are shared across the document and the shadow document, and promotion preserves them. So references never need rewriting when an object is promoted, proxies remain valid, and — pleasingly — a promoted object _keeps its local properties_. A shared morph can have a `$halo`.

## Gotchas

- **Ephemerality is only as strong as the weakest incoming edge.** If any persistent, non-`$` property points at your per-user morph, the next GC will dutifully promote it into the shared document. We learned this the hard way: the world's `pointerFocus` property (which can point at a halo handle mid-drag) had to become `$pointerFocus`, or halos leaked into the document one drag at a time.
- **Local state doesn't survive a reload** — that's by design, but it means anything rooted in `$`-properties needs a session-start initializer (`initUI()` in our system) to re-create it.
- Writes to `$`-properties are **non-transactional**: they take effect immediately and don't roll back if the enclosing transaction fails. We haven't been bitten by this yet, but it's a seam we're keeping an eye on.
- `$` was already a legal identifier character in JavaScript, so we've effectively taken it over. (We considered a more principled Symbol-keyed alternative, but the syntax was too heavy to live with.)

## Future Work

There's a third category of state hiding in this design. A user's _hand_ (the Morphic object that represents their cursor) should be **visible to others but persisted by no one** — you want to see where I'm pointing, but nobody wants 60 updates per second in the document, or my hand fossilized in it after I leave. Shared-but-ephemeral state probably wants a presence channel rather than the Automerge document; we haven't built this yet.
