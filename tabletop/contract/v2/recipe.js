// tabletop-game v2: a game's setup recipe (GAME-FORMAT.md §6), as data.
//
//   recipe: { options?, spots?, layout?, start? }
//
// `options` are what a new game asks (how many play, which expansion…);
// `layout` steps adapt the setup to them when a table is made (pure: the
// game and the options' values → the game as it is laid out, nothing
// hidden); `start` steps are what the table's Start game does once every
// seat is taken (they shuffle, deal and choose, through the keepers). A
// step's `when` / `unless` is one comparison on an option ("players >= 3"),
// never more: anything a game needs past that is a scripted step, later.
//
//   optionValues(game, given)  → every option's value (its default where not given), or null if one is no value of it
//   applyRecipe(game, given)   → the game laid out as those values say (layout run, kits laid, states chosen, its start steps
//                                that apply), with no options or layout of its own: a game like any other
//   combinations(game)         → every set of values its options can take (the validator checks each)
//   describeOptions(game, v)   → "3 players, Pre-made Rangers": a session's name
//
// No imports, so a consumer can copy this folder whole (validate.js imports it).

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const tidy = (v) => Math.round(Number(v) * 1e6) / 1e6 + 0;
const ZERO = [0, 0, 0];

// ───────────────────────────────── options

/** The options a game asks, as listed (an empty list for none). */
export const optionsOf = (game) => (Array.isArray(game?.recipe?.options) ? game.recipe.options : []);

/** A value given for an option, as the option's own (an integer, one of its values, a boolean), or undefined if it's none. */
export function coerce(option, v) {
  if (v === undefined || v === null) return undefined;
  switch (option?.kind) {
    case "integer": {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      return Number.isInteger(n) && n >= option.min && n <= option.max ? n : undefined;
    }
    case "enum": {
      const hit = (option.options ?? []).find((o) => String(o.value) === String(v));
      return hit ? hit.value : undefined;
    }
    case "boolean":
      return v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;
    default:
      return undefined;
  }
}

/** Every option's value: what's given, else its default. null when a given value (or a default) is no value of its option. */
export function optionValues(game, given = {}) {
  const out = {};
  for (const o of optionsOf(game)) {
    const v = coerce(o, given?.[o.key] !== undefined ? given[o.key] : o.default);
    if (v === undefined) return null;
    out[o.key] = v;
  }
  return out;
}

/** What's wrong with the values given, in words, or null. */
export function optionsProblem(game, given = {}) {
  for (const o of optionsOf(game)) {
    const v = given?.[o.key] !== undefined ? given[o.key] : o.default;
    if (coerce(o, v) === undefined) return `${JSON.stringify(v)} is no value of “${o.label ?? o.key}”`;
  }
  return null;
}

/** The values an option can take, in order. */
export function valuesOf(option) {
  if (option?.kind === "integer") return Array.from({ length: Math.max(0, option.max - option.min + 1) }, (_, i) => option.min + i);
  if (option?.kind === "enum") return (option.options ?? []).map((o) => o.value);
  if (option?.kind === "boolean") return [false, true];
  return [];
}

/** How many values an option can take, counted, never listed (an integer's range may be any size before it's checked). */
const countOf = (o) => (o?.kind === "integer" ? Math.max(0, o.max - o.min + 1) : o?.kind === "enum" ? (o.options ?? []).length : o?.kind === "boolean" ? 2 : 0);

/** How many sets of values the options can take. */
export const combinationCount = (game) => optionsOf(game).reduce((n, o) => n * countOf(o), 1);

/**
 * What laying out and checking one set of values costs, an upper bound in
 * things handled: every thing the setup holds (bags' contents and decks'
 * cards too), every seat and its kits, once for each layout and start step
 * and once more; every name a step lists; and the game copied whole (a
 * thing for every 4 characters of it: its pieces, its assets). The validator
 * lays out and checks every set, so it bounds this times combinationCount.
 */
