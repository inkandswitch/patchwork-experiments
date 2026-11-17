// An import's settings, and their defaults. (Its own module so the datatype
// doesn't pull in the importer.)

export const DEFAULT_SETTINGS = {
  metresPerUnit: 0.0254, // TTS's unit is "about an inch" (KB)
  includeContents: true, // what's in each bag goes in its bag
  fetchMissing: true, // fetch what wasn't dropped (CORS permitting)
  flipObjX: true, // TTS mirrors x when it loads an OBJ (as Unity does)
  maxObjects: 5000,
  maxStoredBytes: 32e6, // raw assets bigger than this aren't kept (what uses them is drawn without them)
};
