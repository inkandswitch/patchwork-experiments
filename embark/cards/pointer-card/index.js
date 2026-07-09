// The Pointer card: owns the `pointer` channel (./channels.js); its behavior
// module (./card.js) is loaded by the shared card shell. This package
// registers nothing — it exists to publish that module and the channel
// definition readers import.
export const plugins = [];
