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
// scene's (the null target), and only the world's: a linked world's weather
// is not in force (the outermost rule), so its commands don't apply there
// (Decision 31). The scene inspector shows no scene commands (scene's
// inspector-model.js commandsFor: the null target gets none), so they are
// shown on the toolbar, which is Edit's and always in view there, and in the
// scene's menu (WEATHER.md Decision 28):
//   - Place: a picker of PLACES, plus the coordinates in force when the
//     weather is at none of them. Picking a place writes those of its lat,
//     lon and clock the trait doesn't already hold, in one change. Its
//     tooltip is the weather's provenance.
//   - Now: date and hour set to the present quarter hour on the weather's
//     clock.
// Both are package writes (api.change), so neither is on the undo stack
// (STAGE.md: only the stage's own parts have api.edit; Question 6).

import { atmosphereOf } from "./atmosphere.js";
import { localOf } from "./time.js";
import { FIELDS, PLACES, dialledSince, placeOf, provenance, weatherParams, windOf } from "./weather.js";

/** The trait this extension reads. */
export const TRAIT = "weather";

/** The Place picker's value for "the lat/lon in force, at none of PLACES": a read-out; picking it writes nothing. */
export const HERE = "here";

/** Where the commands are shown (the inspector would be the first choice: Decision 28). */
export const SHOW = Object.freeze(["toolbar", "menu"]);

/** The hour slider's step (index.js), in ms: what Now floors the present to. */
const STEP = FIELDS.find((f) => f.key === "hour").step * 3_600_000;
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
      return `Weather: dialled since it was fetched from ${from} (${dialledSince(trait).join(", ")})`;
    default:
      return "Weather: dialled by hand";
  }
}

/** The Place command's state for a trait: the picker (PLACES, and "here" when at none), or null without a trait to write into. */
export function placeState(trait) {
  if (!isMap(trait)) return null;
  const p = weatherParams(trait);
  const at = placeOf(p);
  const choices = PLACES.map((q) => ({ value: q.name, label: q.name }));
  if (!at) choices.push({ value: HERE, label: coordinates(p.lat, p.lon) });
  return { value: at ? at.name : HERE, choices, title: provenanceTitle(trait) };
}

/** The fields of `want` the trait doesn't already hold as they are. */
const differing = (trait, want) => Object.fromEntries(Object.entries(want).filter(([k, v]) => !Object.hasOwn(trait, k) || trait[k] !== v));

/**
 * What picking `value` on the Place picker writes: those of the place's lat,
 * lon and clock that differ (the date and hour stay: the same time of day,
 * there); {} for "here" or an unknown value; null without a trait.
 */
export function placeWrites(trait, value) {
  if (!isMap(trait)) return null;
  const q = PLACES.find((x) => x.name === value);
  return q ? differing(trait, { lat: q.lat, lon: q.lon, offset: q.offset }) : {};
}

/**
 * What Now writes at instant `t`: date and hour of the present quarter hour
 * on the weather's clock (localOf, floored to the hour slider's step, so
 * Now writes only values the slider can show, and the hour never reaches
 * 24), those that differ; null without a trait.
 */
export function nowWrites(trait, t) {
  if (!isMap(trait)) return null;
  const { offset } = weatherParams(trait);
  const { date, hour } = localOf(Math.floor(t / STEP) * STEP, offset);
  return differing(trait, { date, hour });
}

/** A clock as people read it: "UTC−7", "UTC+5:45", "UTC". */
export function clockName(offset) {
  if (offset === 0) return "UTC";
  const m = Math.round(Math.abs(offset) * 60);
  return `UTC${offset < 0 ? "\u2212" : "+"}${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""}`;
}

/**
 * Whether this stage's weather is the world's: the outermost stage's
 * (STAGE.md "Ambients": api.ambient's `mine`). A linked world's weather is
 * not in force, so its commands would write a weather nothing shows.
 */
export const isWorlds = (api) => api.ambient?.("wind")?.mine === true;

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
        const k = t ? JSON.stringify(weatherParams(t)) : null; // the offer's own condition: no trait, no offer
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
          state: (target) => (target == null && isWorlds(api) ? placeState(trait()) : null),
          run(target, value) {
            if (target == null && isWorlds(api)) write(placeWrites(trait(), value));
          },
        },
        {
          id: "now",
          name: "Now",
          edit: true,
          show: SHOW,
          state: (target) => {
            const t = trait();
            return target == null && isWorlds(api) && isMap(t) ? { title: `Set the weather's date and hour to the present quarter hour on its clock (${clockName(weatherParams(t).offset)})` } : null;
          },
          run(target) {
            if (target == null && isWorlds(api)) write(nowWrites(trait(), Date.now()));
          },
        },
      ],
    };
  },
};
