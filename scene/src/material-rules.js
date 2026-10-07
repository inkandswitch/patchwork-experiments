// Scene-level material rules (SCENE-CONTRACT v3 §9), pure. `scene.materialRules`
// is an ordered list; every rule whose `match` fits a loaded material's name
// sets some of its properties, after the GLB's own values and before the
// object's colour / opacity. Later rules win. Display state only: no rebuild.
//
//   { match: { nameIncludes: "Alum" } | { nameEquals: "Plastic" } | { unnamed: true },
//     set:   { color?, metalness?, roughness?, opacity?, emissive?, transmission? } }
//
// Matching is case-sensitive. GLTFLoader's default material (a primitive with
// no material at all) is never matched: it is drawn in the theme colour.

const HEX = /^#[0-9a-f]{6}$/i;
const UNIT_KEYS = ["metalness", "roughness", "opacity", "transmission"];
const COLOR_KEYS = ["color", "emissive"];
export const RULE_SET_KEYS = Object.freeze([...COLOR_KEYS, ...UNIT_KEYS]);

function cleanMatch(m) {
  if (!m || typeof m !== "object") return null;
  if (typeof m.nameIncludes === "string" && m.nameIncludes) return { nameIncludes: m.nameIncludes };
  if (typeof m.nameEquals === "string") return { nameEquals: m.nameEquals };
  if (m.unnamed === true) return { unnamed: true };
  return null;
}

function cleanSet(s) {
  if (!s || typeof s !== "object") return null;
  const out = {};
  for (const k of COLOR_KEYS) if (typeof s[k] === "string" && HEX.test(s[k])) out[k] = s[k].toLowerCase();
  for (const k of UNIT_KEYS) {
    const n = Number(s[k]);
    if (s[k] != null && s[k] !== "" && Number.isFinite(n)) out[k] = Math.max(0, Math.min(1, n));
  }
  return Object.keys(out).length ? out : null;
}

/** The usable rules, in order; anything malformed is dropped. */
export function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (const r of rules) {
    const match = cleanMatch(r?.match);
    const set = cleanSet(r?.set);
    if (match && set) out.push({ match, set });
  }
  return out;
}

/** Does a rule's match fit a material name? */
export function ruleMatches(match, name) {
  const n = typeof name === "string" ? name : "";
  if (match.nameIncludes != null) return n.includes(match.nameIncludes);
  if (match.nameEquals != null) return n === match.nameEquals;
  if (match.unnamed) return n === "";
  return false;
}

/** Everything the rules set on a material with this name, merged in order (later wins). */
export function resolveMaterialSet(name, rules) {
  const out = {};
  for (const r of rules) if (ruleMatches(r.match, name)) Object.assign(out, r.set);
  return out;
}

/** A stable key for a (sanitised) rule list, to tell when it changed. */
export const rulesKey = (rules) => JSON.stringify(rules ?? []);
