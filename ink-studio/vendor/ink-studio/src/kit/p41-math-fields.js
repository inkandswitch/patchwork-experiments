/* One chart contract for field expressions, deformations, material coordinates and flows. */
(function (K) {
  const math = MathFields;
  K.procedural.mathFields = Object.freeze({
    mapping: math.mapping,
    integrator: math.integrator,
    attractorFlow: math.attractorFlow,
    families: Object.freeze(Object.keys(math.systems)),
    deformation: math.deformation,
    flow: math.flow,
    mask: math.mask
  });
})(KIT);
