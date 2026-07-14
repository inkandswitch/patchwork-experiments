// The Place Finder card is a `card` document whose behavior module (./card.js)
// the shared card shell loads. The `poi-card` datatype, board tool, and token
// tool ride that module's `plugins` export — the shell registers them while the
// card is face-up and retracts them when it flips down — so this package entry
// registers nothing.
export const plugins = [];
