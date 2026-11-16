// The weather extension (WEATHER.md): the `weather` scene trait offered as
// the world's `wind` and `atmosphere` ambients (scene STAGE.md, "Ambients"),
// and the two editing commands that set where and when it is.
//
// ambient() is a pure function of the trait: the same trait gives the same
// offer on every peer, and while the trait is unchanged the offer is the same
// object (cached by the params in force, sailing's weather.js pattern), so
// the stage's per-flush merge does nothing. No trait, no offer.
//
// The commands are the editor's (`edit: true`: in no body but Edit) and the
// scene's (the null target). The scene inspector shows no scene commands
// (scene's inspector-model.js commandsFor: the null target gets none), so
// they are shown on the toolbar, which is Edit's and always in view there,
// and in the scene's menu (WEATHER.md Decision 28):
//   - Place: a picker of PLACES, plus "here" (the lat/lon in force) when
//     the weather is at none of them. Picking one writes those of place,
//     lat, lon and zone the trait doesn't already hold, in one change. Its
//     tooltip is the weather's provenance.
//   - Now: date and hour set to the present minute in the weather's zone.
// Both are package writes (api.change), so neither is on the undo stack
// (STAGE.md: only the stage's own parts have api.edit; Question 6).

import { atmosphereOf } from "./atmosphere.js";
import { localOf } from "./time.js";
import { PLACES, placeOf, provenance, weatherParams, windOf } from "./weather.js";

/** The trait this extension reads. */
export const TRAIT = "weather";

/** The Place picker's value for "the lat/lon in force, at none of PLACES". */
export const HERE = "here";

/** Where the commands are shown (the inspector would be the first choice: Decision 28). */
export const SHOW = Object.freeze(["toolbar", "menu"]);

const MINUTE = 60_000;
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** What a weather trait offers: { wind, atmosphere }, plain JSON; null for no trait. Pure. */
export function offerOf(trait) {
  if (!trait) return null;
  const p = weatherParams(trait);
  return { wind: windOf(p), atmosphere: atmosphereOf(p) };
}

/** A lat/lon as people read it: "48.4540° N, 123.2915° W". */
export const coordinates = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? "W" : "E"}`;

/** A string the trait's source gives, or null (a peer wrote it: it is only ever shown as text). */
const text = (v) => (typeof v === "string" && v ? v : null);

/** The Place command's tooltip: where the weather in force came from (provenance, said). */
export function provenanceTitle(trait) {
  const s = isMap(trait?.source) ? trait.source : {};
  const from = `${text(s.name) ?? "an unnamed source"}${text(s.api) ? ` (${s.api})` : ""}${text(s.for) ? ` for ${s.for}` : ""}`;
  switch (provenance(trait)) {
    case "fetched":
      return `Weather: as fetched from ${from}`;
    case "dialled since fetch":
      return `Weather: dialled since it was fetched from ${from}`;
    default:
      return "Weather: dialled by hand";
  }
}

/** The Place command's state for a trait: the picker (PLACES, and "here" when at none), or null without a trait to write into. */
export function placeState(trait) {
  if (!isMap(trait)) return null;
  const p = weatherParams(trait);
  const at = placeOf(p);
  const choices = PLACES.map((q) => ({ value: q.place, label: q.place }));
  if (!at) choices.push({ value: HERE, label: coordinates(p.lat, p.lon) });
  return { value: at ? at.place : HERE, choices, title: provenanceTitle(trait) };
}

/** The fields of `want` the trait doesn't already hold as they are. */
const differing = (trait, want) => Object.fromEntries(Object.entries(want).filter(([k, v]) => !Object.hasOwn(trait, k) || trait[k] !== v));

/** What picking `value` on the Place picker writes: those of place, lat, lon and zone that differ; {} for "here" or an unknown value; null without a trait. */
export function placeWrites(trait, value) {
  if (!isMap(trait)) return null;
  const q = PLACES.find((x) => x.place === value);
  return q ? differing(trait, { place: q.place, lat: q.lat, lon: q.lon, zone: q.zone }) : {};
}

/**
 * What Now writes at instant `t`: date and hour of the present minute in the
 * weather's zone (localOf, the minute floored, so the hour is a whole number
 * of minutes and never reaches 24), those that differ; null without a trait.
 */
export function nowWrites(trait, t) {
  if (!isMap(trait)) return null;
  const { date, hour } = localOf(Math.floor(t / MINUTE) * MINUTE, weatherParams(trait).zone);
  return differing(trait, { date, hour });
}

export default {
  create(api) {
    const trait = () => api.doc()?.traits?.[TRAIT];

    /** Write fields into the trait, one change, field by field; nothing to write, or no trait by then, writes nothing. */
    function write(fields) {
      if (!fields || !Object.keys(fields).length) return;
      api.change((d) => {
        const w = d.traits?.[TRAIT];
        if (!isMap(w)) return;
        for (const [k, v] of Object.entries(fields)) w[k] = v;
      });
    }

    let key;
    let offer = null;
    return {
      ambient() {
        const t = trait();
        const k = t ? JSON.stringify(weatherParams(t)) : null;
        if (k !== key) {
          key = k;
          offer = offerOf(t);
        }
        return offer;
      },
      commands: [
        {
          id: "place",
          name: "Place",
          edit: true,
          show: SHOW,
          state: (target) => (target == null ? placeState(trait()) : null),
          run(target, value) {
            if (target == null) write(placeWrites(trait(), value));
          },
        },
        {
          id: "now",
          name: "Now",
          edit: true,
          show: SHOW,
          state: (target) => {
            const t = trait();
            return target == null && isMap(t) ? { title: `Set the weather's date and hour to the present in ${weatherParams(t).zone}` } : null;
          },
          run(target) {
            if (target == null) write(nowWrites(trait(), Date.now()));
          },
        },
      ],
    };
  },
};
