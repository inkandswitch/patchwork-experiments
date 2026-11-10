// patchwork-rig v1: the readable type definitions (JSDoc), and the few
// constants a producer and a consumer share. Plain JS with no imports, so a
// consumer can copy this file whole (packages never import each other).
//
// specification.md is the contract; schema.json is its structural part;
// validate.js applies both. Every length is metres, every point is
// [x, y, z] in the contract frame (x forward, y port, z up; the floated
// waterplane is z = 0). Field suffixes say the unit, as Chartroom's do:
// M metres, M2 m², M3 m³, Kg kilograms, N newtons, Nm newton-metres,
// Ms metres per second, Deg degrees. A field with no suffix is a ratio or
// a coefficient.

export const FORMAT = "patchwork-rig";
export const VERSION = 1;
export const AXES = "x-forward-y-port-z-up";
export const RULES = "contract/v1/specification.md §6";

export const RIG_TYPES = ["masthead", "fractional", "cat", "cutter"];
export const SAIL_IDS = ["main", "jib", "staysail"];
export const SAIL_MODELS = ["main", "jib", "staysail"];
export const APPENDAGE_IDS = ["keel", "rudder"];
export const ITEM_KINDS = ["lightship", "ballast", "rig", "appendage", "crew"];
export const CREW_MODES = ["none", "sitting", "rail", "hiking", "trapeze"];
export const HULL_KINDS = ["linked", "synthetic"];
export const LINK_PATHS = ["render", "file", "source"];
export const STATICS_FROM = ["chartroom-table", "mesh", "gm"];
export const REGIMES = ["displacement", "transition", "planing", "beyond"];
/** §6.7. A consumer's agreement test skips any point that carries one. */
export const FLAG_IDS = ["no-equilibrium", "over-heel", "helm", "rudder-stall", "keel-stall", "beyond", "planing-range", "dsyhs"];
/** The standing rigging's ids (§3.8). */
export const STAY_IDS = ["forestay", "backstay", "inner-forestay", "cap-shroud-port", "cap-shroud-starboard", "lower-shroud-port", "lower-shroud-starboard"];

/** @typedef {[number, number, number]} Vec3 */

/**
 * @typedef {object} RigContract
 * @property {"patchwork-rig"} format
 * @property {1} version
 * @property {string} name
 * @property {Frame} frame
 * @property {Source} source
 * @property {Hull} hull
 * @property {Loading} loading
 * @property {Appendage[]} appendages
 * @property {Sail[]} sails
 * @property {SailModel} sailModel
 * @property {SailSet[]} sets
 * @property {Rig} rig
 * @property {Resistance} resistance
 * @property {Hardpoints} hardpoints
 * @property {Loads|null} loads
 * @property {Predicted} predicted
 * @property {LumpedSail|null} lumpedSail
 * @property {string[]} warnings
 * @property {string} rules
 */

/**
 * @typedef {object} Frame
 * @property {"x-forward-y-port-z-up"} axes
 * @property {"m"} units
 * @property {string} originDescription
 * @property {number[]} glbToFrame column-major 4×4: the hull's (and this rig GLB's) glTF coordinates → this frame
 * @property {{ bow: "+X"|"-X"|"+Z"|"-Z", up: "+Y"|"+Z" }} glbAxes the choice glbToFrame was made from
 * @property {{ heelDeg: 0, trimDeg: 0, waterplaneZM: 0, sourceWaterplaneZM: number, displacementKg: number, volumeM3: number, rhoWaterKgM3: number }} design
 */

/**
 * @typedef {object} Source
 * @property {string} generator
 * @property {string|null} rigDoc
 * @property {string[]|null} rigHeads
 * @property {{ kind: "linked"|"synthetic", url: string|null, path: "render"|"file"|"source"|null, label: string, heads: string[]|null, glbKey: string|null }} hull
 * @property {"chartroom-table"|"mesh"|"gm"} statics
 */

/**
 * @typedef {object} Hull
 * @property {number} loaM @property {number} beamM @property {number} lwlM @property {number} bwlM @property {number} tcM
 * @property {number} xFwdM @property {number} xAftM
 * @property {number} volumeM3 canoe body at the design waterplane
 * @property {number} wsaM2 canoe body's wetted skin, transom excluded @property {number} transomWetM2
 * @property {number} awM2 @property {number} lcbM @property {number|null} lcfM @property {number} vcbM
 * @property {number} cp @property {number} cm @property {number} cb @property {number|null} zMetacentreM @property {number|null} halfEntranceDeg
 * @property {Vec3} stemheadM @property {Vec3} sternM @property {number} keelZM
 * @property {{ areaM2: number, centroidM: Vec3|null }} lateral
 * @property {{ yv: number, nv: number, lwlM: number, xMidM: number, atM: Vec3, source: string }} sideForce
 * @property {{ lwlM: number, bwlM: number, tcM: number, volumeM3: number, awM2: number, cp: number, cm: number, lcbFppM: number, lcfFppM: number|null, lcbPct: number, wsaM2: number }} dsyhs
 * @property {{ param: string, label: string, value: number|null, min: number, max: number }[]} envelope
 * @property {"mesh"|"synthetic"} prov
 */

