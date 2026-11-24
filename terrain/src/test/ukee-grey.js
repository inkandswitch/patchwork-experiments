// Ukee grey as the weather package draws it under Ucluelet's template weather
// (cover 1, stratocumulus at 600 m, 19 km visibility: weather/WEATHER.md,
// "The anchors"): the horizon's colour and the fog, which the place's far
// forest and baked stratus are tuned against. A test copy, since terrain
// doesn't import the weather package; probes/publish-ucluelet.mjs checks it
// against the world's own atmosphere in the page, so it can't drift unseen.
export const UKEE_GREY = Object.freeze({ horizon: "#959ea1", fog: Object.freeze({ color: "#959ea1", near: 900, far: 17100 }) });
