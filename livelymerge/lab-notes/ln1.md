# The Livelymerge Experiment

In self-sustaining object-oriented systems like Smalltalk and the Lively Kernel, everything that happens is a result of objects sending messages to each other. Objects can be created, interrogated, and modified at runtime, giving users unprecedented control over their experience. Don't like the way selection works in the text editor? Open a *code browser*, find the relevant code, and change it. Unhappy with the programming language itself? You can change that too. Nothing is out of reach.

These systems were originally designed for a single user. Later, networking interfaces and object databases like Gemstone added mechanisms for collaboration — but always as a layer on top. With Livelymerge, we attempted a radical experiment: **what could we learn from building a self-sustaining system where the entire object memory was shared simultaneously by multiple users?**

Our approach was simple: create a new Lively Kernel-like system and represent its entire state — classes, methods, objects, and all — as an Automerge document. This would give us merges for free. Of course, merging different versions of the state of a live system is a nontrivial problem, and there's no way to guarantee that objects' invariants wouldn't be violated. But we were curious how far this simple scheme might get us, and what lessons we might extract from the wreckage when things went awry.

The results were mixed, though often surprising, and suggested potential for further study. There is something magical about a synchronized collaborative space, and as we found in testing, the very real problems — likely hard to solve in full generality — can often be sidestepped long enough to learn other useful lessons. Come along on a journey into Livelymerge: a daring research experiment bound for possible self-destruction, and the lessons we learned along the way.

## An Automerge-Backed Object Memory

The key idea in Livelymerge was to represent the state of the entire system as a single Automerge document.

Alex Warth devised an Automerge-friendly (tree-shaped) format for the *object table* and the state of each object. In this scheme, references are represented as object ids (keys to the object table), to enable circular references. Alex also implemented a proxy-based mechanism that hides the details of this representation under a programmer-friendly interface —that way, an object in Livelymerge looks like any Javascript object, with properties, methods, etc. The proxies translate property reads and writes to the Automerge layer. Using this object model, Dan Ingalls built a Lively Kernel-like system. This includes Morphic, halos, text editors, and a browser so that the system can be modified from within.

Wait, wait. Do you mean every time we read or write to one of the instance variables of an object, in an objects where *everything* is an object, this whole thing with the proxies all the way down to the Automerge document is going on? Yes, that's right!