/**
 * @typedef {object} MassItem
 * @property {string} id @property {string} name
 * @property {"lightship"|"ballast"|"rig"|"appendage"|"crew"} kind
 * @property {number} massKg @property {Vec3} atM @property {boolean} estimated
 */

/**
 * @typedef {object} Loading
 * @property {number} massKg @property {Vec3} cgM
 * @property {Vec3} gyradiiM about the CG: roll (x), pitch (y), yaw (z)
 * @property {string} gyradiiBasis
 * @property {MassItem[]} items
 * @property {{ count: number, kgEach: number, mode: string, massKg: number, armM: number, armGiven: boolean, stations: { side: "windward", atM: Vec3 }[] }} crew
 * @property {{ source: "table"|"gm", heelsDeg: number[], boatNm: number[], crewNm: number[], wettedAreaM2: number[]|null }} righting
 * @property {number} heelLimitDeg
 */

/**
 * @typedef {object} Appendage
 * @property {"keel"|"rudder"} id @property {string} kind
 * @property {{ rootLE: Vec3, rootTE: Vec3, tipLE: Vec3, tipTE: Vec3 }} cornersM
 * @property {number} spanM @property {number} rootChordM @property {number} tipChordM
 * @property {number} sweepDeg leading edge, + = tip aft
 * @property {number} sweepHalfDeg @property {number} tc @property {number} taper
 * @property {number} areaM2 @property {number} macM @property {Vec3} qcM
 * @property {number} arGeom @property {1|2} endPlateFactor @property {number} arEff upright
 * @property {number} liftSlope per rad, upright @property {number} stallDeg @property {number} clMax upright
 * @property {number} macFromRootM @property {number} volumeM3 @property {Vec3|null} volumeCentroidM
 * @property {{ lengthM: number, diameterM: number, centreM: Vec3, volumeM3: number }|null} bulb
 * @property {{ axisM: [Vec3, Vec3], bearingM: Vec3, deckM: Vec3, balanceFrac: number, maxDeg: number }|null} stock rudder only
 */

/**
 * @typedef {object} Sail
 * @property {"main"|"jib"|"staysail"} id
 * @property {string} kind main | jib | genoa | self-tacking | staysail
 * @property {object} model the §6.2 constants of its curve family, with `family`
 * @property {Vec3[]} polygonM @property {number} areaM2 @property {Vec3} ceM
 * @property {Vec3} tackM @property {Vec3} headM @property {Vec3} clewM
 * @property {number} luffM @property {number} footM @property {number} ar @property {number} liftSlope
 * @property {{ fraction: number, areaM2: number, ceM: Vec3, luffM: number, polygonM: Vec3[] }[]} reefs
 * @property {number} furl
 * @property {{ minDeg: number, maxDeg: number, wing: object|null, boom: { gooseneckM: Vec3, endM: Vec3, lengthM: number }|null, lead: { port: Vec3, starboard: Vec3 }|null }} sheeting
 * @property {{ alphaDeg: number[], cl: number[], cd: number[] }} coeffs
 */

/**
 * @typedef {object} PredictedPoint
 * @property {number} twsMs @property {number} twsKn @property {number} twaDeg
 * @property {boolean} ok @property {number|null} speedMs @property {number} VMs
 * @property {number} heelDeg @property {number} leewayDeg @property {number} rudderDeg
 * @property {number} flat @property {string} set @property {number} reef
 * @property {Record<string, number>} sheetsDeg
 * @property {number|null} awsMs @property {number|null} awaDeg
 * @property {number} fn @property {"displacement"|"transition"|"planing"|"beyond"} regime @property {number} planingWeight
 * @property {number|null} vmgMs @property {number|null} residual @property {{ id: string, text: string }[]} flags @property {boolean} hollow
 */

/**
 * @typedef {object} Predicted
 * @property {"computed"|"not-computed"} status
 * @property {string|null} why
 * @property {{ twsMs: number[], twaDeg: number[], reference: { twsMs: number, twaDeg: number } }} conditions
 * @property {PredictedPoint|null} reference
 * @property {{ id: string, text: string, rudderDeg: number|null }|null} helm
 * @property {PredictedPoint[]} points @property {PredictedPoint[]} beat @property {PredictedPoint[]} run
 */

