// Opstreams — now the `opstreams` LIBRARY (libraries/opstreams), which was
// extracted from this file. The fixes this copy had gained since the extraction
// (negative-index resolution + missing-intermediate autovivification, kept in
// write PARITY between the in-memory apply() and applyAutomerge) were ported
// back upstream, so this is a pure re-export shim keeping the many local
// `./opstreams.js` imports working unchanged:
//
//   • the root re-exports the dependency-free core (apply, Opstream, Source,
//     transform — plus scope/bind/coalesce and all of ops.js) AND the automerge
//     bridge (automergeOpstream, fileTextOpstream, applyAutomerge, patchesToOps)
//   • opstreamToSignal lives in the library's Solid entry (the only module of
//     it that imports solid-js)
export * from "opstreams";
export { opstreamToSignal } from "opstreams/solid";
