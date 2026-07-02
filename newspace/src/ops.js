// The op vocabulary — now the `opstreams` LIBRARY (libraries/opstreams), which
// was extracted from this file. This shim re-exports it wholesale so the many
// local `./ops.js` imports keep working unchanged. Everything this file used to
// define lives in opstreams/ops.js — including `transformOp`/`RESYNC` (the
// Jupiter-style stale-op rebase port-opstream.js uses), which were ported back
// upstream, where the library's version/stamp rebase (`rebaseOp`) now folds
// over them.
export * from "opstreams/ops";
