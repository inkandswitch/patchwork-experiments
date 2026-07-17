# The Object Model in Livelymerge

## Introduction

In the _Livelymerge_ project, Dan Ingalls and I (Alex Warth) are exploring the opportunities and challenges that arise from using an Automerge document as the heap of a program.

A couple of opportunities:

- **Persistence:** The program's heap is persistent, similar to a Smalltalk image. If you close the program today and open it two weeks from now, every object will be exactly as you left it.

- **Collaboration:** In a multi-user context, all of the participants will share the same heap, which makes this an interesting medium for collaboration.

Some challenges:

- **Consistency:**
  - When multiple users are present, who is in charge of running what "processes"? E.g., if the program implements a simulation and more than one user is running the code, it's possible that some side effects will run two or more times which is undesirable.
  - Is it possible to represent the program's state in such a way that its invariants will be preserved when automatic merges happen as a result of multiple users' interactions with overlapping sets of objects?
- **Performance:** Can we get programs to run fast enough for authentic use?
- **Support for long-running programs:** We'd like to be able to support programs that we can "live in" -- the kind of system Dan is known for, like [Squeak](https://squeak.org/) and the [Lively Kernel](https://www.lively-kernel.org/). But these programs run for an unbounded amount of time, and so their corresponding Automerge documents will accumulate a very large number of changes. Can we pull this off? If not (given the current implementation of Automerge) are there changes to AM (planned or otherwise) that could make this work?

This note describes the object model we designed and implemented for this project. It automatically serializes and deserializes data from/to the program's Automerge document. You'll see what this means and why it's needed soon. But first...

## Why "Lively"?

The programs we're most interested in for this project are self-sustaining systems like Squeak and the Lively Kernel. We're creating a new system in the same vein, but this time we're designing it from the ground up to be "multi-user" and collaborative, leveraging the good stuff that we get from Automerge.

Dan's Lively Kernel (LK) is a Squeak-like system that was written entirely in Javascript and runs inside the web browser. A user of the system can conjure up a Smalltalk-style _browser_ and modify any aspect of the system (e.g., the way text editing works or even the browser itself!) while it's running. The effects of the user's changes happen immediately.

