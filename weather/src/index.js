// Plugin metadata only. This module runs in a worker: no imports, no DOM, and
// every field except load() must survive structuredClone.
//
// Weather is a scene extension (WEATHER.md; the scene package's STAGE.md,
// "Ambients"): a world's weather is one scene trait, `weather`, plain
// physical data — where and when (place, lat, lon, zone, date, hour), the air
// (wind, from, gust, seed) and the sky (cover, clouds, base, visibility,
// rain). The extension offers it as the world's two ambient conventions,
// `wind` and `atmosphere`, a pure function of the trait, so every peer and
// the deterministic sim compute the same world from the doc, and nothing is
// fetched per viewer. Where this doc is the outermost, its weather is the
// world's; a linked world brings its things, not its weather.
//
// The trait is flat, one field per slider, so concurrent edits merge field by
// field. A missing field is its default (STAGE.md's rule). A fetched snapshot
// also writes `source` ({ name, api, for, fetched, sum }), which nothing
// describes, so the inspector neither shows nor touches it.

/** A fair summer afternoon at Cadboro Bay: the trait a new world's weather starts as, and every missing field's default. */
const INIT = {
  place: "Cadboro Bay",
  lat: 48.454,
  lon: -123.2915,
  zone: "America/Vancouver",
  date: "2026-07-15",
  hour: 15,
  wind: 4,
  from: 235,
  seed: 1,
  cover: 0.35,
  clouds: "cumulus",
  base: 1200,
  visibility: 10000,
  rain: 0,
};

const CLOUDS = [
  { value: "cumulus", label: "Cumulus (fair-weather heaps)" },
  { value: "stratocumulus", label: "Stratocumulus (a lumpy grey deck)" },
  { value: "stratus", label: "Stratus (a flat low grey)" },
  { value: "cirrus", label: "Cirrus (high wisps)" },
];

export const plugins = [
  {
    type: "scene:extension",
    id: "weather",
    name: "Weather",
    traits: ["weather"],
    describes: {
      weather: {
        name: "Weather",
        on: "scene",
        blurb: "This world's weather: where and when (the sun follows them), the wind ships sail in and seas raise their waves from, and the sky. Dial it in, or fetch a place's real conditions",
        fields: [
          { key: "place", label: "Place", kind: "string", default: INIT.place },
          { key: "lat", label: "Latitude (degrees north)", kind: "number", default: INIT.lat, min: -90, max: 90, step: 0.0001 },
          { key: "lon", label: "Longitude (degrees east)", kind: "number", default: INIT.lon, min: -180, max: 180, step: 0.0001 },
          { key: "zone", label: "Time zone (IANA, e.g. America/Vancouver)", kind: "string", default: INIT.zone },
          { key: "date", label: "Date (YYYY-MM-DD, local)", kind: "string", default: INIT.date },
          { key: "hour", label: "Hour (local clock)", kind: "number", default: INIT.hour, min: 0, max: 24, step: 0.25 },
          { key: "wind", label: "Wind (m/s at 10 m)", kind: "number", default: INIT.wind, min: 0, max: 30, step: 0.1 },
          { key: "from", label: "Wind from (degrees true)", kind: "number", default: INIT.from, min: 0, max: 360, step: 1 },
          { key: "gust", label: "Gusts (m/s; empty: 30% over the wind)", kind: "number", min: 0, max: 45, step: 0.1 },
          { key: "seed", label: "Gust seed", kind: "integer", default: INIT.seed },
          { key: "cover", label: "Cloud cover (0 clear, 1 overcast)", kind: "number", default: INIT.cover, min: 0, max: 1, step: 0.05 },
          { key: "clouds", label: "Clouds", kind: "enum", default: INIT.clouds, options: CLOUDS },
          { key: "base", label: "Cloud base (m)", kind: "number", default: INIT.base, min: 50, max: 12000, step: 50, log: true },
          { key: "visibility", label: "Visibility (m)", kind: "number", default: INIT.visibility, min: 100, max: 50000, step: 100, log: true },
          { key: "rain", label: "Rain (mm/h)", kind: "number", default: INIT.rain, min: 0, max: 20, step: 0.1 },
        ],
        init: INIT,
      },
    },
    async load() {
      return (await import("./extension.js")).default;
    },
  },
];
