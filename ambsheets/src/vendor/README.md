# Vendored: amb-engine

`amb-engine.ts` is an unmodified copy of `src/amb-engine.ts` from
[inkandswitch/amb-engine](https://github.com/inkandswitch/amb-engine) at commit `9f5efbf`
("refactoring", 2025-10-13).

It is copied rather than linked because every tool in this repo has to build on its own
(see the repo README), and amb-engine isn't published to npm. To update it, copy the file
again; Ambsheets only uses the public surface (`AmbEngine`, its `sampler()`, and the
factory methods `oneOf`, `normal`, `uniform`), so nothing here needs patching.
