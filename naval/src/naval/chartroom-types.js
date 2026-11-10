// Chartroom hydrostatic-table v1 (draft), as JSDoc types. Copied from
// @risingtideresearch/chartroom v0.2.0, formats/hydrostatic-table/v1/types.ts
// (the version camber pins), not depended on: CLAUDE.md allows registry
// versions only, and Chartroom is consumed by a github: tag. The rules that
// types can't state (interpolation, coverage, validation) are in
// specification.md there and are followed in statics.js, section by section.
//
// Units are in the field suffixes: M metres, M2 m², M3 m³, M4 m⁴, Deg degrees.
// Frame: x forward, y port, z up; R = Rx(heel) · Ry(−trim); the waterplane is
// n · r = h with n = Rᵀ·[0, 0, 1]; the immersed half-space is n · r ≤ h.

export const HYDROSTATIC_TABLE_FORMAT = "hydrostatic-table";
export const HYDROSTATIC_TABLE_VERSION = 1;
export const FRAME_AXES = "x-forward-y-port-z-up";

/** Top-level keys a v1 table may have; anything else is rejected (spec §7). */
export const TABLE_KEYS = ["$schema", "format", "version", "name", "frame", "body", "table", "referenceState", "immersionMarkers", "source", "notes", "extensions"];

export const MARKER_KINDS = ["deck-edge", "downflooding", "reference"];

/**
 * @typedef {[number, number, number]} PointM  hull-fixed [x, y, z], metres
 *
 * @typedef {object} HydrostaticTable
 * @property {string} [$schema]
 * @property {"hydrostatic-table"} format
 * @property {1} version
 * @property {string} [name]
 * @property {{ axes: "x-forward-y-port-z-up", originDescription: string, knReferenceM: [number, 0, number] }} frame
 * @property {{ description: string, buoyancyEnvelope: "closed-watertight" }} body
 * @property {{ interpolation: "linear", rows: Row[] }} table
 * @property {{ heelDeg: number, trimDeg: number, waterplaneOffsetM: number }} [referenceState]
 * @property {{ id: string, label: string, kind: "deck-edge"|"downflooding"|"reference", pointsM: PointM[] }[]} [immersionMarkers]
 * @property {{ tool?: string, toolVersion?: string, modelId?: string, generatedAt?: string, method?: string, notes?: string[] }} [source]
 * @property {string[]} [notes]
 * @property {Object<string, unknown>} [extensions]
 *
 * @typedef {object} Row  complete Cartesian product, sorted by trim then heel
 * @property {number} heelDeg  −180 … 180
 * @property {number} trimDeg  strictly between −90 and 90
 * @property {Sample[]} samples  ≥ 2, strictly increasing offsets, nondecreasing volumes
 *
 * @typedef {object} Sample
 * @property {number} waterplaneOffsetM  signed plane offset h; not a draft
 * @property {number} volumeM3  0 (dry, buoyancyCenterM null) or positive
 * @property {PointM|null} buoyancyCenterM
 * @property {Waterplane|null} [waterplane]  omitted: unknown; null: known to have none
 * @property {number} [wettedAreaM2]
 *
 * @typedef {object} Waterplane
 * @property {number} areaM2  positive
 * @property {PointM} [centroidM]  on the sample's waterplane, hull coordinates
 * @property {{ xx?: number, xy?: number, yy?: number }} [secondMomentsM4]  central, world-horizontal axes after R; omitted = unknown
 */
