// A stand-in for the weather package's offer of the world's wind, for
// sailing's fakes and tests. The weather package (weather/WEATHER.md, "What
// it offers") turns the scene trait `weather` into the `wind` ambient, the
// trait's own numbers passed through as { speed, from, seed, gustiness }.
// Sailing writes every field it relies on (parts.js `newWeather`: wind, from,
// seed), so this is that pass-through and nothing more: no defaults, ranges
// or clamping of the weather's, which are its own and tested there
// (weather/src/weather.test.js). A trait without a gustiness takes sailing's
// own (wind.js GUSTINESS), as a dialled one would be given. The real offer
// is checked against a boat's wind by the probes, which load the weather
// package's build (probes/sailing-run.mjs, harbour-run.mjs).
import { GUSTINESS } from "../wind.js";

/** The `wind` ambient a `weather` trait offers: its own four numbers, or null for no trait (a falsy one). */
export function windOffer(trait) {
  if (!trait) return null;
  const { wind, from, seed, gustiness = GUSTINESS } = trait;
  return { speed: wind, from, seed, gustiness };
}
