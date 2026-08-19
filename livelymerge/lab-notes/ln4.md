![](qbf.png)

# Getting Better Performance in Livelymerge

## Introduction

In the _Livelymerge_ project, Dan Ingalls, Peter van Hardenberg, and I (Alex Warth) are building a Lively Kernel-like system whose heap is an Automerge document. (See the earlier notes in this series for the object model and support for local state.) One of the challenges I listed at the start of this series was **performance**: can programs whose objects live in an Automerge document run fast enough for authentic use?

For a while the answer was no. Here's the example that forced the issue. Dan wrote _The Quick Brown Fox_ (QBF), a typing game in which Scrabble letter tiles ride in on a conveyor belt and drop onto a rack. It's a couple hundred morphs, animated at 30 frames per second: a reasonable workload. (Every measurement in this note is of an _ephemeral_ instance of the game, which is the natural way to play it; see the previous note.) And the belt was visibly, *painfully* slow. When we profiled a frame, we found out why: the system had a budget of 33 milliseconds per frame, and each frame was taking **180 milliseconds**.

Let me say up front what this note is really about. We are using Automerge in a way it was not designed to be used. Automerge is built to hold _document_ state: something you read when it changes, render, and write back occasionally. We're using it as the **working memory of a running program** — something a program reads millions of times per second. Under the hood, an Automerge document isn't a JavaScript object; it's a compressed, history-aware data structure (in WebAssembly), and every single property read has to seek into that structure and decode what it finds. That design is right for Automerge, but it turns reading a property into a computation (a seek and a decode), whereas JavaScript engines have spent twenty years making ordinary property reads very cheap.

And LM does a lot of reads! That's because _everything_ is in the document: not just the morphs, but every class, every method, every scope object captured by a closure. This is why running the game ephemerally is no escape hatch, by the way — the tiles may be mine alone, but the code they run on is shared. Redrawing the screen walks the entire morph tree, and every step of that walk is method lookups (a walk up the prototype chain — several reads per level), geometry math on objects (more reads), and so on. When we profiled it, **90% of frame time was inside Automerge's decoders**. The same few prototype objects were being re-read from the document hundreds of times per frame, yielding the same answer every time.

Here's an analogy that worked for us: think of the Automerge document as a _ledger_ — an authoritative, append-only record designed for reconciliation. We were doing our arithmetic directly on the ledger. Nobody does that. You keep a working copy on a scratchpad, and you make sure every entry you write lands in both places.

That's the main idea we'll explore in this note. The first three optimizations below are each a different corner of the system where we stopped consulting the ledger and started trusting a plain-JavaScript copy of it — and how we keep that copy from going stale. The result was a 64× speedup: frames went from 180ms to under 3ms, and the system crossed the line from "demo" to something that could actually support authentic use. The fourth optimization is a different kind of lesson — not about how often you consult the ledger, but about how to represent its entries.

**A word about who this note is for.** Our use of Automerge is deliberately extreme — a stress test — so every cost below also exists in ordinary Automerge apps, just not to the same degree. Read it as a field guide: if your app is slow, a gentler version of one of these might be why. And if you only have time for one section, skip ahead to Optimization 4, "minimizing the cost of strings": it doesn't depend on the others, it applies to every app that stores strings, and it's how our documents came to have 88× fewer operations and load 14× faster.

## Optimization 1: reading from a working copy

The core mechanism is a **materialized read cache**. The first time we read from an object in the document, we copy its entry — all its properties, decoded once — into a plain JavaScript object, and every subsequent read is served from that copy at ordinary JavaScript speed. The AM document is no longer on the read path at all.

Of course, a cache is just a bug with good intentions unless you can tell exactly when it's valid. Our rule:

> **Reads never touch the document. Writes always do — and they keep the copy current.**