/**
 * @typedef {object} SailModel
 * @property {number} rhoAirKgM3
 * @property {{ kIntDeg: number, upwash: [number, number], blanket: { max: number, from: number, to: number } }} interaction
 * @property {number} flatMin @property {number} spanFactor @property {number} cnExp
 */

/**
 * @typedef {object} SailSet full sail, then one per reef of the main
 * @property {string} id "full" | "reef1" | …
 * @property {number} reef −1 for full sail
 * @property {string[]} sails @property {number} areaM2 @property {Vec3} ceM @property {number} heM @property {number} are
 * @property {{ betaDeg: number[], cl: number[], cdv: number[], sheetsDeg: Record<string, number[]> }|null} trimmed §6.3
 */

/**
 * @typedef {object} Rig
 * @property {"masthead"|"fractional"|"cat"|"cutter"} type
 * @property {number} I @property {number} J @property {number} P @property {number} E @property {number} BAS
 * @property {number|null} ISP @property {number|null} LP @property {number} rakeDeg
 * @property {{ stepM: Vec3, partnersM: Vec3, headM: Vec3, heightM: number, lengthM: number, massKg: number|null, kgPerM: number|null, stepped: "deck"|"keel", stayed: boolean, sectionM: number }} mast
 * @property {{ gooseneckM: Vec3, endM: Vec3, lengthM: number }|null} boom
 * @property {{ id: string, fromM: Vec3, toM: Vec3, viaM: Vec3[] }[]} standing ids from STAY_IDS
 * @property {{ heightM: number, rootM: Vec3, tipsM: [Vec3, Vec3], lengthM: number }[]} spreaders
 * @property {{ areaM2: number, ceM: Vec3|null }} designer @property {{ areaM2: number, ceM: Vec3|null }} actual
 */

/**
 * @typedef {object} Resistance §6.5
 * @property {"computed"|"not-computed"} status @property {string|null} why @property {"ITTC57+DSYHS+Savitsky"} model
 * @property {number} [rhoWaterKgM3] @property {number} [nuM2s]
 * @property {number[]} speedsMs @property {number[]} [fn] @property {number[]} heelsDeg
 * @property {number[][]} hullN [heel][speed] @property {number[][]} frictionN @property {number[][]} heelResiduaryN
 * @property {number[]} residuaryN @property {(number|null)[]} planingN @property {number[]} planingWeight @property {number[]} appendagesN
 * @property {("displacement"|"transition"|"planing"|"beyond")[]} regime
 * @property {{ draftM: number, keelTaper: number, rule: string }} [induced]
 * @property {{ residuaryFn: number[], residuaryA: number[][], heelFn: number[], heelU: number[][], teUpright: number[] }} [coefficients]
 * @property {{ capability: number, dL: number, weightN: number, beamM: number, deadriseDeg: number, deadriseFrom: string, lcgFromAftM: number, fnBlend: [number, number] }} [planing]
 * @property {number} [fnMax] @property {number} [formFactor]
 */

/**
 * @typedef {object} Hardpoints §3.9
 * @property {Vec3} mastStepM @property {Vec3} mastPartnersM @property {Vec3} mastheadM @property {Vec3} stemheadM
 * @property {Vec3|null} forestayTackM @property {Vec3|null} innerForestayTackM @property {Vec3|null} backstayPlateM
 * @property {{ id: string, atM: Vec3 }[]} chainplates
 * @property {{ axisM: [Vec3, Vec3], bearingM: Vec3, deckM: Vec3 }|null} rudderStock
 * @property {{ boomM: Vec3, travellerM: [Vec3, Vec3] }|null} mainsheet
 * @property {{ sail: "jib"|"staysail", side: "port"|"starboard", trackFromM: Vec3, trackToM: Vec3, leads: { furl: number, atM: Vec3 }[] }[]} jibLeads
 * @property {{ sail: string, atM: Vec3 }[]} halyardExits
 * @property {{ side: "windward", atM: Vec3, mode: string }[]} crewStations
 */

/**
 * @typedef {object} Loads §3.10, static, no safety factor
 * @property {"RM30"} basis @property {number|null} rm30Nm @property {number|null} chainplateBaseM
 * @property {Record<string, number|null>} chainplatesN @property {number|null} mastCompressionN @property {number|null} atAwsMs
 * @property {Record<string, number|null>} sheetN @property {Record<string, null>} halyardN
 * @property {number|null} rudderTorqueNm @property {number|null} rudderAtSpeedMs @property {string} notes
 */

/**
 * @typedef {object} LumpedSail §6.8, in the contract frame (the GLB's extras.sail.plan carries it in glTF coordinates)
 * @property {Vec3} tackM @property {number} luffM @property {number} footM @property {number} areaM2 @property {Vec3} ceM @property {number} ceHeightFrac
 */