export function layoutCost(game) {
  const r = game?.recipe ?? {};
  let things = 0;
  for (const list of lists(Array.isArray(game?.setup) ? game.setup : [])) for (const t of list) things += 1 + (Array.isArray(t?.deck?.cards) ? t.deck.cards.length : 0);
  let kits = 0;
  let named = 0;
  for (const s of r.layout ?? []) {
    if (Array.isArray(s?.kit)) kits += s.kit.length;
    named += Object.keys(s?.place ?? {}).length + Object.keys(s?.seats ?? {}).length;
  }
  const seats = Math.max(1, Object.keys(game?.seats ?? {}).length);
  return (things + (kits + 1) * seats) * ((r.layout?.length ?? 0) + (r.start?.length ?? 0) + 1) + named + Math.ceil(JSON.stringify(game ?? null).length / 4);
}

/** Every set of values the options can take, the first option slowest. */
export function combinations(game) {
  let out = [{}];
  for (const o of optionsOf(game)) out = out.flatMap((c) => valuesOf(o).map((v) => ({ ...c, [o.key]: v })));
  return out;
}

/** The values as words, for a session's name: "3 players", an enum's label, a boolean's label when it's on. */
export function describeOptions(game, values) {
  const words = [];
  for (const o of optionsOf(game)) {
    const v = values?.[o.key];
    if (o.kind === "integer") words.push(`${v} ${String(o.label ?? o.key).toLowerCase()}`);
    else if (o.kind === "enum") words.push((o.options ?? []).find((x) => x.value === v)?.label ?? String(v));
    else if (o.kind === "boolean" && v) words.push(o.label ?? o.key);
  }
  return words.join(", ");
}

// ───────────────────────────────── conditions

const COND = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?:(==|!=|<=|>=|<|>)\s*('[^']*'|"[^"]*"|[^\s'"]+))?\s*$/;

