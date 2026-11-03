// An import's settings, and their defaults. (Its own module so the datatype
// doesn't pull in the importer.)

export const DEFAULT_SETTINGS = {
  metresPerUnit: 0.0254, // TTS's unit is "about an inch" (KB)
  includeContents: true, // bags' contents, as hidden groups
  hideFaceDown: true, // face-down cards as hidden objects
  fetchMissing: true, // fetch what wasn't dropped (CORS permitting)
  flipObjX: true, // TTS mirrors x when it loads an OBJ (as Unity does)
  cardTexture: 512, // longest side of a card face, in pixels
  maxObjects: 5000,
  maxStoredBytes: 32e6, // raw assets bigger than this are used but not kept as file docs
};
