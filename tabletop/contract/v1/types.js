// tabletop-game v1: the readable type definitions (JSDoc), and the few
// constants a producer and a consumer share. Plain JS with no imports, so a
// consumer can copy this file whole (packages never import each other).
//
// GAME-FORMAT.md is the contract; schema.json is its structural part;
// validate.js applies both. Lengths are metres, rotations Euler XYZ in
// radians, Y up, right-handed: the scene's frame.

export const FORMAT = "tabletop-game";
export const VERSION = 1;
export const PART_SHAPES = ["box", "frustum", "lathe", "slab", "model"];
export const OUTLINES = ["rect", "rounded", "hex", "circle", "cutout"];
export const BAG_RULES = ["random", "random-replace", "top"];
export const TURNS = [0, 90, 180, 270];

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {string} Kind  a piece's id: [A-Za-z0-9][A-Za-z0-9._-]* */

/**
 * @typedef {object} Game
 * @property {"tabletop-game"} format
 * @property {1} version
 * @property {string} title
 * @property {string} about            plain text for the players; never enforced
 * @property {string} [players]
 * @property {Object<Kind, Piece>} pieces
 * @property {Thing[]} setup
 * @property {Object<string, Seat>} [seats]
 * @property {Camera} [camera]
 * @property {object} [origin]         where it came from (free form)
 */

/** @typedef {{ position: Vec3, target: Vec3 }} Camera */
/** @typedef {{ name: string, camera?: Camera }} Seat */
/** @typedef {{ position: Vec3, rotation?: Vec3 }} Pose */

/**
 * @typedef {object} Piece
 * @property {string} name
 * @property {Part[]} [parts]          drawn from parts, or…
 * @property {{ "@patchwork": { type: string } }} [doc]   …as a document of that type
 * @property {Kind} [back]             a card: kept, drawn as this piece on the table
 * @property {boolean} [locked]
 * @property {string[]} [tags]
 * @property {{ position: Vec3, rotation?: Vec3, tags?: string[] }[]} [snapPoints]
 * @property {number} [snapRadius]
 * @property {{ min: Vec3, max: Vec3 }} [zone]   a hand, when placed for a seat
 * @property {{ rule: "random" | "random-replace" | "top" }} [bag]
 * @property {Object<string, object>} [traits]
 */

/**
 * Every part may have at (its base centre), rotation (about at), color, roughness, metalness, name.
 * @typedef {(
 *   { shape: "box", size: Vec3 } |
 *   { shape: "frustum", bottom: [number, number], top: [number, number], height: number } |
 *   { shape: "lathe", profile: [number, number][], segments?: number } |
 *   { shape: "slab", outline: "rect" | "rounded" | "hex" | "circle" | "cutout", size: [number, number], thickness: number, top?: Image, bottom?: Image, side?: string } |
 *   { shape: "model", file: string, texture?: string, matrix?: number[] }
 * ) & { at?: Vec3, rotation?: Vec3, color: string, roughness?: number, metalness?: number, name?: string }} Part
 */

/** @typedef {{ file: string, rect?: [number, number, number, number], turn?: 0 | 90 | 180 | 270 }} Image */

/**
 * @typedef {(
 *   { piece: Kind, id?: string, name?: string, at?: Pose, count?: number, grid?: { cols: number, across: Vec3, down: Vec3 }, seat?: string, contents?: Thing[] } |
 *   { deck: Deck, id?: string, at?: Pose }
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
