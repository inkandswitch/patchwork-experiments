// The shared script is CommonJS in Node and registers its API when loaded as browser ESM.
import * as shared from '../camera-lens.js';
export const cameraLens = shared.default ?? globalThis[Symbol.for('ink-studio.camera-lens')];
