/* Measure the rest geometry of a recipe without sampling or baking it. */
(function (K) {
  const P = K.procedural || K.authoring;
  function measureSculptBounds(build) {
    if (typeof build !== 'function') throw Error('Geometry measurement needs a sculpt recipe');
    const sculpt = K.sculpt(makeSculpt(makeBuilder(1), { measureBounds: true }));
    build(sculpt);
    return sculpt.geometryBounds();
  }
  P.measureSculptBounds = measureSculptBounds;
})(KIT);
