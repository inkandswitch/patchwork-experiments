/* Shared art-pixel buffer names and splat ownership rules for CPU and shader hosts. */
const ArtPasses = (() => {
  const surface = Object.freeze(['coverage', 'depth', 'normal', 'objectId', 'materialId', 'emission', 'splatId', 'position', 'objectPosition', 'protected', 'emissionDepth', 'motion', 'emissionMotion', 'target', 'mask']);
  const environment = Object.freeze(['sky', 'fogTransmittance', 'precipitation', 'reflections', 'foregroundCoverage']);
  const channels = Object.freeze([...surface, ...environment, 'paletteOwner']);
  const cutoff = 0.5;
  const ownsSurface = (alpha, writesDepth, depth, nearest) => writesDepth && alpha > cutoff && depth <= nearest;
  const over = (value, below, alpha) => value * alpha + below * (1 - alpha);

  function select(request) {
    if (!request) return [];
    if (request === true) return surface;
    if (!Array.isArray(request) || request.some(channel => channel !== 'environment' && !channels.includes(channel)))
      throw new RangeError('Unknown art pass. Available passes: ' + channels.join(', '));
    return [...new Set(request.flatMap(channel => channel === 'environment' ? environment : [channel]))];
  }

  function subset(passes, selected) {
    const output = { w: passes.w, h: passes.h };
    for (const channel of selected) output[channel] = passes[channel];
    if (output.objectId) output.objects = passes.objects;
    if (output.materialId) output.materials = passes.materials;
    if (output.target) output.targets = passes.targets;
    if (output.paletteOwner) output.paletteOwners = passes.paletteOwners;
    return output;
  }

  const glsl = `
bool inkOwnsSurface(float alpha, bool writesDepth, float depth, float nearestDepth) {
  return writesDepth && alpha > 0.5 && depth <= nearestDepth;
}
float inkCoverageOver(float alpha, float below) { return alpha + below * (1.0 - alpha); }
vec3 inkEmissionOver(vec3 emission, vec3 below, float alpha) {
  return emission * alpha + below * (1.0 - alpha);
}
`;

  return Object.freeze({ channels, environment, select, subset, cutoff, ownsSurface, over, glsl });
})();
if (typeof module !== 'undefined') module.exports = ArtPasses;