/** A condition's parts: { key, op, literal } (op and literal null for a bare boolean option), or null if it isn't one. */
export function parseCondition(s) {
  const m = typeof s === "string" ? COND.exec(s) : null;
  if (!m) return null;
  const lit = m[3] == null ? null : m[3].replace(/^(['"])(.*)\1$/, "$2");
  return { key: m[1], op: m[2] ?? null, literal: lit };
}

/**
 * What's wrong with a condition, against a game's options, or null: it names
 * an option; a bare one is a boolean option's; a comparison compares with one
 * of the option's values (an order, < <= > >=, only an integer's).
 */
export function conditionProblem(s, options) {
  const c = parseCondition(s);
  if (!c) return `"${s}" isn't a condition: write an option, or an option, a comparison (== != < <= > >=) and a value`;
  const o = options.find((x) => x?.key === c.key);
  if (!o) return `no option "${c.key}"`;
  if (c.op == null) return o.kind === "boolean" ? null : `"${c.key}" isn't a boolean option: compare it with a value`;
  if (/[<>]/.test(c.op) && o.kind !== "integer") return `only an integer option is ordered: "${c.key}" is ${o.kind === "enum" ? "a choice" : "a boolean"}`;
  if (coerce(o, c.literal) === undefined && !(o.kind === "integer" && Number.isInteger(Number(c.literal)))) return `"${c.literal}" is no value of "${c.key}"`;
  return null;
}

/** Does a condition hold for these values? (A condition that isn't one holds for none.) */
export function holds(s, values, options) {
  const c = parseCondition(s);
  const o = c && options.find((x) => x?.key === c.key);
  if (!o) return false;
  const v = values?.[c.key];
  if (c.op == null) return v === true;
  const w = o.kind === "integer" ? Number(c.literal) : coerce(o, c.literal);
  switch (c.op) {
    case "==":
      return v === w;
    case "!=":
      return v !== w;
    case "<":
      return v < w;
    case "<=":
      return v <= w;
    case ">":
      return v > w;
    case ">=":
      return v >= w;
    default:
      return false;
  }
}

/** Does a step apply for these values: its `when` holds and its `unless` doesn't. */
export const applies = (step, values, options) => (step?.when == null || holds(step.when, values, options)) && (step?.unless == null || !holds(step.unless, values, options));

// ───────────────────────────────── poses (Euler XYZ, the scene's frame)

function matrix(p) {
  const r = p?.rotation ?? ZERO;
  const [a, b, c, d, e, f] = [Math.cos(r[0]), Math.sin(r[0]), Math.cos(r[1]), Math.sin(r[1]), Math.cos(r[2]), Math.sin(r[2])];
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // rows of R = Rx·Ry·Rz, and the position
  return { R: [[c * e, -c * f, d], [af + be * d, ae - bf * d, -b * c], [bf - ae * d, be + af * d, a * c]], t: (p?.position ?? ZERO).map(Number) };
}
const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const rot = (R, v) => R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
function euler(R) {
  const y = Math.asin(Math.max(-1, Math.min(1, R[0][2])));
  if (Math.abs(R[0][2]) < 0.9999999) return [Math.atan2(-R[1][2], R[2][2]), y, Math.atan2(-R[0][1], R[0][0])];
  return [Math.atan2(R[2][1], R[1][1]), y, 0];
}
const level = (r) => !Number(r?.[0]) && !Number(r?.[2]);

/**
 * A pose inside another, as setup.js composes one: a turn about Y followed by
 * one with no tilt about X adds exactly, so a level table's numbers stay as
 * written; anything else goes through matrices.
 */
export function composePose(outer, local) {
  const O = matrix(outer);
  const lp = (local?.position ?? ZERO).map(Number);
  const lr = (local?.rotation ?? ZERO).map(Number);
  const position = rot(O.R, lp).map((v, k) => tidy(v + O.t[k]));
  const or = (outer?.rotation ?? ZERO).map(Number);
  if (level(or) && !lr[0]) return { position, rotation: [0, or[1] + lr[1] + 0, lr[2] + 0] };
  return { position, rotation: euler(mul(O.R, matrix(local).R)).map((v) => Math.round(v * 1e9) / 1e9 + 0) };
}

/** The pose that undoes `p`: composePose(inverse(p), composePose(p, x)) is x. */
export function inversePose(p) {
  const r = (p?.rotation ?? ZERO).map(Number);
  const pos = (p?.position ?? ZERO).map(Number);
  if (level(r)) {
    const [c, s] = [Math.cos(-r[1]), Math.sin(-r[1])];
    return { position: [tidy(-(c * pos[0] + s * pos[2])), tidy(-pos[1]), tidy(-(-s * pos[0] + c * pos[2]))], rotation: [0, -r[1] + 0, 0] };
  }
  const { R } = matrix(p);
  const T = [0, 1, 2].map((i) => [R[0][i], R[1][i], R[2][i]]);
  return { position: rot(T, pos).map((v) => tidy(-v)), rotation: euler(T) };
}

/** A pose as the format writes it: its rotation left out when it's none. */
const pose = (p) => ({ position: p.position, ...(p.rotation.some((x) => x !== 0) ? { rotation: p.rotation } : {}) });

// ───────────────────────────────── layout

/** Every list of things in a setup (its own, then each bag's contents), with each thing: [list, index]. */
function* lists(things) {
  yield things;
  for (const t of things) if (Array.isArray(t?.contents)) yield* lists(t.contents);
}
/** Take out of a setup every thing (contents too) that `drop` says. */
function removeWhere(setup, drop) {
  for (const list of lists(setup)) for (let i = list.length - 1; i >= 0; i--) if (drop(list[i])) list.splice(i, 1);
}

/** A step's `at`: a pose, or a spot's name. */
const placeOf = (at, spots) => copy(typeof at === "string" ? spots?.[at] : at);

/**
 * The game laid out as the recipe says for these values (GAME-FORMAT.md §6):
 * its layout steps that apply, in order (`remove`, `place`, `seats`), then
 * its kits at each seat's area as it ends up; and its start steps that
 * apply, kept as its recipe's `start` (with no conditions) for the table to
 * run. No options, spots or layout are left: what comes back is a game with
 * nothing to choose. A game without a recipe comes back as it is. Pure.
 * @returns {object | null}  null when a value given is no value of its option
 */
export function applyRecipe(game, given = {}) {
  const recipe = game?.recipe;
  if (!recipe) return copy(game);
  const values = optionValues(game, given);
  if (!values) return null;
  const options = optionsOf(game);
  const g = copy(game);
  const setup = g.setup ?? [];
  const seats = g.seats ?? {};
  const kits = [];
  for (const step of recipe.layout ?? []) {
    if (!applies(step, values, options)) continue;
    if (step.remove) {
      const r = step.remove;
      if (r.seat != null) {
        delete seats[r.seat];
        removeWhere(setup, (t) => t?.seat === r.seat);
      } else if (r.id != null) removeWhere(setup, (t) => t?.id === r.id);
      else if (r.tag != null) removeWhere(setup, (t) => Array.isArray(t?.tags) && t.tags.includes(r.tag));
    } else if (step.place) {
      // one walk, whatever the step names: each thing there is laid where it says, where it was in the setup's
      // order, or out of its bag onto the table (after the rest, in the step's order); one given a state shows it
      // (and stays where it is, unless it's given somewhere too)
      const to = new Map();
      for (const [id, v] of Object.entries(step.place)) {
        const turned = !!v && typeof v === "object" && "state" in v;
        const at = turned ? (v.at == null ? null : placeOf(v.at, recipe.spots)) : placeOf(v, recipe.spots);
        if (at || turned) to.set(id, { at, state: turned ? v.state : null });
      }
      const hits = [];
      for (const list of lists(setup)) list.forEach((t, i) => to.has(t?.id) && hits.push([list, i, t]));
      const out = new Map();
      // (each list's last first, so a splice leaves the indices before it as they were)
      for (const [list, i, t] of hits.reverse()) {
        const { at, state } = to.get(t.id);
        if (state != null) t.state = state;
        if (!at) continue;
        t.at = at;
        if (list !== setup) out.set(t.id, list.splice(i, 1)[0]);
      }
      for (const id of to.keys()) if (out.has(id)) setup.push(out.get(id));
    } else if (step.seats) {
      for (const [sid, at] of Object.entries(step.seats)) {
        const seat = seats[sid];
        const to = placeOf(at, recipe.spots);
        if (!seat?.at || !to) continue;
        // everything that's the seat's moves with it, rigidly: its hands, its camera
        const back = inversePose(seat.at);
        const move = (p) => pose(composePose(to, composePose(back, p)));
        for (const t of setup) if (t?.seat === sid) t.at = move(t.at ?? { position: ZERO });
        if (seat.camera) seat.camera = { position: move({ position: seat.camera.position }).position, target: move({ position: seat.camera.target }).position };
        seat.at = pose(composePose(to, { position: ZERO }));
      }
    } else if (step.kit) kits.push(step.kit);
  }
  // each kit, at each seat's area as it ends up: its ids the seat's, its hands the seat's
  for (const kit of kits) {
    for (const [sid, seat] of Object.entries(seats)) {
      if (!seat?.at) continue;
      for (const t0 of kit) {
        const t = copy(t0);
        t.at = pose(composePose(seat.at, t.at ?? { position: ZERO }));
        if (t.id != null) t.id = `${t.id}.${sid}`;
        if (typeof t.name === "string") t.name = t.name.replaceAll("{seat}", seat.name ?? sid);
        if (t.piece != null && g.pieces?.[t.piece]?.zone) t.seat = sid;
        setup.push(t);
      }
    }
  }
  g.setup = setup;
  if (Object.keys(seats).length) g.seats = seats;
  else delete g.seats;
  const start = (recipe.start ?? []).filter((s) => applies(s, values, options)).map(({ when, unless, ...s }) => s);
  g.recipe = { start };
  return g;
}