This works because our object model already routes every read and write through proxies (that's how serialization works — see the object model note). The proxies are a natural _write barrier_: when a program writes a property, we write it to the document _and_ update the cached copy in place, so that the two don't drift apart. We update copies in place rather than tossing them on every write. (Re-materializing a big object — like the global object, with a property for every top-level declaration in the system — every frame nearly canceled out the benefits of the cache.)

If you know Automerge, you might ask why we don't just read from the _materialized_ document — the plain-JS snapshot Automerge itself maintains for reads outside of `change` callbacks. The reason is that LM code should feel like ordinary JavaScript that reads and writes freely: the programmer never says "OK, I'm making a change _here_." The system draws the transaction boundaries instead — one frame (event handling + steppers + rendering + GC) is one `change` — so all LM code runs _inside_ a change callback, and mid-transaction the materialized document is stale: it doesn't yet contain the writes the transaction has already made. Morphic reads its own writes constantly (set a morph's bounds and the layout code reads them right back; add a submorph and rendering iterates the list), so reads must see the mutable draft — the slow, WASM-backed view. Our cache is, in effect, a read-your-own-writes version of the materialization Automerge already does, kept current _during_ the transaction by the write barrier.

Note that our proxies don't see other users' changes. When a collaborator's changes sync in, they're applied deep inside Automerge, and my working copies no longer represent the state of the document. Fortunately, Automerge reports every change it applied as **patches** — little descriptions of each modification, with a path saying where in the document it landed. Each path names the object it touched, so we evict its corresponding copy, and the next read re-materializes it from the document.

Caching objects and functions took QBF's frames from 180ms down to 28ms. Extending the same treatment to arrays — with each mutating method (`push`, `splice`, …) mirroring its operation onto the copy — took us down to 7ms. Rendering, which had been 151ms of ledger-reading, now only took 6ms.

## Optimization 2: eliminating useless writes

Ever since the "op economy" work described in the object model note, LM has elided writes that wouldn't change anything: writing the same value an object already has generates no Automerge operations. Morphic code does this constantly — every frame re-asserts things like `didDrag = false` — and elision is what keeps an idle frame from polluting the document's history.

(Is that safe? Yes — it mimics what Automerge itself does: a write that stores the value a property already has is not recorded in the transaction at all. Our elision reproduces that behavior in LM, deciding it against the working copy instead of paying for a document read, and extends it to LM's object references, which Automerge can't compare for sameness.)

But there was a hidden cost: to decide whether a write can be skipped, you have to _read the current value_ — and we were reading it from the ledger. So every elided write was still costing us a read from the AM document.

The fix follows from the rule above: since the working copy is always current, the comparison can happen against the copy, and we only reach for the actual document entry in the case where the write really goes through. An elided write no longer involves reading from or writing to the Automerge document. Frames are down to 4.3ms.

## Optimization 3: repealing the bookkeeping tax

With reads and writes off the ledger, the profile showed exactly what you hope to see as a system builder: the Automerge time that remained wasn't being spent on behalf of the running program (QBF) at all — it was LM's own machinery, doing bookkeeping. This is good news: a hot spot in your own code is easier to fix. Recall that every transaction ends with a garbage-collection pass (that's how fresh objects get promoted into the document, and how local state stays local). That pass, plus some start-of-transaction setup, was quietly probing the document hundreds of times per frame: "does this object still exist?", once per object with local state; "are the heap roots in place?", every single transaction, forever. The answers almost never change. The GC now consults the working copies and its own liveness sets first, and the root check runs once per session instead of once per transaction.

The deepest cut was the traversal itself. Reachability only changes when the heap's _edge_ structure changes: some property, somewhere, starts or stops referencing an object. And every edge mutation already goes through our write barrier. So the GC keeps a plain-JS cache of each object's outgoing references, and reuses the previous transaction's reachable set until the barrier reports an edge change; when one does, only the dirty entries are re-read, and the re-trace runs over the cache at JavaScript speed. (Writes by remote replicas invalidate cache entries through the same patch stream as the read cache.) The payoff is that a pure-animation frame — thousands of writes, every one just replacing a number — never changes an edge, and never pays for a trace at all.

The fixed overhead of an _empty_ transaction — a floor under everything the system does, thirty times a second — dropped from 0.76ms to 0.10ms. Frames are down to 2.8ms.

## Interlude: a bug the profiler couldn't see

After the first big optimization, the belt was still slower than it should have been. And this time the profile had no villain to offer: no hot spot, nothing expensive — just animations running well below their intended speed. The bug was in our animation scheduler, and it's subtle. An animation step doesn't run at its "due time"; it runs at the first _frame_ after its due time — steps only get a chance to run when a frame does. So nearly every step runs a little late, and that's fine, as long as the lateness doesn't leak into the schedule. But our scheduler was setting the due time of each next step relative to _now_, i.e., the moment the current step actually ran. So each step's lateness was passed on to the next, and the delays compounded instead of staying bounded. The net effect: every animation's real period was its requested period rounded up to a whole number of frames — _strictly_ up, because a step coming due exactly as a frame arrives just misses it. The belt asks for a step every 33ms: exactly one frame, which rounds strictly up to two. Half speed: 15 steps per second instead of 30 — and worse when frames ran long, because missed steps were simply dropped.

The fix: each step's next due time is now computed from its _previous due time_ plus the period — never from "now" — so lateness stays bounded instead of compounding. A bounded amount of catch-up handles slow frames; after a real stall, the scheduler deliberately re-anchors to the present rather than sprinting through the backlog.

## Optimization 4: minimizing the cost of strings

So far the ledger's cost has been measured in milliseconds per frame. But it also has a _size_ — and ours was absurd: a freshly initialized Morphic world, before anyone has touched anything, was a document containing **1.2 million operations**.

By default, Automerge treats every plain string as collaborative _text_: each character is an individually addressable element with its own identity, which is what enables two people to edit the same string concurrently and have their insertions and deletions merge cleanly, character by character. For collaborative text editing, that's exactly what you want. For us, it's not so good: it means that _initializing_ an N-character string costs N operations, and our document is full of strings nobody will ever edit that way — object ids, type tags, and above all source code, which LM replaces wholesale when a user saves a method in the system browser. We were paying for per-character mergeability on strings that nobody merges.

Automerge has a good mechanism for our use case: `ImmutableString`, a scalar that costs one op regardless of length and is replaced whole (a conflict picks a winner rather than merging inside the string). Switching our representation to use AM's immutable strings — strings stay plain JavaScript in memory, and are wrapped at document writes and unwrapped at reads — collapsed the fresh Morphic world from 1.22M ops to 14K: an 88× reduction! Interestingly, the saved _file_ barely shrinks (Automerge's storage does a great job of compressing those million ops), but `Automerge.load` must still _replay_ them, so this is really a story about **load time**: opening that world went from 364ms down to 26ms, and the gap only widens as a document ages. The general rule: every plain string you store is a text CRDT unless you say otherwise — say otherwise for the strings that don't need it.

## Where we landed

| | frame time |
| --- | --- |
| where we started | 180 ms |
| reading from a working copy (objects, functions) | 28 ms |
| … and arrays | 7 ms |
| eliminating useless writes | 4.3 ms |
| repealing the bookkeeping tax | 2.8 ms |

(Measured in a headless test harness with a stubbed canvas; a real browser adds rasterization on top, but the story is the same.)

Automerge's decoders, which were initially 90% of the profile, are now about 18% — the remaining time is mostly our own proxy machinery, which is a different (and much smaller) problem. Dan's QBF now runs at full speed with room to spare — and the system it runs on still lives entirely in the document: every class, every method, every scope object, still merging, still persistent.

So here's the architecture that worked for us: a document of record at the bottom, a plain-JavaScript working copy on top, a write barrier between them, and patches for the writes the barrier can't see.

## Postscript: revenge of the bookkeeping tax

This note sat as a draft for two weeks, and when I re-ran the profiling harness to double-check the numbers before publishing, I saw that the cost of an empty transaction — the tenth of a millisecond we were so proud of — was back up to **31ms**, and frames were pushing 80ms. While I wasn't looking, Dan had made several improvements to QBF, among which was to add a per-replica word list for checking plays: this was an object with one property per legal word, all 179,000 of them. This was a perfectly reasonable thing to do, but it identified the one traversal we hadn't optimized. The GC pass that decides which _ephemeral_ (per-replica) objects survive the transaction was still re-enumerating every live ephemeral object's properties, in every single transaction. Nobody notices that pass when the biggest thing it walks is a halo. But at 179,000 properties, thirty times a second, that GC pass dominated the cost of the frame.

The fix was the same move a third time: cache each object's outgoing references, and let the write barrier — which already sees every mutation — invalidate exactly the entries whose edges changed. The word list's edge set gets computed once (it's empty: all those properties just hold `true`), and after that the trace never looks at it again. Empty transactions are back under a tenth of a millisecond, and frames are around 8ms — on a new version of QBF that has grown considerably since we took the 2.8ms measurement in the table.

While I had the harness out, I measured one more thing. Everything in this note is the ephemeral, per-user way of running the game — so what does _persistence_ cost now? I promoted an entire board into the document, every tile a shared, persistent object, and re-timed it: 7.3ms per frame, versus 7.2ms for the ephemeral one. With the barriers and caches in place, where an object _lives_ no longer shows up in the frame time at all — the difference between an ephemeral and a persistent QBF is measured in Automerge operations and history growth, not in milliseconds. (Still, we don't recommend this! Feeding lots of ops at animation rates can give the sync server a tummy ache.) That's the division of labor we'd been working toward all along: the ledger records; the scratchpad runs.

