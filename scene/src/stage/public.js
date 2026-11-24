// The kernel's face to the layers above it (STAGE.md, "Words": Layer): the
// one kernel module the native services and the editor may import. Pure
// helpers only, each a reading of a value the api gives them, so a plugin
// shipped here and one in another package see the kernel alike: everything
// else they get is the api they were created with. The boundary test
// (../native/boundary.test.js) holds the line both ways: nothing above the
// kernel imports another kernel module, and nothing here goes unused.

// the view value: the Look body; whether a hand of a kind, a pointing tool, is held
export { LOOK, holding, pointing } from "./bodies.js";
// what a command is and whether it applies (STAGE.md, "Commands")
export { TOO_FAR, commandState, flatCommands, inHand } from "./commands.js";
// the path grammar: how the view names an object across stages
export { elementOf, parseKey, samePath } from "./paths.js";
// what the view's own Escape does now (the Edit hand's escape is it)
export { restLayer } from "./ladder.js";
// whether the look goes along the eye ray
export { looksFromEye } from "./pointer.js";
// who wrote what a path shows, from the doc's change messages
export { writers } from "./provenance.js";
// the input chain's order: who holds an object, in the order the chain offers it
export { chainOrder, hitChain, holdersFor } from "./chain.js";
// the key order: who reserves a key, and how a key is named
export { codeOfKey, declaredKeys, isTyping, keyHolder, keyLayers, keyOfCode, labelOf, lookChain, nameOfCode, reservedBy } from "../key-order.js";
// the packages rule: what an extracted doc lists
export { listedPackages, packageUrl, packagesToList } from "../packages.js";
