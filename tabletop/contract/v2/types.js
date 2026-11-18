// tabletop-game v2: the readable type definitions (JSDoc), and the few
// constants a producer and a consumer share. Plain JS with no imports, so a
// consumer can copy this file whole (packages never import each other).
//
// GAME-FORMAT.md is the contract; schema.json is its structural part;
// validate.js applies both. Lengths are metres, rotations Euler XYZ in
// radians, Y up, right-handed: the scene's frame.

export const FORMAT = "tabletop-game";
export const VERSION = 2;
export const PART_SHAPES = ["box", "frustum", "lathe", "slab", "model"];
export const OUTLINES = ["rect", "rounded", "hex", "circle", "cutout"];
export const BAG_RULES = ["random", "random-replace", "top"];
export const TURNS = [0, 90, 180, 270];

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {string} Kind  a piece's id: [A-Za-z0-9][A-Za-z0-9._-]* */

/**
 * @typedef {object} Game
 * @property {"tabletop-game"} format
 * @property {2} version
 * @property {string} title
 * @property {string} about            plain text for the players; never enforced
 * @property {string} [players]
 * @property {Object<Kind, Piece>} pieces
 * @property {Thing[]} setup
 * @property {Object<string, Seat>} [seats]
 * @property {Camera} [camera]
 * @property {object} [origin]         where it came from (free form)
 * @property {Object<string, { file: string }>} [assets]   a web asset (keyed by its http(s) URL) → the file doc it's cached in
 * @property {Recipe} [recipe]        how the setup is adapted to a new game's options, and started (recipe.js)
 */

/**
 * A game's setup recipe (GAME-FORMAT.md §6). A condition is one comparison on an option: "players >= 3", "extras".
 * @typedef {{ options?: Option[], spots?: Object<string, Pose>, layout?: LayoutStep[], start?: StartStep[] }} Recipe
 * @typedef {(
 *   { kind: "integer", key: string, label: string, min: number, max: number, default: number } |
 *   { kind: "enum", key: string, label: string, options: { value: string | number, label: string }[], default: string | number } |
 *   { kind: "boolean", key: string, label: string, default: boolean }
 * )} Option
 * @typedef {{ when?: string, unless?: string }} Condition
 * @typedef {Pose | string} At   a pose, or a spot's name
 * @typedef {Condition & (
 *   { remove: { id: string } | { tag: string } | { seat: string } } |
 *   { place: Object<string, At | { state: string, at?: At }> } |   // where, or which state it shows (and where)
 *   { seats: Object<string, At> } |
 *   { kit: Thing[] }
 * )} LayoutStep
 * @typedef {Condition & (
 *   { shuffle: string } | { deal: string, count: number } | { draw: string, count: number, to: string } | { first: true }
 * )} StartStep
 */

/** @typedef {{ position: Vec3, target: Vec3 }} Camera */
/** @typedef {{ name: string, at?: Pose, camera?: Camera }} Seat   at: its area (where a kit is laid, +Z toward its player) */
/** @typedef {{ position: Vec3, rotation?: Vec3 }} Pose */

/**
 * @typedef {object} Piece
 * @property {string} name
 * @property {Part[]} [parts]          drawn from parts, or…
 * @property {{ "@patchwork": { type: string } }} [doc]   …as a document of that type
 * @property {State[]} [states]       other looks it can be turned to (its own is called by its name); never a card's, nor a back's
 * @property {Kind} [back]             a card: kept, drawn as this piece on the table
 * @property {boolean} [locked]
 * @property {string[]} [tags]
 * @property {{ position: Vec3, rotation?: Vec3, tags?: string[] }[]} [snapPoints]
 * @property {number} [snapRadius]
 * @property {{ min: Vec3, max: Vec3 }} [zone]   a hand, when placed for a seat
 * @property {{ rule: "random" | "random-replace" | "top" }} [bag]
 * @property {Object<string, object>} [traits]
 */

/** Another look a piece can show: named, drawn as a piece's look is; its own snap points, else the piece's. */
/** @typedef {{ name: string, parts?: Part[], doc?: { "@patchwork": { type: string } }, snapPoints?: { position: Vec3, rotation?: Vec3, tags?: string[] }[] }} State */

/**
 * Every part may have at (its base centre), rotation (about at), color, roughness, metalness, name.
 * @typedef {(
 *   { shape: "box", size: Vec3 } |
 *   { shape: "frustum", bottom: [number, number], top: [number, number], height: number } |
 *   { shape: "lathe", profile: [number, number][], segments?: number } |
 *   { shape: "slab", outline: "rect" | "rounded" | "hex" | "circle" | "cutout", size: [number, number], thickness: number, aspect?: "image", top?: Image, bottom?: Image, side?: string } |
 *   { shape: "model", file: string, texture?: string, matrix?: number[] }
 * ) & { at?: Vec3, rotation?: Vec3, color: string, roughness?: number, metalness?: number, name?: string }} Part
 */

/** An asset is named by its file doc (`automerge:`) or where it is on the web (`http(s)`, cached through the game's `assets`). */
/** @typedef {{ file: string, rect?: [number, number, number, number], turn?: 0 | 90 | 180 | 270 }} Image */

/**
 * @typedef {(
 *   { piece: Kind, id?: string, name?: string, tags?: string[], at?: Pose, state?: string, count?: number, grid?: { cols: number, across: Vec3, down: Vec3 }, seat?: string, contents?: Thing[] } |
 *   { deck: Deck, id?: string, tags?: string[], at?: Pose }
 * )} Thing
 */

/**
 * @typedef {object} Deck
 * @property {string} name
 * @property {Kind[]} cards            top first
 * @property {boolean} [faceDown]
 * @property {boolean} [shuffle]
 * @property {boolean} [secure]
 * @property {{ to: string, count: number }[]} [deal]
 * @property {{ cols: number, cell: number }} [spread]
 */