As part of the Livelymerge project, Dan has written a new LK-like system whose heap is represented as an Automerge document. It includes a graphical user interface based on [Morphic](https://rmod-files.lille.inria.fr/FreeBooks/CollectiveNBlueBook/morphic.final.pdf), editable text areas, and even a Smalltalk-style browser. Everything in the system is written from scratch (the graphics bottom out at the HTML canvas) and the code can be viewed and edited from inside the system. This means that the user can make fundamental changes to the system, and in a multi-user context, those changes apply to all of the participants.

(Sidebar: for a long time, I've wanted people at Ink & Switch to experience this kind of self-sustaining system firsthand, and this project is a nice excuse to make that happen.)

## LM's Object Model

We plan to eventually design a new programming language specifically for use in this project. But to get going quickly, we decided to start with just an object model. The initial implementation of our object model is a little library that JS programs can use to create objects, "classes", etc. in pretty much the same way we're used to. The main difference is that the state of the objects in our object model is represented in the program's associated Automerge document instead of the JS heap. This means that our objects are persistent and support collaboration right out of the box.

Our object model library is exposed in two parts:

- The _global object_ is the equivalent of Javascript's "global" object, `globalThis`. This is the root of the heap. Our object model performs automatic garbage collection, so this is important! (We discuss GC in detail later in this note.)
- A small set of primitives for creating new objects, arrays, and functions in the heap.

In the first version of the system, programmers used these primitives directly (e.g., you'd write `world.f = ...` to define a global, and call `newObj()` instead of writing an object literal). We've since put a thin _transpiler_ in front of the object model, so LM programs now look like — and mostly are — plain JavaScript: object and array literals, top-level declarations, closures, even ES `class` syntax all work, and the transpiler routes them onto the heap primitives for you. (The transpiler deserves its own lab note; here I'll stick to the object model underneath it.)

Here's a simple example to get us going:

```
f = (x, y) => x * y + 2;
f(5, 8); // evaluates to 42
```

This looks pretty "vanilla" so far, but there's something interesting going on. Because `f` is a global, it lives in the program's heap — i.e., in the Automerge document. For example, suppose you and I are both working on this program, but from different computers. If I evaluate the first statement, `f` is stored in _our_ heap. This means that if you evaluate the second statement **without having evaluated the first**, you will still get the expected result (`42`).

## Representing Objects in the AM Document

In our object model, a property of an object can hold any value, including a reference to another object or even the object itself:

```
obj.self = obj;
```

So, just like in JS, it is possible for the heap of a LM program to contain cycles. But as we explained earlier, entire heap is represented as an AM document, which is JSON-like and must be tree-shaped. This means that our object model's implementation has to **serialize** values to an AM-compatible format. (We discuss **deserialization** later in this note.) Here's what our serialized heap looks like:

```
{
  objectTable: {
    '0.237823': <<state of object w/ id 0.237823>>,
    '0.419':    <<state of object w/ id 0.419>>,
    ...
  }
}
```

As you can see, we have an _object table_ that maps object ids to their state. Note that object ids can't be sequential as this would result in clashes (think multi-user!) so we use random numbers. (Honest question: how safe is this? The JS standard is very vague re: [Math.random](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.random).)

Here's what the state of an object in the object table looks like:

```
{
  // the names of special properties are prefixed with a $
  $type: 'obj',
  $id: '0.237823',   // id of this object
  $protoId: '0.419', // id of the object that this object delegates to

  // user properties are prefixed with a @ (this sidesteps an Automerge
  // bug involving property names like `toString` that collide with
  // Object.prototype)
  '@x': 5, // numbers are represented ...
  '@y': 6, // ... as numbers

  // object references (like the value of the `next` property below)
  // are represented as objects with `$type = 'ref'` and the id of
  // the referent:
  '@next': { $type: 'ref', $id: '0.12345' },
}
```

Functions get their own entries in the object table, too — they're first-class objects, after all:

```
{
  $type: 'fun',
  $id: '0.5551',
  $code: '($scope1) => (x) => x + $scope1.y',  // what we evaluate
  $codeForShow: '(x) => x + y',                // what we show the user
  $scopes: [{ $type: 'ref', $id: '0.5550' }],  // captured environment
}
```

Note the `$scopes` property: closures work. The transpiler analyzes each function for free variables, moves captured bindings onto _scope objects_ (which are ordinary heap objects), and serializes the function together with references to its scopes. This means a closure's captured state is persistent and collaborative like everything else — if I make a counter with `let count = 0` captured in a closure and you call it, we're incrementing the same `count`.

### Arrays

Note that an array value can't just be represented as an array of serialized values. This is because it must have an id in order for other objects to be able to reference (alias!) it. So each array in LM has an entry in the object table, with `$type = 'arr'` and a `$values` property that holds its (serialized) elements. This representation enables arrays in our object model to benefit from the array merge semantics in AM: if you push onto an array while I splice something out of it, both edits survive the merge.

## The interface to LM's object model

Now that we know how objects are represented, we can discuss the interface in more detail.

### The global object

The _global object_ is the root of LM's heap, and it is represented in the object table as the object with id `global`. When your code refers to a global (e.g., `f(5, 8)` above), the transpiler routes that reference to a _proxy_ for the global object. This proxy intercepts reads from and writes to the object's properties:

- On a _write_ (e.g., `p = someValue` at the top level) the proxy will _serialize_ the value that's being written to the property and store it in the appropriate place in the program's AM document.
- On a _read_ (e.g., `p`) the proxy will find the corresponding serialized value in the program's AM document. It will then return the result of _deserializing_ that value.

#### Serializing values

The serialized representation of a value depends on its type:

- A primitive value (e.g., a number, string, or boolean) is serialized as itself.
- An object, array, or function is serialized as `{ $type: 'ref', $id: ... }` — a reference to its entry in the object table.

The sample object table in the previous section includes examples of each of these types.

#### Deserializing values

Here's how deserialization works:

- A serialized primitive value deserializes to itself.
- A serialized reference deserializes to a _proxy_ for the referent. (For a function, calling the proxy evaluates the function's `$code` — memoized, so we always get the same underlying function for the same code — against its deserialized `$scopes`.)

That's right! The global object is not special in this respect: in LM, every time we interact with an object, we're really interacting with a proxy that knows which object it's for. One detail that matters in practice: proxies are cached per object id, so deserializing the same object twice gives you _the same_ proxy — which means `===`, `Map` keys, and `Set` membership work the way you'd expect.

### Creating objects

When your code says `{ x: 5 }`, `[1, 2, 3]`, or `function (…) {…}`, the transpiler wraps the literal in a call to the corresponding object-model primitive, which builds the serialized entry and returns a proxy for it. (In the first version of the system this was a user-facing function called `newObj`; now it's an implementation detail.)

The use of proxies in LM's object model is all about _ergonomics_. It makes interacting with our objects feel natural — you just write JavaScript — and takes care of all of the serialization and deserialization that's required to operate on an AM-backed heap.

## The LM tool

We have implemented a Livelymerge tool for Patchwork. Here's what a freshly-created LM document looks like when viewed through this tool:

![image](LM-fresh.png)

At the bottom of the page there is a large text area that works like a Smalltalk workspace. If the user selects some of the code inside the workspace and invokes "print it" (Cmd-P), that code will be evaluated by LM and the result will be displayed (by appending its stringified value to the workspace). "Do it" (Cmd-D) evaluates the selected code but doesn't display the result.

The area at the center of the page is an (initially blank) HTML canvas. We provide a `canvas` global that enables an LM program to draw whatever it wants on it. (The canvas is a per-user host resource, so it's stored in the heap as a symbolic, _late-bound_ reference: the AM document just says "canvas", and each user's replica resolves that to _their_ canvas at run time.)

You can write and execute code in the workspace that creates new objects in the heap and (via the aforementioned canvas bindings) implements a LK-like GUI, as shown below:

![image](LM-GUI.png)

Dan is working on a lab note about the system depicted above, so stay tuned! In the meantime, I'll use the rest of this section to explain how the LM tool hosts this system, focusing on its interaction with the program's AM document.

### The `change` function

Our LM tool has a `DocHandle` for the program's AM document, and it makes changes to the document via the handle's `change` method. But we don't call that method directly from the UI -- instead, we wrap it in our own `change` function:

```
function change(fn) {
  let exception;
  let returnValue;
  docHandle.change((_doc) => {
    doc = _doc;
    $global = proxify(doc.objectTable['global']);
    try {
      returnValue = fn();
    } catch (e) {
      exception = e;
    } finally {
      gc(returnValue);
    }
  });
  if (exception) {
    console.error(exception);
    throw exception;
  }
  return returnValue;
}
```

(This is lightly simplified — the real version also handles nested calls and some bookkeeping that's out of scope for this note.)

The argument to this function (`fn`) is the code that we want to execute in LM. Usually it's a function that is created from the code that the user selected in the workspace. But we also use it in the event processing and rendering loop. (More on this in the next section.)

Note that we capture the latest version of the document (`doc = _doc`) inside the callback. I get that this looks funny/dangerous/wrong, but I'm pretty sure this is OK because `doc` is only used inside (more precisely, _in the extent of_) the function that's passed to `change`. (I could instead just pass `doc` around, from function to function, but it would be more cumbersome than this funny-looking hack so I decided against it.)

### Garbage Collection

LM performs garbage collection at the end of every `change`. An important service provided by our garbage collector has to do with freshly-created objects. I'll illustrate why this is important by describing how rendering works in the system.

LM rerenders everything 60 times per second. This is done by calling the function `render()` which is written by the user. Now, it's common for lots of fresh objects to be created while rendering. As an example, we often compute bounding boxes for _morphs_ (Morphic objects) because we need that information but we don't hold onto the bounding box objects. These objects are known as _fresh garbage_ in generational GCs, and collecting them quickly and cheaply is important.

Our first stab at GC collected these objects just fine, but we noticed that the number of operations in the document was growing really fast. We realized that adding a new object to the object table and removing it from the table (via our `gc` function) inside a single call to the doc handle's `change` method was effectively a no-op, but each individual operation was still being logged. This was problematic.

After a helpful conversation with Peter, I made a change to the system that made this problem go away: new objects are no longer installed in the AM document's object table right away. Instead, they live in a _shadow document_ — a plain, local JS structure with the same shape as the AM document. At the end of each `change`, the GC _promotes_ into the object table only the fresh objects that have become reachable from the root of the heap; the rest are reclaimed without the AM document ever knowing they existed.

This change enabled us to keep on creating lots of (temporary) fresh garbage like points and bounding boxes during rendering without having to accumulate lots of useless operations in the AM document. (We've since pushed further on this "op economy" — e.g., writes that would store an identical value are elided — to the point where an idle frame generates zero Automerge operations, as a runtime guarantee.)

One more thing our GC does that may surprise you: objects that have made it into the AM document are **never collected**. Reachability is a _global_ property in a local-first system — an offline collaborator may still hold or re-link an object that looks unreachable from where I'm standing, and a local sweep would silently destroy their work at merge time. So the policy is: once persistent, immortal. (This costs nothing in terms of the document's _history_, which only ever grows anyway; it only grows the current-state snapshot.)

I've included the source code for the promotion phase of our `gc` function in Appendix I.

## Future Work

While we feel good about the semantics of our object model, exposing it as a library was not so nice -- for example, it was easy to accidentally mix our objects with plain old JS objects, which led to bugs and lots of head-scratching. The transpiler mentioned above has addressed much of this: LM programs are now written in (mostly) ordinary JavaScript, with closures, arrays, and ES `class` syntax that work the way you'd expect. We may still **design a programming language** specifically for Livelymerge some day, but the pressure to do so is much lower now. (The transpiler — and what it took to make closures merge — will be the subject of a future lab note.)

Not all of a program's state should be shared: in a multi-user system, things like _my_ halo, _my_ keyboard focus, and _my_ animations belong to me, not to the document. We've recently added support for **local (per-user) state** to the object model, and it turned out to fall out of the fresh-object machinery described above almost for free. That's the subject of the next lab note.

Long-running programs remain an open question. Our op-economy work means an idle system no longer accumulates operations, but a system that's actually being _used_ still grows its AM document's history without bound, and that history is never compacted. We are optimistic that changes/optimizations to AM could help here. (Let's talk!)

One of the aspects of the system that we're most excited about is _hands_: objects in Morphic that represent the user. By rendering each user's hand, we can see where they're pointing, what objects they're picking up or manipulating, etc. Hands are also an interesting design puzzle: they should probably be _visible to_ other users but not _persisted_ — a third category of state (shared-but-ephemeral, likely delivered over a presence channel) that we haven't built yet.

## Related Work

The _Beckett_ project at Ink & Switch is exploring the use of Automerge to enable collaborative editing/authoring of [Godot](<https://en.wikipedia.org/wiki/Godot_(game_engine)>) games. LM is similar in the sense that it enables multiple users to collaborate on the same program. As in _Beckett_, LM's use of AM makes it easy to duplicate everything ("poor man's _fork_) in order to try out different ideas, etc. Of course LM doesn't have a very rich set of objects and multimedia capabilities yet, but it also doesn't suffer from the "real world" obstacles that sometimes limit what is feasible in _Beckett_. The fact that both of these projects going on at the same time enables the lab to work on this problem from two very different angles, which I think is exciting.

Gilad Bracha is currently experimenting with a Croquet-based model of collaboration for his Newspeak that is based on Croquet. As Yoshiki Ohshima likes to say, Croquet is "network-first" (as opposed to Automerge, which is local-first) so there are different tradeoffs. Dan and I are planning on meeting with Gilad soon to compare and contrast the two approaches.

## Appendix I: `gc` (promotion phase)

Here is a simplified version of the marking/promotion phase of our garbage collector. `shadowTable` holds the fresh objects created during this `change`; anything reachable from the root graduates into the AM document's object table, id unchanged. (Remember: entries that are already in the object table are immortal, so there is no persistent sweep.)

```
function gc() {
  const live = new Set();

  visit('global');

  // fresh objects that were never reached are reclaimed here,
  // without the AM document ever knowing they existed
  for (const id of Object.keys(shadowTable)) {
    if (!live.has(id)) delete shadowTable[id];
  }

  // helpers

  function visit(id) {
    if (live.has(id)) return;
    live.add(id);

    // a fresh object that's reachable from the root gets promoted
    if (shadowTable[id]) {
      doc.objectTable[id] = shadowTable[id];
      delete shadowTable[id];
    }

    const entry = doc.objectTable[id];
    for (const v of Object.values(entry)) {
      lookAt(v);
    }
  }

  function lookAt(v) {
    if (isRef(v)) visit(v.$id);
  }
}
```

## Appendix II: Classes

An earlier version of this note included a page of "userland" library code that simulated classes with delegation, pre-ES5-style. The transpiler has made all of that obsolete: LM programs just use ES `class` syntax, and the transpiler lowers it onto the delegation-based object model (the class becomes a constructor function in the heap; its methods live on a prototype object that instances delegate to).

```
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  add(p) {
    return new Point(this.x + p.x, this.y + p.y);
  }
}

class Point3D extends Point {
  constructor(x, y, z) {
    super(x, y);
    this.z = z;
  }
}

const myPoint3D = new Point3D(1, 2, 3);
```

Since classes and their methods are objects in the heap like everything else, redefining a method (say, from the system browser) takes effect immediately for every collaborator — which is the whole point.

