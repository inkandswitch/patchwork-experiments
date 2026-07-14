// The Open Documents card is a `card` document whose behavior module
// (./card.js) the shared card shell loads. While the card sits face-up on a
// canvas it tracks the frame's selected document and publishes it — plus its
// link closure — into the `OpenDocuments` channel, feeding the Schema Matcher
// card. This package registers nothing; it exists only to publish that module.
export const plugins = [];
