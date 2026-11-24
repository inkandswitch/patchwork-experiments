import * as shared from '../camera-impulses.js';
export const cameraImpulses = shared.default ?? globalThis[Symbol.for('ink-studio.camera-impulses')];
