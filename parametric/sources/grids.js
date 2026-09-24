/* grids.js — printable grid sheets (graph, dot, ruled, Seyès, calligraphy, music) as a
 * parametric source. Contract: ../DATATYPE.md.
 *
 * The drawing engine below (SIZES … render) is lifted from thing-grids/grid-generator.html
 * at HEAD (b3a4569), the same lift patchwork-pkg-lattice/grid-builder/render.js made at
 * 1112c7e, plus the six calligraphy commits after it. Removed: the `$` DOM helper, the
 * `?probe` hook, the URL codec, the panel. Added from lattice: the paper tint
 * (paperMode "tint" + paperColor). Geometry is otherwise byte-for-byte; fixes go to
 * thing-grids first.
 *
 * The engine reads one module-scope object `S` (design values + view values); render()
 * sets it from (surface.view, values) before drawing. GRIDS keeps thing-grids' per-family
 * build/pitch/divisions; the param specs (which carried functions) are re-expressed as the
 * JSON `params` template at the bottom, with `showWhen` conditions and `notes()`.
 */

let S = {};
function setState(next){ S = next; }

/* ---------------- paper stock ---------------- */
// portrait millimetres, [label, width, height]
const SIZES = {
  a4:        ["A4",           210,   297  ],
  a5:        ["A5",           148,   210  ],
  a6:        ["A6",           105,   148  ],
  a7:        ["A7",            74,   105  ],
  b5iso:     ["B5 · ISO",     176,   250  ],
  b6iso:     ["B6 · ISO",     125,   176  ],
  b7iso:     ["B7 · ISO",      88,   125  ],
  b5jis:     ["B5 · JIS",     182,   257  ],
  b6jis:     ["B6 · JIS",     128,   182  ],
  b7jis:     ["B7 · JIS",      91,   128  ],
  letter:    ["US Letter",    215.9, 279.4],
  half:      ["Half Letter",  139.7, 215.9],
  legal:     ["US Legal",     215.9, 355.6],
  custom:    ["Custom",       105,   148  ]
};

// Shared ink palette for every colour control (Main / Accent / Margin).
// NOTE: estimated toward the reference swatch strip — swap for exact brand hex.
const INKS = [
  ["#EDEBE6","Chalk"],
  ["#D6D3CC","Light grey"],
  ["#C3CED6","Cool grey"],
  ["#D8CBB8","Warm grey"],
  ["#A4DDED","Non-photo blue"],
  ["#9FB8D8","Drafting blue"],
  ["#B9C6E4","Periwinkle"],
  ["#E3A9B8","Rose"],
  ["#333333","Graphite"]
];

const MM_PER_IN = 25.4;
const MIN_BLEED = 3.175; // 1/8 inch

// Live design + view state. Its design-field defaults are NOT written here — they
// are derived from the URL_FIELDS registry (the single source for default + URL
// code + type), assembled just after the param specs below. Helpers between here
// and there only reference S inside function bodies (called after load), so the
// binding may be initialised later without a temporal-dead-zone hazard.
// See `URL_FIELDS` / `DEFAULTS` / `S` further down.

/* ---------------- helpers ---------------- */
const mmToIn = mm => mm / MM_PER_IN;
const toUnit = mm => S.unit === "mm" ? mm : mmToIn(mm);
const fromUnit = v => S.unit === "mm" ? v : v * MM_PER_IN;
const fmtU = mm => S.unit === "mm" ? round(mm,2) + " mm" : round(mmToIn(mm),4) + " in";
const round = (n,d) => { const p = Math.pow(10,d); return Math.round(n*p)/p; };
const px = mm => Math.round(mm / MM_PER_IN * S.dpi);

function trim(){
  const s = SIZES[S.sizeKey];
  let w = S.sizeKey === "custom" ? S.customW : s[1];
  let h = S.sizeKey === "custom" ? S.customH : s[2];
  return S.orientation === "landscape" ? [h,w] : [w,h];
}
function sheet(){ const [w,h] = trim(); return [w + S.bleed*2, h + S.bleed*2]; }

// interior fold-crease positions (mm from the trim corner) for `panels` equal
// panels along `len`. UI exposes a single centred fold; the renderer handles N.
const FOLD_PANELS = 2;
function foldLines(len, panels){
  const out = [];
  for (let i = 1; i < panels; i++) out.push(len * i / panels);
  return out;
}

// where the line lattice starts relative to the trim corner (0 for trim origin,
// the centring residual for centered). Shared so chrome can land ON a gridline.
function originOffset(len, spacing, origin){
  return origin === "center" ? (len - Math.floor(len/spacing + 1e-9) * spacing) / 2 : 0;
}
// snap a position inward to a gridline of `pitch` on the `origin` lattice —
// ceil (toward centre) for a near edge, floor for a far edge. Called only via
// insetRectP now, so the sheet Margin and the calligraphy/music bands share one
// snap and their frame + grid stay coincident.
function snapLine(pos, len, pitch, origin, ceil){
  const off = originOffset(len, pitch, origin);
  const k = (pos - off) / pitch;
  return off + (ceil ? Math.ceil(k - 1e-9) : Math.floor(k + 1e-9)) * pitch;
}
// Inset rectangle for the sheet Margin, given the pitch to snap each axis to WHEN
// Snap is on (vP = x-axis, hP = y-axis; each value is the pitch to use, applied
// only while `marginSnap` is on — pass the axis pitch regardless of the snap
// toggle). Pure in S + the pitches — NO buildLayers(), so the band builders can
// call it for their own margin geometry without re-entering buildLayers (the
// recursion that once forced them to snap inline). Returns RAW edges; callers add
// the margin-off / degenerate → null contract (see insetRect).
function insetRectP(tw, th, vP, hP){
  const m = S.marginInset * S.spacing;
  let L = m, T = m, R = tw - m, B = th - m;
  if (S.marginSnap === "on"){
    if (vP){ L = snapLine(L, tw, vP, S.origin, true); R = snapLine(R, tw, vP, S.origin, false); }
    if (hP){ T = snapLine(T, th, hP, S.origin, true); B = snapLine(B, th, hP, S.origin, false); }
  }
  return { x:L, y:T, w:R-L, h:B-T };
}
// line positions measured from the trim corner, extended into the bleed
function lines(len, spacing, bleed, origin){
  const off = originOffset(len, spacing, origin);
  const first = Math.ceil((-bleed - off) / spacing - 1e-9);
  const last  = Math.floor((len + bleed - off) / spacing + 1e-9);
  const out = [];
  for (let k = first; k <= last; k++) out.push({ v: off + k*spacing, k });
  return out;
}
// mm-offset band generator: repeats a band of styled entries every `period`,
// entry i at `base + n*period + entries[i].offset`. Unlike lines()+cycleAt, the
// offsets are arbitrary (non-uniform), which is what calligraphy / music bands
// need. Returns [{ v, e }] filtered to the drawable range. `origin:center`
// centres the band period.
function bandLines(len, period, entries, bleed, origin, base, range){
  const off = base != null ? base
    : (origin === "center" ? (len - Math.floor(len/period + 1e-9) * period) / 2 : 0);
  const lo = range ? range.min : -bleed;         // drawable window (defaults to full sheet)
  const hi = range ? range.max : len + bleed;
  const first = Math.floor((lo - off) / period) - 1;
  const last  = Math.ceil((hi - off) / period) + 1;
  const out = [];
  for (let n = first; n <= last; n++){
    const b0 = off + n*period;
    for (const e of entries){
      const v = b0 + e.offset;
      if (v >= lo - 1e-9 && v <= hi + 1e-9) out.push({ v, e });
    }
  }
  return out;
}
// slant guides at `angle`° from horizontal (90 = vertical). Each line crosses the
// trim bottom at x0 = off + k*spacing and shears by height/tan(angle) up to the
// top. Returns the bottom x-positions covering the sheet (incl. the shear).
/* Slant-lattice pitch and phase.

   PITCH, three ways — all upright-safe, since at 90° a guide has no horizontal run
   and every mode collapses to the grid pitch.
     Per column — one guide per grid column: they cross each rule `spacing` apart, but
                  because they lean, the gap measured square-on is `spacing × sin θ`,
                  ~18% tighter than the rules at 55°.
     Even       — that square-on gap made equal to the row pitch instead, so both
                  families have identical line-to-line spacing and the cells are true
                  rhombi. Horizontal step `spacing ÷ sin θ`.
     Synced     — the step is the run across a WHOLE WRITING ROW, `period ÷ tan θ`,
                  divided by `Slants per row`. At 1 that puts exactly one guide on the
                  left edge of every set's baseline: a guide leaving one set's baseline
                  arrives at the next set's baseline exactly one step along, so every
                  writing row gets the same slant origin — the thing the x-height needs.
                  Raising N subdivides that interval (2 adds one at the midpoint, 3 at
                  the thirds…); those extras do not start at a rule's left end, and need
                  not. When N reaches the rows-per-period the step becomes
                  `spacing ÷ tan θ` and the sync tightens from per writing row to per
                  RULE, every rule then carrying the identical crossing pattern.

                  Anchoring to the writing row rather than the rule is what makes steep
                  slants usable: an 85° italic on 5 mm rows runs 0.44 mm per rule but
                  2.2 mm per 5-row set. Floored at 0.2 mm — finer than anything that
                  prints, and a guard against the column count running away as the
                  slant approaches vertical.

   PHASE. Once the pitch is no longer the grid pitch, the origin lattice is the wrong
   place to hang it: the guides would no longer meet the grid's left edge. So phase
   the lattice on where the GRID starts — the margin's left edge when there is one,
   else the trim edge (or the centring residual at Origin: Centered). Combined with
   the baseline anchor, that puts a guide exactly on (grid left edge, baseline). This
   is a no-op whenever the lattice pitch IS the grid pitch, because the margin inset
   is a whole number of columns snapped to the grid — so music and `Per column` are
   bit-for-bit unaffected. */
// `per` is the family's guides-per-writing-row under Synced; ignored by the others.
function latPitch(p, angle, P, per){
  if (angle >= 90) return p;                       // upright: no run, no distinction
  const r = angle * Math.PI / 180;
  if (S.slantSpace === "even") return p / Math.sin(r);
  if (S.slantSpace === "sync")
    return Math.max(P / (posNum(per) * Math.tan(r)), 0.2);
  return p;                                        // per column
}
/* Every guide family carries the same PAIR of density controls, because the two modes
   want opposite things of it: outside Synced you thin columns out of a fixed lattice,
   inside Synced you subdivide the writing row — and thinning is precisely what breaks
   the sync, so Synced never does it. Hence `…Every` (thin) and `…Per` (subdivide),
   each shown only in the mode it means something in. */
const posNum    = v => { const n = +v; return isFinite(n) && n > 0 ? n : 1; };
const thinOf    = v => S.slantSpace === "sync" ? 1 : Math.max(1, Math.round(v) || 1);
const slantPer  = () => posNum(S.slantPer);
const connPer   = () => posNum(S.connPer);
const slantThin = () => thinOf(S.slantEvery);
const connThin  = () => thinOf(S.connectorEvery);
function latOffset(tw, th, p){
  const ir = insetRect(tw, th);            // safe to call: insetRect builds no layers
  return ir ? ir.x : originOffset(tw, p, S.origin);
}
const shearOf = (th, bleed, angle) => angle >= 90 ? 0 : (th + 2*bleed) / Math.tan(angle * Math.PI / 180);
// `pad` (mm) widens the high end — a per-set anchor can shift a row's columns LEFT,
// which the default range (sized for the continuous lattice's 0..shear) doesn't reach.
// `off` (mm) phases the lattice explicitly; without it the lattice sits on the origin
// lattice of its own pitch, which is only where you want it when that pitch IS the
// grid pitch. See latOffset().
function slantLines(tw, th, spacing, bleed, origin, angle, pad, off){
  const shear = shearOf(th, bleed, angle);
  if (off == null) off = originOffset(tw, spacing, origin);
  const first = Math.floor((-Math.max(shear,0) - bleed - off) / spacing);
  const last  = Math.ceil((tw + bleed + (pad || 0) - off) / spacing);
  const out = [];
  for (let k = first; k <= last; k++) out.push({ x0: off + k*spacing, k });
  return { pos: out, shear };
}

/* ---------------- grid model: ordered layers of line families ----------------
   A grid is an ordered list of layers. A line family repeats a cycle of styled
   entries along its normal axis: entry i governs every fine line whose signed
   index k satisfies k mod cycle.length === i. Global `emph` is sugar that
   expands a length-1 cycle into a length-`emph` one whose first entry accents.
   Base spacing stays family-global for now (step 1); `colour`/`weight` are
   resolved into each entry when given (the line path, S-free render). The dot
   path calls this with neither, so its entries keep `colour:null` — the
   two-colour-dot rule stays deferred (its own layer.style.colour resolves it). */
function accentCycle(emph, colour, weight){
  const n = emph > 0 ? emph : 1;
  const cyc = [];
  // weight only when given (the line path) — dot-path entries keep their {accent,colour} shape
  for (let i = 0; i < n; i++) cyc.push({ accent: emph > 0 && i === 0, colour: colour ?? null, ...(weight != null && { weight }) });
  return cyc;
}
function lineFamily(angle){
  const cyc = accentCycle(S.emph, S.ink, S.weight);   // resolved colour+weight (S-free render)
  // angle 0 = horizontal rule (varies in y, spans x); 90 = vertical (varies in x, spans y)
  return { kind:"line", angle, spacing:S.spacing, origin:S.origin,
           period: cyc.length * S.spacing, cycle: cyc };
}
function dotFamily(){
  const cyc = accentCycle(S.emph);
  return { kind:"dot", spacing:S.spacing, origin:S.origin,
           period: cyc.length * S.spacing, cycle: cyc,
           style:{ colour:S.ink, dotSize:S.dotSize } };   // resolved at build (S-free render)
}
/* Seyès (French ruled): a strong main line every `spacing` with three light
   sub-lines dividing each band into quarters, plus light verticals at `spacing`.
   Modelled on the existing fine-lattice cycle — horizontal sub-lines at
   spacing/4 with a 4-entry cycle (strong, light, light, light). The main line's
   weight is S.weight × strongMul, so the base line weight stays shared with the
   other grids. `origin:center` centres the *fine* lattice (the sub-line residual
   shifts the band phase); true band-centring waits for the music-staff band
   generator that actually needs it. */
// Margin line: a grid-level stylistic vertical rule that lands ON a gridline (N
// columns in from the left) and replaces it — counted in grid units so it tracks
// spacing, weighted S.weight × marginLineMul, drawn last. Shared by Seyès and
// ruled. Returns null when off. (Distinct from the sheet-level Margin layout
// feature, which insets the whole grid + draws a frame.)
function marginLineRule(){
  if (S.marginLine !== "left") return null;
  const [tw, th] = trim();
  const off = originOffset(tw, S.spacing, S.origin);
  // Count the columns from where the GRID starts, not from the trim edge. With a
  // Margin the grid begins at the inset, so "2 cols" has to mean two columns in
  // from there. Measuring from the page edge put the rule directly underneath the
  // grid's own left edge whenever the inset was about one column wide (inset 1 at
  // origin trim puts both at exactly S.spacing), so it read as a border rather
  // than a margin. Snap the anchor out to the first gridline at or inside the
  // inset so the rule still lands ON the lattice rather than a fraction off it.
  // No Margin: unchanged, because then the trim edge IS where the grid starts.
  const ir = insetRect(tw, th);   // safe to call: insetRect builds no layers
  const anchor = ir
    ? off + Math.ceil((ir.x - off) / S.spacing - 1e-9) * S.spacing
    : off;
  return { kind:"rule", axis:"v", offset: anchor + S.marginLineAt * S.spacing,
           colour:S.marginLineInk, weight: S.weight * S.marginLineMul };
}
function seyesLayers(){
  const light  = { accent:false, colour:S.ink, weight:S.weight };     // resolved at build (S-free render)
  const strong = { accent:false, colour:S.accentInk, weight: S.weight * S.accentMul };
  const layers = [
    { kind:"line", angle:90, spacing:S.spacing,   origin:S.origin,     // light verticals
      period:S.spacing, cycle:[ light ] },
    { kind:"line", angle:0,  spacing:S.spacing/4, origin:S.origin,     // strong + 3 light
      period:S.spacing, cycle:[ strong, light, light, light ] }
  ];
  const m = marginLineRule(); if (m) layers.push(m);
  return layers;
}
/* Shared calligraphy/music band geometry: a repeating band of `nDot` dot rows then
   an `nLine`-line set, at lattice `angle` (90 = upright music / upright calligraphy;
   S.slant = sheared calligraphy). Everything both grids compute the same way lives
   here — the margin-aware vertical origin + snap (whole sets between the margins,
   leftover → dot `tail`), the `setR` draw window, the mark style, the horizontal
   `hLines`, the `dots` lattice, and the `lineYs` crossings. Music then adds endcaps;
   each grid wraps this with its own `slant` tick layer. Pure (S + the three args).
   `mRect` snaps x only when upright (angle 90) — sheared columns have no vertical
   pitch; calligraphy reads only `mRect.y` (via `base`), which is x-pitch-independent,
   so the upright/sheared x choice never affects it. `perSet` restarts the slant
   lattice on every set's baseline instead of running one continuous set of
   parallels down the sheet (see the anchor block below); music never passes it —
   upright bands have zero shear, so the two anchors coincide there anyway.
   `ruleStyle(i)` returns the style for the rule at index i within the set, or null to
   leave it at the body ink and weight — so a fine pitch can read as a coarser one.
   Null throughout (music) ⇒ every rule alike. */
/* The band's row arithmetic. The gap between one set's last rule and the next set's
   first is `(gap+1)` rows:
     Dots/Crosses — one marked gap row  (gap 1 → 2 rows of clearance)
     None         — the gap row itself is gone (gap 0 → 1 row of clearance)
     Shared       — no clearance at all: the period loses a row, so a set's LAST rule
                    IS the next set's first. That rule then appears twice in the band
                    (as li = nLine−1 and again as li = 0) and carries its own style. */
function bandMetrics(nDot, nLine){
  const p = S.spacing;                        // uniform row pitch — every row p apart
  const m = S.interMark;
  const marked = m === "dot" || m === "cross";
  const gap = marked ? nDot : 0;              // gap ROWS, which only marks occupy
  // Clearance from a set's last rule to the next set's first. Held as a LENGTH rather
  // than a row count, because Space makes it a fraction of the pitch — a whole row
  // proved to be more air than a sheet wants between rows of writing.
  const clear = marked        ? (nDot + 1) * p
              : m === "share" ? 0
              : m === "space" ? Math.max(0, S.interSpace) * p
              :                 p;            // legacy "none": exactly one row
  return { p, gap, shared: m === "share",
           P: (nLine - 1) * p + clear };      // period: the line set, then the clearance
}
function bandGeometry(nDot, nLine, angle, perSet, ruleStyle, baseIdx){
  const M = bandMetrics(nDot, nLine);
  nDot = M.gap;
  const [tw, th] = trim();
  const b = S.bleed;
  const p = M.p, P = M.P;
  const solid = { colour:S.ink, weight:S.weight };   // resolved at build (S-free render)

  const marginOn = S.margin === "on";
  const snapOn   = marginOn && S.marginSnap === "on";
  const mRect = marginOn ? insetRectP(tw, th, angle === 90 ? p : null, p) : null;
  const base = mRect ? mRect.y
    : (S.origin === "center" ? (th - Math.floor(th/P + 1e-9)*P)/2 : 0);

  // Snap means only what it says: the margin edge lands on the nearest gridline and
  // the band runs to it. It used to ALSO reserve whole sets between the margins and
  // fill the remainder with dots — "never a cropped set" — but that silently spent up
  // to a full set of writing space at the bottom of the sheet, which is not what a
  // snap should cost (reported 2026-09-01). A set cropped by the margin now just draws
  // the rules that fit; `setSpans` still gives it a span, so its diagonals come too
  // and the region clips them.
  const mBot = marginOn ? mRect.y + mRect.h : th + b;
  const setR = marginOn ? { min: base - 1e-6, max: mBot + 1e-6 } : undefined;

  // tick / cross height (mm) — user-set, capped at half the pitch so adjacent
  // ticks/crosses stay discrete (don't merge vertically) at small spacing.
  // the slant lattice's own pitch and phase (see latPitch / latOffset) — the row
  // pitch `p` still governs everything vertical
  const latP = latPitch(p, angle, P, slantPer()), latOff = latOffset(tw, th, p);
  const tickV = Math.min(S.tickH, p * 0.5);
  // interline marks: dots (•) or crosses (+) whose vertical arm follows the slant
  const markStyle = { mark:S.interMark, tickV, style:{ colour:S.ink, weight:S.weight, dotSize:S.dotSize } };

  // Per-row guide phase (`perSet`). The slant lattice normally shears about ONE
  // anchor — the sheet bottom — so it is a single continuous set of parallels and a
  // given guide sits further right on every row up the page. Per set, each row
  // instead shears about ITS OWN period's baseline (the 2nd-from-bottom line of that
  // set), so every set's baseline lands on the same un-sheared columns and writing
  // starts at the same x on every row. `anchorOff` is the signed mm from a row to
  // that baseline; the renderer adds it to the row's y. Off ⇒ no `anchorOff` ⇒ the
  // renderer falls back to the sheet-bottom anchor, i.e. exactly today's lattice.
  // The lattice's un-sheared reference row. CONTINUOUS phases the one lattice on the
  // FIRST set's baseline, so a guide meets the grid's left edge exactly there and
  // lower sets drift by period ÷ tan(slant) — the documented continuous behaviour.
  // (Anchoring it at the sheet bottom, as it first shipped, put that flush start on
  // an arbitrary row.) PER SET re-phases every set onto its own baseline.
  const bi = baseIdx != null ? baseIdx : nLine - 2;   // baseline's index within the set
  const baseRow = nDot + bi;                      // period-relative baseline row index
  const AY = base + baseRow*p;                    // first period's baseline
  const anchorOf = i => perSet ? { anchorOff:(baseRow - i)*p } : null;

  // `li` = the line's index WITHIN its set. Carried through so a consumer can tell a
  // whole set from a set cropped by the drawable window (with Margin off the window
  // runs into the bleed, where the period ABOVE the first can leave a tail of lines).
  const lineOffsets = Array.from({ length:nLine }, (_, i) => Object.assign({ offset:(nDot + i)*p, li:i }, anchorOf(nDot + i)));
  const dotRows     = Array.from({ length:nDot },  (_, i) => Object.assign({ offset:i*p }, anchorOf(i)));
  const hLines = { kind:"line", angle:0, origin:S.origin, spacing:p, period:P, base, range:setR,
    offsets: lineOffsets.map((o, i) => Object.assign({}, o, (ruleStyle && ruleStyle(i)) || solid)) };
  // Interline marks: `none` draws no dot layer at all, leaving the gap row bare.
  const dots = (S.interMark !== "dot" && S.interMark !== "cross") ? null
    : Object.assign({ kind:"dotrows", spacing:latP, latOff, origin:S.origin, period:P, base, angle,
        range:setR, anchorAt: perSet ? null : AY, rows: dotRows }, markStyle);
  // `lineNodes` carries each writing-line crossing WITH its slant anchor; `lineYs`
  // stays a bare number array — music's endcaps index it positionally.
  const lineNodes = bandLines(th, P, lineOffsets, b, S.origin, base, setR)
    .map(o => ({ y:o.v, li:o.e.li, a: o.e.anchorOff != null ? o.v + o.e.anchorOff : AY }));
  const lineYs = lineNodes.map(n => n.y);
  // The diagonals' extent under a CONTINUOUS phase: one span covering the whole
  // sheet, anchored on the lattice's own reference row, so a guide runs unbroken from
  // bleed to bleed. The render clips it to the drawing region.
  const fullSpan = { y0: -b, y1: th + b, yb: AY, a: AY, whole: true };
  return { p, P, latP, latOff, base, AY, fullSpan, tickV, markStyle, lineNodes, lineYs,
           hLines, dots, mRect, angle, nDot, nLine, bi };
}
/* Calligraphy practice: a repeating band of `nDot` dot rows then an `nLine`-line
   writing set (ticked slant guides at S.slant°, 90 = upright). The sequence starts
   with dots. When the sheet Margin is on the band begins on the top margin (grid
   starts at the margin, not cropped); when Snap is also on, only whole line-sets
   are drawn and the leftover at the bottom fills with dots instead of a cropped
   set. (nDot,nLine) picks the preset — (2,5) full practice, (1,3) compact. */
function calligraphyLayers(nDot, nLine, baseIdx){
  const bi = baseIdx != null ? baseIdx : nLine - 2;
  const perRow = S.guidePhase === "set";
  const g = bandGeometry(nDot, nLine, S.slant, perRow, ruleRoles(nLine, bi), baseIdx);
  // Guide phase governs the diagonals' EXTENT as well as their anchoring, because the
  // two are the same statement: "continuous" means one unbroken lattice down the
  // sheet, so a guide cannot stop at a row boundary and still be continuous. Per row
  // necessarily segments them — each row restarts on its own baseline, so a guide
  // crossing into the next row would be at the wrong phase there.
  const spans = perRow ? setSpans(g) : [g.fullSpan];
  // Slant guides, two styles. TICKS (default): an explicit short segment centred on
  // every writing-line crossing, drawn along the slant — NOT a dashed full-length
  // line (whose dash the browser drops across most of the sheet). Placed exactly on
  // the lines by construction, so no phase-sync or clip bands are needed; edge lines
  // read —+— for free. LINES: the same lattice drawn solid across each writing set
  // (not the whole sheet — that would run the diagonals through the interline dot
  // rows, and could not restart under Lattice: Per set).
  const slant = S.slantStyle === "lines"
    ? setDiagonals(g, spans, g.angle, { colour:S.slantInk, weight:S.weight*S.slantMul, dash:null, cap:"butt" }, slantThin(), g.latP)
    : { kind:"slant", angle:g.angle, spacing:g.latP, latOff:g.latOff, origin:S.origin, every:slantThin(),
        nodes:dedupeY(g.lineNodes), tickV:g.tickV,
        style:{ colour:S.slantInk, weight:S.weight*S.slantMul, cap:"butt" } };

  const layers = [ g.hLines ];
  if (g.dots) layers.push(g.dots);
  if (slant) layers.unshift(slant);
  const conn = connectorLayer(g, spans);
  if (conn) layers.unshift(conn);   // under the writing lines — a second voice, not more grid
  return layers;
}
/* Rule ROLES within the writing set. A rule is styled by the role it plays, and each
   role carries its own ink and weight multiplier — so a fine pitch can read as a
   coarser one, and the roles can be told apart by colour as well as by weight.
     shared   — the rule two sets hold in common (`Interline: Shared` only). It is
                structurally the set's edge, so it takes the EDGE ink and weight; what
                it needs of its own is not a colour but a trigger, since it must read
                as a boundary even with `Rules: Off`.
     x-height — the two rules bounding the x-height row: the waist and the baseline
                (indices bi−1 and bi). Read the 6-rule set as rows 2·1·0·1·2 and this
                is row 0 — where every lowercase letter starts and stops, everything
                else being an ascender or descender away from it.
     edges    — the set's first and last rule. A 3-rule set on a 2.5 mm pitch is then a
                5 mm ruling with one faint line bisecting it.
   `Rules` turns x-height and edges on separately or together; anything unclaimed stays
   at the body ink and weight. PRECEDENCE where a rule holds two roles at once —
   shared, then x-height, then edges. Shared outranks because a boundary rule is not
   really part of either set; x-height outranks edges because it is the one the hand
   actually writes to. Only the 3-rule set collides at all (its waist IS its top edge);
   4/5/6-rule sets keep the roles disjoint. */
function ruleRoles(nLine, bi){
  const shared = S.interMark === "share";
  const wantX = S.calliRules === "x"    || S.calliRules === "both";
  const wantE = S.calliRules === "edge" || S.calliRules === "both";
  const edge = i => i === 0 || i === nLine - 1;
  const mk = (ink, mul) => ({ colour:ink, weight:S.weight * mul });
  if (!shared && !wantX && !wantE) return null;
  // branches 1 and 3 paint the same style; they differ only in what switches them on
  return i =>
      shared && edge(i)                    ? mk(S.edgeInk, S.edgeMul)
    : wantX && (i === bi - 1 || i === bi)  ? mk(S.xInk, S.xMul)
    : wantE && edge(i)                     ? mk(S.edgeInk, S.edgeMul)
    : null;
}
/* Under `Interline: Shared` a set's LAST rule and the next set's FIRST are the same y,
   so the band legitimately emits that rule twice (once as li = nLine−1, once as
   li = 0). Both copies must exist for `setSpans` — each set needs its own boundary —
   but only one may be DRAWN: two strokes on one line composite their antialiased
   edges twice and the rule reads visibly heavier than its weight. Keeping the first
   occurrence also settles a second question the duplicate raised — which set's slant
   phase the tick row on that line follows. It follows the set ABOVE. */
const dedupeY = nodes => nodes.filter((n, i) => i === 0 || Math.abs(n.y - nodes[i-1].y) > 1e-6);
/* The writing sets, as spans carrying the set's top/bottom line, its baseline, and
   that baseline's slant anchor. Grouped by each line's index WITHIN its set (`li`),
   NOT by striding nLine from the first drawn line: with Margin off the drawable
   window reaches into the bleed, where the period above the first leaves a partial
   set (and a partial one can trail at the bottom either way). A fixed stride would
   chunk across the seam and hang every diagonal off the wrong row. A set without a
   complete baseline is skipped. */
function setSpans(g){
  const bi = Math.min(g.nLine - 1, Math.max(0, g.bi));   // baseline index within a set
  const p = g.p, out = [];
  for (let i = 0; i < g.lineNodes.length; i++){
    const n = g.lineNodes[i];
    if (n.li !== 0) continue;                            // only a set's FIRST rule opens one
    // Derive the span from the period, not from which rules happen to be drawn: a set
    // cropped by the margin still gets its true extent and baseline (rules within a
    // set are p apart), and the region clips what falls outside. `whole` marks the
    // sets that are entirely present — music's endcaps draw past the clip, so they
    // must bracket only those.
    const last = g.lineNodes[i + g.nLine - 1];
    out.push({ y0:n.y, y1:n.y + (g.nLine-1)*p, yb:n.y + bi*p, a:n.a,
               whole: !!last && last.li === g.nLine - 1 });
  }
  return out;
}
/* A diagonal family drawn across each writing set, every line passing through a
   BASELINE node of the MAIN slant lattice, so it meets the ruling exactly where a
   letter starts. Two callers: the connector guides (own angle, ink and dash) and the
   main slant itself when Slant style is Lines rather than Ticks. Null when there is
   no complete set to draw across. */
function setDiagonals(g, spans, angle, style, every, pitch){
  if (!spans.length) return null;
  // Clamp to the controls' own range: the column loop is sized by 1/tan(angle), so a
  // hand-edited permalink carrying `connang=0` would otherwise ask for an infinite
  // span. `every` is likewise floored at one real column.
  const ang = Math.min(90, Math.max(5, angle));
  /* Each family is pitched by the SAME RULE applied to ITS OWN lean. That is what
     couples their ORIGINS: under Synced a family's pitch is its own run over one
     writing row, so it returns to the grid's left edge on every row's baseline — and
     both do, together, however the slant spacing is set. Sharing the slant's pitch
     (tried, reverted) put every connector on a slant node but let the connector's
     origin drift off the left edge on alternate rows, because a shallower lean does
     not travel a whole number of the SLANT's pitches per row.

     The trade that buys: the two families now coincide at each row's ORIGIN and
     interleave between, rather than coinciding everywhere on the first row and
     drifting after it. Phase (`latOff`) and the per-span anchor stay shared, so the
     origin is the one point they are guaranteed to hold in common. */
  return { kind:"connect", angle:ang, hostAngle:g.angle,
    spacing:pitch, latOff:g.latOff, origin:S.origin,
    every:Math.max(1, Math.round(every) || 1), spans, style };
}
/* The connector angle that carries a guide from one slant node to the node `rows`
   rules up and ONE lattice column across — so the two families meet on the grid rather
   than wherever the chosen angle happens to land.

   Over `rows` rules the slant lattice has itself shifted right by `rows·p / tan θs`
   (that is just the slant's own lean). One column further along is another node, at
   `+ latP`. The connector spans that run against a rise of `rows·p`, so

       tan θc = rows·p / (rows·p / tan θs + latP)

   More rows means more rise over a run that grows only by the lean, so a bigger `rows`
   gives a STEEPER connector — which is why 2 rows reads shallower than 3. Upright is
   safe: tan 90° is huge, so the lean term falls to zero and the run is one column. */
function snapAngle(p, slant, P, rows){
  const ts = Math.tan(Math.min(90, Math.max(5, slant)) * Math.PI / 180);
  const dx = rows * p / ts + latPitch(p, slant, P, slantPer());
  return Math.atan2(rows * p, dx) * 180 / Math.PI;
}
/* Connector guides — the CONNECTIVE slant: the angle of the joining strokes that
   run between letters, a second and shallower diagonal family against the main
   letter slant. The Spencerian system teaches it explicitly (52° main slant, 30°
   connective); Copperplate's joins sit nearer 40–45° against its 55° main. Its span
   follows `Guide phase`: per row it is clipped to its own writing row, continuous it
   runs the whole sheet unbroken. Own ink, dash and column density so it reads as a
   second voice. Null when off. */
function connectorLayer(g, spans){
  if (S.connector !== "on") return null;
  // Snap computes the angle from the lattice; otherwise the dialled angle stands.
  const ang = S.connSnap ? snapAngle(g.p, g.angle, g.P, S.connSnap) : S.connectorAngle;
  // dash pattern in multiples of the row pitch, so it reads the same at any spacing.
  // Dotted = zero-length dashes + a round cap (true dots), per applyStroke — and a
  // round cap's diameter IS the stroke width, so a dotted connector has to be stroked
  // at `dotSize`, not at the line weight, or its dots come out a different size from
  // the interline dots they sit among.
  const dotted = S.connectorDash === "dotted";
  const dash = S.connectorDash === "dashed" ? [0.34*g.p, 0.34*g.p]
             // never space the dots closer than twice their own diameter, or a big
             // Dot size merges them and "dotted" silently renders as a solid line —
             // the same reason tick height is capped at half the pitch
             : dotted ? [0, Math.max(0.26*g.p, S.dotSize*2)] : null;
  /* SNAP puts the connector back on the SLANT's columns. It has to: the snapped angle
     promises a run from one node to another, and that promise is only kept if the
     connector STARTS on a node. With a pitch of its own only the column at the row's
     origin happened to be one, so the rest ran node-to-nothing — measured on a 60°
     sheet, slant columns 17.30 mm apart and connectors at 40.41 mm, none coincident.
     Off snap the connector keeps its own pitch, which is what couples the two origins
     when the angle is a free choice. Density follows suit: riding the slant's columns
     means thinning them (`Connector every`), while an independent pitch under Synced
     means subdividing the writing row (`Connectors per row`). */
  const snapped = !!S.connSnap;
  return setDiagonals(g, spans, ang,
    { colour:S.connectorInk, weight: dotted ? S.dotSize : S.weight*S.connMul, dash,
      cap: dotted ? "round" : "butt" },
    snapped ? Math.max(1, Math.round(S.connectorEvery) || 1) : connThin(),
    snapped ? g.latP : latPitch(g.p, ang, g.P, connPer()));
}
/* Music manuscript: a fork of Calligraphy — a repeating band of `nDot` dot rows
   then an `nLine`-line staff — but upright (angle 90, zero shear, so no slant
   x-alignment question) and closed left/right by vertical endcap bars. v1 is
   fixed at 2 dot rows + 5 staff lines with uniform `S.spacing` pitch, so it
   renders as dots → staff → dots → staff …. Shares Calligraphy's margin-aware
   band via bandGeometry; the endcaps' left/right x come from the staff `mRect`
   (upright, so x-snapped to pitch p) when Margin is on, else there are none. */
function musicLayers(nDot, nLine){
  const g = bandGeometry(nDot, nLine, 90);
  const capX = g.mRect ? [g.mRect.x, g.mRect.x + g.mRect.w] : null;

  // upright ticks (angle 90 → zero shear) at every staff-line crossing — but not
  // at the cap columns (`capX`): the endcap already marks the staff start/end.
  const slant = { kind:"slant", angle:90, spacing:g.p, origin:S.origin,
    nodes:dedupeY(g.lineNodes), tickV:g.tickV, capX, style:{ colour:S.ink, weight:S.weight, cap:"butt" } };
  // music's tail dots ride the plain lattice too — bandGeometry's latP/latOff are the
  // same thing at 90°, but keep music off the calligraphy path explicitly

  const layers = [ slant, g.hLines ];
  if (g.dots) layers.push(g.dots);
  if (capX){
    // One span per whole staff, from the same `li` grouping the calligraphy diagonals
    // use — striding nLine through `lineYs` assumed every staff was whole AND distinct,
    // which `Interline: Shared` breaks (a shared rule repeats a y). Extend each cap by
    // half the staff line's stroke so it covers the outer edges of the top/bottom
    // lines (the y's are centres).
    const capExt = S.weight / 2;
    const spans = setSpans(g).filter(s => s.whole)
      .map(s => ({ y0: s.y0 - capExt, y1: s.y1 + capExt }));
    // Per-cap weight (× line weight): the start (left) cap reads bold, the end
    // (right) cap lighter — like a real staff's opening barline. Tunable here.
    const START_CAP_MUL = 4, END_CAP_MUL = 2;
    layers.push({ kind:"endcaps", spans, style:{ colour:S.ink, weight:S.weight },   // resolved at build (S-free render)
      caps:[ { x:capX[0], mul:START_CAP_MUL }, { x:capX[1], mul:END_CAP_MUL } ] });
  }
  return layers;
}
// Margin (inset): the rectangle the grid is inset + clipped to — a uniform inset
// of N grid columns from every trim edge (so it tracks the grid), snapped onto
// gridlines. Null when Margin is off/degenerate. Separate from Border (frameRect).
function insetRect(tw, th){
  if (S.margin !== "on") return null;
  // snap each edge inward to a gridline of that axis (Seyès snaps y to its fine
  // sub-lines; ruled snaps x to its column lattice) — closes the part-square gap
  // at the far edges. The snap pitch is GRID-DECLARED (GRIDS[*].pitch → {x,y}, null
  // = don't snap that axis), replacing the old infer-from-layer-kinds filter; that
  // also drops the buildLayers() this used to call. insetRectP does the rect/snap
  // math purely once the pitch is in hand.
  let vP = null, hP = null;
  if (S.marginSnap === "on"){
    const pit = (GRIDS[S.pattern] && GRIDS[S.pattern].pitch) ? GRIDS[S.pattern].pitch() : { x:null, y:null };
    vP = pit.x; hP = pit.y;   // near ceils, far floors (inside insetRectP)
  }
  const r = insetRectP(tw, th, vP, hP);
  if (r.w <= 0 || r.h <= 0) return null;
  return { x:r.x, y:r.y, w:r.w, h:r.h };
}
// Border (frame): the rectangle stroked on top. Border is GATED on Margin — a
// frame only makes sense on an inset rect (a frame sitting on the trim edge gets
// shaved at the guillotine), so with Margin off there is no frame at all. The
// border state persists (restored when Margin returns), it just doesn't draw.
// Null when Border is off or Margin is off. Corner radius applies when rounded.
function frameRect(tw, th){
  if (S.border === "none" || S.margin !== "on") return null;
  const base = insetRect(tw, th) || { x:0, y:0, w:tw, h:th };
  return { x:base.x, y:base.y, w:base.w, h:base.h, r: S.border === "rounded" ? S.borderRadius : 0 };
}

/* Param schema. Each spec says how to render one control and how it reads /
   writes S. `length:true` = mm-native value shown in the active unit; `accept`
   is the write guard (spacing's real floor is 0.1, not the markup's min=0.5);
   `presets` builds unit-aware chips; `section:"ink"` renders into the Ink block.
   Specs are shared by reference across grids that use the same param. */

const PT_PER_MM = 72 / MM_PER_IN;                  // 1 mm = 2.8346 pt
/* Set presets: [interline gap rows before the set, rules in the set, the baseline's
   index within the set]. See thing-grids for the Spencerian proportions behind these. */
const CALLI_SETS = { compact:[1,3,1], four:[1,4,2], full:[1,5,3], ext:[1,6,3] };

/* Grid definitions: how each family builds its layers, snaps, and reports divisions.
   thing-grids also lists each family's param specs here; those live in `params` below. */
const GRIDS = {
  graph: {
    label: "Graph",
    build: () => [ lineFamily(90), lineFamily(0) ], // vertical first — preserves draw order
    pitch: () => ({ x:S.spacing, y:S.spacing }),
    divisions: c => c.cols + " × " + c.rows + " @ " + fmtU(S.spacing)
  },
  dot: {
    label: "Dot",
    build: () => [ dotFamily() ],
    pitch: () => ({ x:S.spacing, y:S.spacing }),
    divisions: c => c.cols + " × " + c.rows + " @ " + fmtU(S.spacing)
  },
  ruled: {
    label: "Ruled",
    build: () => { const l = [ lineFamily(0) ]; const m = marginLineRule(); if (m) l.push(m); return l; },
    pitch: () => ({ x:S.spacing, y:S.spacing }),
    divisions: c => c.rows + " lines @ " + fmtU(S.spacing)
  },
  seyes: {
    label: "Seyès",
    build: seyesLayers,
    pitch: () => ({ x:S.spacing, y:S.spacing/4 }),   // y snaps to the fine sub-line lattice
    divisions: c => Math.round(c.rows / 4) + " rulings @ " + fmtU(S.spacing)
  },
  calligraphy: {
    label: "Calli",
    build: () => calligraphyLayers(...(CALLI_SETS[S.calliSet] || CALLI_SETS.full)),
    pitch: () => ({ x:S.slant === 90 ? S.spacing : null, y:S.spacing }),
    divisions: () => (CALLI_SETS[S.calliSet] || CALLI_SETS.full)[1] + " line · " + S.slant
      + (S.connector === "on" ? "/" + S.connectorAngle : "") + "° @ " + fmtU(S.spacing)
  },
  music: {
    label: "Music",
    build: () => musicLayers(2, 5),
    pitch: () => ({ x:S.spacing, y:S.spacing }),
    divisions: () => "5-line staff @ " + fmtU(S.spacing)
  }
};
function buildLayers(){ return (GRIDS[S.pattern] || { build: () => [] }).build(); }
const cycleAt = (cyc, k) => cyc[((k % cyc.length) + cyc.length) % cyc.length];

// apply one styled entry's stroke settings: per-entry weight, colour, dash (mm
// pattern → px), and cap. Dash [] = solid, so existing (dash-less) grids are
// byte-identical. Round cap + a tiny on-length gives true dots.
function applyStroke(ctx, e, scale, minLine){
  ctx.strokeStyle = e.colour;                        // colour + mm weight resolved at build (S-free)
  ctx.lineWidth = Math.max(e.weight * scale, minLine) * (e.accent ? 1.9 : 1);
  ctx.setLineDash(e.dash ? e.dash.map(d => d * scale) : []);
  ctx.lineDashOffset = (e.dashOffset || 0) * scale;   // phase (e.g. dash ticks onto gridlines)
  ctx.lineCap = e.cap || "butt";
}


/* ---------------- the render (single draw path; iterates layers) ---------------- */
function renderEngine(ctx, scale, opts){
  opts = opts || {};
  const [tw,th] = trim();
  const [sw,sh] = sheet();
  const b = S.bleed;
  const minLine = opts.print ? 1 : 0.75;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,sw*scale,sh*scale);
  // Paper belongs to the exported file, not to the design: the preview always shows
  // white so a sheet reads the same on screen whichever the file will carry, and only
  // the export leaves the background transparent.
  if (!opts.print || S.paperMode !== "none"){
    ctx.fillStyle = S.paperMode === "tint" ? S.paperColor : "#FFFFFF";   // lattice: paper tint
    ctx.fillRect(0,0,sw*scale,sh*scale);
  }
  ctx.translate(b*scale, b*scale);
  ctx.lineCap = "butt";

  let cols = 0, rows = 0;

  // Margin is a CONSTRAINT on where the grid draws, not a mask: each layer is
  // bounded to the inset region [rx0..rx1]×[ry0..ry1] so marks on the edge render
  // whole (lines terminate at the edge; edge dots/strokes aren't shaved). Only a
  // rounded Border keeps a real clip, to round its corners. Border (frame) is
  // stroked on top, and is GATED on Margin — no inset, no frame (see frameRect).
  const ir = insetRect(tw, th), fr = frameRect(tw, th);
  const rad = fr ? fr.r : 0;   // rounded radius only when a frame actually draws
  const rectPath = r => { ctx.beginPath(); ctx.roundRect(r.x*scale, r.y*scale, r.w*scale, r.h*scale, r.r*scale); };
  // drawing region: inset rect when Margin on; else full bleed. (Border is gated on
  // Margin, so with Margin off there's no frame to meet — the old "trim edge when a
  // Border is on" case can't arise; edged keys off the frame that actually draws.)
  const edged = !!fr;
  const rx0 = ir ? ir.x : (edged ? 0 : -b), rx1 = ir ? ir.x + ir.w : (edged ? tw : tw + b);
  const ry0 = ir ? ir.y : (edged ? 0 : -b), ry1 = ir ? ir.y + ir.h : (edged ? th : th + b);
  const inX = v => v >= rx0 - 1e-6 && v <= rx1 + 1e-6;
  const inY = v => v >= ry0 - 1e-6 && v <= ry1 + 1e-6;
  // Sheared-lattice walk — shared by the slant-tick and both dotrows branches. Each
  // row arrives as a node { y, a }: `a` is the y the lattice is un-sheared AT, so
  // the column sits at x0 + shear·(a−y)/H. `a = th+b` (the sheet bottom) is the one
  // continuous lattice; a per-set `a` restarts it on each set's baseline.
  const H = th + 2*b;
  const AY = th + b;                                   // continuous (sheet-bottom) anchor
  const shearWalk = (pos, shear, rows, cb) => {
    for (const r of rows){
      if (!inY(r.y)) continue;
      const shift = shear * (r.a - r.y) / H;
      for (const c of pos){ const cx = c.x0 + shift; if (inX(cx)) cb(cx, r.y); }
    }
  };
  // Columns are generated for shifts in [0, shear] (the continuous lattice). A row
  // BELOW its own anchor shifts negative, so the rightmost column of the lattice
  // falls short — pad the generator's high end by the largest such shift. Zero with
  // the continuous anchor, so the column set there is bit-for-bit what it was.
  const shearPad = (rows, shear) => {
    let pad = 0;
    for (const r of rows) pad = Math.max(pad, shear * (r.y - r.a) / H);
    return pad;
  };
  // rounded Border still clips (to round the corners); generation is already
  // bounded to the rect, so this only trims the corner arcs, never straight edges.
  const clip = rad > 0 ? (ir ? { x:ir.x, y:ir.y, w:ir.w, h:ir.h, r:rad } : { x:0, y:0, w:tw, h:th, r:rad }) : null;
  if (clip){ ctx.save(); rectPath(clip); ctx.clip(); }

  const endcapLayers = [];   // drawn after the loop (never clipped) — see below
  const layers = buildLayers();
  for (const layer of layers){
    ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.lineCap = "butt";   // reset per layer
    if (layer.kind === "line"){
      const along = layer.angle === 90 ? tw : th;
      // band family (explicit mm offsets) or uniform cycle (indexed by k)
      let pos = layer.offsets
        ? bandLines(along, layer.period, layer.offsets, b, layer.origin, layer.base, layer.range)
        : lines(along, layer.spacing, b, layer.origin).map(p => ({ v:p.v, e:cycleAt(layer.cycle, p.k) }));
      // a rule shared by two sets arrives twice; stroking it twice doubles its
      // antialiased edges and it reads heavier than its weight (see dedupeY)
      pos = pos.filter((o, i) => i === 0 || Math.abs(o.v - pos[i-1].v) > 1e-6);
      if (layer.angle === 90) cols = pos.length; else rows = pos.length;
      for (const { v, e } of pos){
        if (layer.angle === 90 ? !inX(v) : !inY(v)) continue;   // bound to the region
        applyStroke(ctx, e, scale, minLine);
        ctx.beginPath();
        if (layer.angle === 90){
          ctx.moveTo(v*scale, ry0*scale); ctx.lineTo(v*scale, ry1*scale);
        } else {
          ctx.moveTo(rx0*scale, v*scale); ctx.lineTo(rx1*scale, v*scale);
        }
        ctx.stroke();
      }
    } else if (layer.kind === "slant"){ // slant ticks: a short segment at each writing-line crossing
      const shear0 = shearOf(th, b, layer.angle);
      const all = slantLines(tw, th, layer.spacing, b, layer.origin, layer.angle,
                             shearPad(layer.nodes, shear0), layer.latOff);
      // thin the tick columns — at a fine pitch every column is a wall of ticks.
      // `every` 1 (music, and the default) keeps the full lattice untouched.
      const ev = Math.max(1, Math.round(layer.every) || 1), shear = all.shear;
      const pos = ev > 1 ? all.pos.filter(c => ((c.k % ev) + ev) % ev === 0) : all.pos;
      cols = pos.length;
      const sx = shear / (th + 2*b), half = layer.tickV / 2;   // sx = dx per dy along the slant
      applyStroke(ctx, layer.style, scale, minLine);
      shearWalk(pos, shear, layer.nodes, (cx, yl) => {
        if (layer.capX && layer.capX.some(x => Math.abs(cx - x) < 1e-6)) return;  // endcap replaces the tick here
        ctx.beginPath();
        ctx.moveTo((cx + sx*half)*scale, (yl - half)*scale);
        ctx.lineTo((cx - sx*half)*scale, (yl + half)*scale);
        ctx.stroke();
      });
    } else if (layer.kind === "connect"){ // connector guides: the connective slant, per writing set
      // Each connector runs through one BASELINE node of the main slant lattice and
      // spans that set. The node is where the main lattice's column k lands on the
      // baseline: x = off + k·spacing + (a − yb)/tan(hostAngle) — the same shear the
      // ticks use, so the two families meet exactly. Along the connector,
      // x(y) = x0 + (yb − y)·ix, which is that formula again at its own angle.
      const ix = layer.angle >= 90 ? 0 : 1 / Math.tan(layer.angle * Math.PI/180);
      const hx = layer.hostAngle >= 90 ? 0 : 1 / Math.tan(layer.hostAngle * Math.PI/180);
      const off = layer.latOff != null ? layer.latOff : originOffset(tw, layer.spacing, layer.origin);
      const hyp = Math.hypot(ix, 1);              // mm along the connector per mm of y
      applyStroke(ctx, layer.style, scale, minLine);
      for (const s of layer.spans){
        if (s.y1 < ry0 - 1e-6 || s.y0 > ry1 + 1e-6) continue;
        const xb = off + hx * (s.a - s.yb);       // baseline x of the lattice's column 0
        const run = ix * (s.y1 - s.y0);           // horizontal travel across the set
        const kLo = Math.floor((rx0 - run - xb) / layer.spacing) - 1;
        const kHi = Math.ceil((rx1 + run - xb) / layer.spacing) + 1;
        if (!isFinite(kLo) || !isFinite(kHi)) continue;   // never loop on a degenerate angle/pitch
        for (let k = kLo; k <= kHi; k++){
          if (((k % layer.every) + layer.every) % layer.every !== 0) continue;
          const x0 = xb + k*layer.spacing;        // x where this connector crosses the baseline
          // clip the segment to the region: y to the set ∩ [ry0,ry1], then x by
          // solving x(y) for the region's left/right edges (x falls as y rises).
          let ya = Math.max(s.y0, ry0), yz = Math.min(s.y1, ry1);
          if (ix > 0){
            ya = Math.max(ya, s.yb - (rx1 - x0)/ix);
            yz = Math.min(yz, s.yb - (rx0 - x0)/ix);
          } else if (!inX(x0)) continue;          // upright connector: one x, in or out
          if (yz - ya <= 1e-6) continue;
          // phase the dash to the baseline crossing so every connector matches
          ctx.lineDashOffset = -(s.yb - ya) * hyp * scale;
          ctx.beginPath();
          ctx.moveTo((x0 + (s.yb - ya)*ix)*scale, ya*scale);
          ctx.lineTo((x0 + (s.yb - yz)*ix)*scale, yz*scale);
          ctx.stroke();
        }
      }
    } else if (layer.kind === "dotrows"){ // dots on the slant lattice × banded y-rows
      // Share the slant guides' x-lattice so each dot rides the same diagonal as
      // the ticks; shift each row by the slant's shear at that row's y (0 upright).
      const ang = layer.angle != null ? layer.angle : 90;
      const rows_ = bandLines(th, layer.period, layer.rows, b, layer.origin, layer.base, layer.range)
        .map(o => ({ y:o.v, a: layer.anchorAt != null ? layer.anchorAt
                            : (o.e.anchorOff != null ? o.v + o.e.anchorOff : AY) }));
      const { pos, shear } = slantLines(tw, th, layer.spacing, b, layer.origin, ang,
                                        shearPad(rows_, shearOf(th, b, ang)), layer.latOff);
      const ys = rows_;
      if (layer.mark === "cross"){
        // + marks: a horizontal arm and a vertical arm sheared to follow the slant
        // (slope shear/H), both ±tickV/2 about the centre. Upright → a plain +.
        const arm = (layer.tickV || 2) / 2, sx = shear / (th + 2*b);
        ctx.strokeStyle = layer.style.colour;
        ctx.lineWidth = Math.max(layer.style.weight * scale, minLine);
        ctx.lineCap = "butt";
        shearWalk(pos, shear, ys, (cx, cy) => {
          ctx.beginPath(); ctx.moveTo((cx - arm)*scale, cy*scale); ctx.lineTo((cx + arm)*scale, cy*scale); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo((cx + sx*arm)*scale, (cy - arm)*scale);
          ctx.lineTo((cx - sx*arm)*scale, (cy + arm)*scale);
          ctx.stroke();
        });
      } else {
        const rBase = Math.max(layer.style.dotSize/2 * scale, opts.print ? 0.6 : 0.55);
        ctx.fillStyle = layer.style.colour;
        shearWalk(pos, shear, ys, (cx, cy) => {
          ctx.beginPath(); ctx.arc(cx*scale, cy*scale, rBase, 0, Math.PI*2); ctx.fill();
        });
      }
    } else if (layer.kind === "endcaps"){ // music staff endcaps — defer past the clip
      // The bars sit exactly on the margin-rect edge (the clip boundary), so
      // drawing them here would crop them to a hairline and hide them under the
      // frame. Collect and draw after ctx.restore() (below) so they're whole.
      endcapLayers.push(layer);
    } else if (layer.kind === "dot"){ // dot lattice — accent when either axis is accented
      const xs = lines(tw, layer.spacing, b, layer.origin);
      const ys = lines(th, layer.spacing, b, layer.origin);
      cols = xs.length; rows = ys.length;
      const rBase = Math.max(layer.style.dotSize/2 * scale, opts.print ? 0.6 : 0.55);
      for (const y of ys){
        if (!inY(y.v)) continue;
        for (const x of xs){
          if (!inX(x.v)) continue;
          const ex = cycleAt(layer.cycle, x.k), ey = cycleAt(layer.cycle, y.k);
          ctx.fillStyle = (ex.colour || ey.colour) || layer.style.colour;
          const r = (ex.accent || ey.accent) ? rBase*1.7 : rBase; // clamp then multiply
          ctx.beginPath();
          ctx.arc(x.v*scale, y.v*scale, r, 0, Math.PI*2);
          ctx.fill();
        }
      }
    } else if (layer.kind === "rule"){ // margin chrome — a single positioned line, drawn over the grid
      const on = layer.axis === "v" ? inX(layer.offset) : inY(layer.offset);
      if (on){
        // A ruling of stroke w centred on the region edge extends w/2 BEYOND that
        // edge, so a rule that stops exactly at the edge finishes half a stroke
        // short of the grid's visual top and leaves a notch in the corner. Extend
        // by half the widest stroke among the lines this rule actually crosses.
        // That is NOT S.weight/2: Seyès' strong ruling is accentMul times heavier,
        // and an `accent` entry is 1.9× again on top of its own weight. Measured
        // at 0.167mm where weight/2 would have been 0.075mm, so guessing here
        // leaves a visible notch. Same idea as the music endcaps' capExt.
        const meets = layer.axis === "v" ? 0 : 90;   // a vertical rule meets horizontals
        let widest = 0;
        for (const l of layers){
          if (l.kind !== "line" || l.angle !== meets) continue;
          for (const e of (l.offsets || l.cycle || [])){
            if (!e || e.weight == null) continue;
            widest = Math.max(widest, Math.max(e.weight * scale, minLine) * (e.accent ? 1.9 : 1));
          }
        }
        const ext = widest / 2 / scale;              // px back to mm
        ctx.strokeStyle = layer.colour;
        ctx.lineWidth = Math.max(layer.weight * scale, minLine);
        ctx.beginPath();
        if (layer.axis === "v"){
          ctx.moveTo(layer.offset*scale, (ry0-ext)*scale); ctx.lineTo(layer.offset*scale, (ry1+ext)*scale);
        } else {
          ctx.moveTo((rx0-ext)*scale, layer.offset*scale); ctx.lineTo((rx1+ext)*scale, layer.offset*scale);
        }
        ctx.stroke();
      }
    }
  }

  if (clip) ctx.restore();                   // undo the grid clip
  ctx.setLineDash([]); ctx.lineCap = "butt";
  // music staff endcaps — drawn unclipped so the bars at the inset edges stay
  // whole and read as each staff's left/right cap (the music grid's own
  // boundary), not cropped to a hairline.
  for (const layer of endcapLayers){
    ctx.strokeStyle = layer.style.colour;
    for (const { x, mul } of layer.caps){       // per-cap weight: bold start, lighter end
      ctx.lineWidth = Math.max(layer.style.weight * mul * scale, minLine);
      for (const { y0, y1 } of layer.spans){
        ctx.beginPath();
        ctx.moveTo(x*scale, y0*scale); ctx.lineTo(x*scale, y1*scale);
        ctx.stroke();
      }
    }
  }
  // Border frame — the frame lever, drawn on top, sitting on the inset rect. Gated
  // on Margin (frameRect is null when Margin is off), so `fr` truthy ⇒ Margin is on.
  if (fr){
    ctx.strokeStyle = S.borderInk;
    ctx.lineWidth = Math.max(S.weight * S.borderWeight * scale, minLine);
    rectPath(fr); ctx.stroke();
  }
  /* Crop marks — where to cut. Four corners, two ticks each, out in the bleed.
   *
   * They are TICKS, never a corner: each pair stops short of the trim corner by
   * `gap`, so nothing joins and nothing crosses. That gap is the whole point of
   * the convention. A mark that met its partner would draw a corner INTO the
   * artwork's edge, and a trimmer lining up on a printed corner cannot tell the
   * mark from the work.
   *
   * Each tick lies ON its cut line, extended outward past the trim into the
   * bleed, which is exactly what makes it a guide: continue the line the tick
   * sits on and that is where the blade goes. They are drawn in sheet space,
   * after the region logic, because they belong to the sheet rather than to any
   * grid layer, and they are outside the trim so no clip should ever touch them.
   *
   * Dark and hairline regardless of the design's ink: this mark is for whoever
   * cuts the sheet, and half the palette is a near-white that would vanish.
   */
  if (S.cropMarks === "on" && b > 0){
    const gap = Math.min(2, b / 2);   // clear of the corner; halves on a thin bleed
    const len = b - gap;              // reach the sheet edge and stop
    if (len > 0.05){
      ctx.strokeStyle = "#333333";
      ctx.lineWidth = Math.max(0.1 * scale, minLine);
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
      ctx.beginPath();
      for (const [cx, sx] of [[0, -1], [tw, 1]]){
        for (const [cy, sy] of [[0, -1], [th, 1]]){
          // horizontal tick on the top/bottom cut line, reaching out sideways
          ctx.moveTo((cx + sx*gap)*scale, cy*scale);
          ctx.lineTo((cx + sx*(gap+len))*scale, cy*scale);
          // vertical tick on the left/right cut line, reaching out up/down
          ctx.moveTo(cx*scale, (cy + sy*gap)*scale);
          ctx.lineTo(cx*scale, (cy + sy*(gap+len))*scale);
        }
      }
      ctx.stroke();
    }
  }
  ctx.setTransform(1,0,0,1,0,0);
  return { cols, rows };
}



/* ======================================================================================
   Parametric contract (../DATATYPE.md)
   ====================================================================================== */

export const version = 1;
export const titleTemplate = "Grid {pattern}, {sizeKey}, {spacing}mm";

export const output = {
  surfaces: ["canvas2d"], unit: "mm", width: null, height: null,
  dpi: 600, background: "#ffffff", animated: false,
};

/* ---- conditions (thing-grids' showWhen closures, as data) ---- */
const FAM = (...f) => ({ key: "pattern", in: f });
const ON = (key, v) => ({ key, eq: v });
const CALLI = FAM("calligraphy");
const CONN_ON = { all: [CALLI, ON("connector", "on")] };
const NO_SNAP = { key: "connSnap", eq: 0 };
const usesX = { any: [ON("calliRules", "x"), ON("calliRules", "both")] };
const usesEdge = { any: [ON("calliRules", "edge"), ON("calliRules", "both"), ON("interMark", "share")] };
const dotsDrawn = { any: [
  FAM("dot"),
  { all: [FAM("calligraphy", "music"), ON("interMark", "dot")] },
  { all: [CONN_ON, ON("connectorDash", "dotted")] },
] };
const MARGIN_LINE_ON = { all: [FAM("ruled", "seyes"), ON("marginLine", "left")] };
const MARGIN_ON = ON("margin", "on");
const BORDER_ON = { all: [MARGIN_ON, { key: "border", neq: "none" }] };

/* ---- shared chip lists ---- */
const INK_CHIPS = INKS.map(([value, label]) => ({ label, value }));
const MUL = (...vs) => vs.map(v => [v, v + "×"]);
const mm = { unit: "mm" };
const color = (key, label, def, extra) => ({ key, label, kind: "color", default: def, presets: INK_CHIPS, ...extra });

/* One flat list. thing-grids keeps a spec list per family; here each family-specific
   param carries a `pattern` condition instead. Order and grouping follow lattice's
   layers(): Sheet, then Grid split into Family / Style / Embellishments / Layout. */
export const params = [
  /* ---- layer 0: the sheet ---- */
  { key: "sizeKey", label: "Size", kind: "str", control: "select", layer: "Sheet", default: "a6",
    options: Object.keys(SIZES).map(k => [k, SIZES[k][0]]) },
  { key: "customW", label: "Width", kind: "num", layer: "Sheet", default: 105, min: 10, step: 1, ...mm,
    showWhen: ON("sizeKey", "custom") },
  { key: "customH", label: "Height", kind: "num", layer: "Sheet", default: 148, min: 10, step: 1, ...mm,
    showWhen: ON("sizeKey", "custom") },
  { key: "orientation", label: "Orientation", kind: "str", control: "seg", layer: "Sheet", default: "portrait",
    options: [["portrait", "Portrait"], ["landscape", "Landscape"]] },
  { key: "fold", label: "Fold", kind: "str", control: "seg", layer: "Sheet", default: "none",
    options: [["none", "None"], ["v", "Vertical"]],
    note: "A non-destructive guide: the grid runs across the whole sheet." },
  { key: "bleed", label: "Bleed", kind: "num", layer: "Sheet", default: 5, min: 0, step: 0.5, ...mm,
    presets: [{ label: "0", value: 0 }, { label: "⅛″", value: 3.175 }, { label: "5", value: 5 }] },
  { key: "cropMarks", label: "Crop marks", kind: "str", control: "seg", layer: "Sheet", default: "off",
    options: [["off", "Off"], ["on", "On"]], showWhen: { key: "bleed", neq: 0 } },
  { key: "paperMode", label: "Paper", kind: "str", control: "seg", layer: "Sheet", default: "white",
    options: [["white", "White"], ["tint", "Tint"], ["none", "None"]],
    note: "The preview always shows paper; None leaves the export transparent." },
  { key: "paperColor", label: "Paper colour", kind: "color", layer: "Sheet", default: "#FFFDF6",
    showWhen: ON("paperMode", "tint") },
  { key: "dpi", label: "Resolution", kind: "int", control: "seg", layer: "Sheet", default: 600,
    options: [[300, "300"], [600, "600"], [1200, "1200"]],
    note: "PNG carries its own resolution tag, so it places at true size." },

  /* ---- layer 1: the grid — Family ---- */
  { key: "pattern", label: "Family", kind: "str", control: "tiles", layer: "Grid", section: "Family", default: "graph",
    options: Object.keys(GRIDS).map(k => [k, GRIDS[k].label]),
    // lattice's THUMB: a fixed, gray, 18 mm square so the tile shows the geometry, not the design
    thumbnail: {
      sizeKey: "custom", customW: 18, customH: 18, orientation: "portrait",
      bleed: 0, fold: "none", margin: "off", border: "none", origin: "trim",
      paperMode: "white", paperColor: "#FFFFFF", cropMarks: "off",
      spacing: 4.5, emph: 0, slant: 55, calliSet: "compact", interMark: "dot",
      guidePhase: "cont", connector: "off", calliRules: "even", slantStyle: "ticks", slantEvery: 1,
      slantInk: "#A2A7AD", slantSpace: "even",
      weight: 0.15, dotSize: 0.35, tickH: 1.2,
      ink: "#A2A7AD", accentInk: "#6E747A", marginLineInk: "#A2A7AD",
    } },
  { key: "spacing", label: "Spacing", kind: "num", layer: "Grid", section: "Family", default: 5, min: 0.1, step: 0.1, ...mm,
    // mm chips, then thing-grids' inch-native pitches; Seyès' traditional 8 mm is in the list
    presets: [[2.5, "2.5"], [3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"], [10, "10"],
              [2.54, "⅒″"], [3.175, "⅛″"], [4.233, "⅙″"], [5.08, "⅕″"], [6.35, "¼″"], [8.466, "⅓″"], [10.16, "⅖″"]]
      .map(([value, label]) => ({ label, value })) },
  // calligraphy: rows
  { key: "calliSet", label: "Set", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "full",
    options: [["compact", "3-line"], ["four", "4-line"], ["full", "5-line"], ["ext", "6-line"]], showWhen: CALLI },
  { key: "calliRules", label: "Rules", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "even",
    options: [["even", "Off"], ["x", "x-height"], ["edge", "Edges"], ["both", "Both"]], showWhen: CALLI,
    note: "Which rules of a set are emphasised. x-height and Edges each carry their own ink and weight." },
  { key: "interSpace", label: "Interline space", kind: "num", layer: "Grid", section: "Family", default: 1, min: 0, max: 8, step: 0.05,
    showWhen: { all: [FAM("calligraphy", "music"), ON("interMark", "space")] },
    presets: [{ label: "1×", value: 1 }, { label: "½", value: 0.5 }, { label: "⅓", value: 0.3333 }, { label: "¼", value: 0.25 }] },
  color("xInk", "x-height ink", "#EDEBE6", { layer: "Grid", section: "Family", showWhen: { all: [CALLI, usesX] } }),
  { key: "xMul", label: "x-height weight", kind: "num", control: "select", layer: "Grid", section: "Family", default: 2,
    options: MUL(1, 1.5, 2, 2.5, 3), showWhen: { all: [CALLI, usesX] } },
  color("edgeInk", "Edge ink", "#EDEBE6", { layer: "Grid", section: "Family", showWhen: { all: [CALLI, usesEdge] } }),
  { key: "edgeMul", label: "Edge weight", kind: "num", control: "select", layer: "Grid", section: "Family", default: 2,
    options: MUL(1, 1.5, 2, 2.5, 3), showWhen: { all: [CALLI, usesEdge] } },
  // calligraphy: slant
  { key: "slant", label: "Slant", kind: "num", layer: "Grid", section: "Family", default: 90, min: 5, max: 90, step: 1, unit: "°",
    showWhen: CALLI,
    // hands, not bare angles: each sets the connective slant taught with it
    presets: [{ label: "Black", value: 90, also: { connectorAngle: 90 } }, { label: "Italic", value: 85, also: { connectorAngle: 45 } },
              { label: "Spencer", value: 52, also: { connectorAngle: 30 } }, { label: "Copper", value: 55, also: { connectorAngle: 40 } }] },
  { key: "guidePhase", label: "Guide phase", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "set",
    options: [["cont", "Continuous"], ["set", "Per row"]], showWhen: CALLI,
    note: "Continuous runs one lattice down the sheet; Per row restarts it on each row's baseline." },
  { key: "slantStyle", label: "Slant style", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "ticks",
    options: [["ticks", "Ticks"], ["lines", "Lines"]], showWhen: CALLI },
  { key: "slantSpace", label: "Slant spacing", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "even",
    options: [["even", "Even"], ["sync", "Synced"], ["col", "Per column"]], showWhen: CALLI },
  { key: "slantEvery", label: "Slant every", kind: "num", control: "select", layer: "Grid", section: "Family", default: 1,
    options: [[1, "Column"], [2, "2nd column"], [3, "3rd column"], [4, "4th column"]],
    showWhen: { all: [CALLI, { key: "slantSpace", neq: "sync" }] } },
  { key: "slantPer", label: "Slants per row", kind: "num", control: "select", layer: "Grid", section: "Family", default: 1,
    options: [[0.25, "¼"], [0.5, "½"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"]],
    showWhen: { all: [CALLI, ON("slantSpace", "sync")] } },
  color("slantInk", "Slant ink", "#EDEBE6", { layer: "Grid", section: "Family", showWhen: CALLI }),
  { key: "slantMul", label: "Slant weight", kind: "num", control: "select", layer: "Grid", section: "Family", default: 1,
    options: MUL(0.5, 0.75, 1, 1.5, 2), showWhen: CALLI },
  // calligraphy: connector
  { key: "connector", label: "Connector", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "off",
    options: [["off", "Off"], ["on", "On"]], showWhen: CALLI },
  { key: "connSnap", label: "Connector snap", kind: "num", control: "select", layer: "Grid", section: "Family", default: 0,
    options: [[0, "Off"], [1, "1 row"], [2, "2 rows"], [3, "3 rows"], [4, "4 rows"]], showWhen: CONN_ON },
  { key: "connectorAngle", label: "Connector angle", kind: "num", layer: "Grid", section: "Family", default: 30, min: 5, max: 90, step: 1, unit: "°",
    showWhen: { all: [CONN_ON, NO_SNAP] },
    presets: [{ label: "Spencer", value: 30 }, { label: "Copper", value: 40 }, { label: "Italic", value: 45 }, { label: "60°", value: 60 }] },
  { key: "connectorEvery", label: "Connector every", kind: "num", control: "select", layer: "Grid", section: "Family", default: 3,
    options: [[1, "Column"], [2, "2nd column"], [3, "3rd column"], [4, "4th column"]],
    showWhen: { all: [CONN_ON, { any: [{ key: "connSnap", neq: 0 }, { key: "slantSpace", neq: "sync" }] }] } },
  { key: "connPer", label: "Connectors per row", kind: "num", control: "select", layer: "Grid", section: "Family", default: 1,
    options: [[0.25, "¼"], [0.5, "½"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [6, "6"]],
    showWhen: { all: [CONN_ON, NO_SNAP, ON("slantSpace", "sync")] } },
  { key: "connectorDash", label: "Connector line", kind: "str", control: "seg", layer: "Grid", section: "Family", default: "dashed",
    options: [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]], showWhen: CONN_ON },
  color("connectorInk", "Connector ink", "#E3A9B8", { layer: "Grid", section: "Family", showWhen: CONN_ON }),
  { key: "connMul", label: "Connector weight", kind: "num", control: "select", layer: "Grid", section: "Family", default: 1,
    options: MUL(0.5, 0.75, 1, 1.5, 2), showWhen: { all: [CONN_ON, { key: "connectorDash", neq: "dotted" }] } },

  /* ---- Grid — Style ---- */
  color("ink", "Main ink", "#EDEBE6", { layer: "Grid", section: "Style" }),
  { key: "weight", label: "Line weight", kind: "num", layer: "Grid", section: "Style", default: 0.15, min: 0.02, max: 2, step: 0.01, ...mm,
    showWhen: FAM("graph", "ruled", "seyes", "calligraphy", "music"),
    presets: [{ label: "¼ pt", value: 0.088 }, { label: "0.1", value: 0.1 }, { label: "0.15", value: 0.15 }, { label: "0.25", value: 0.25 }, { label: "1 pt", value: 0.353 }] },
  { key: "dotSize", label: "Dot size", kind: "num", layer: "Grid", section: "Style", default: 0.4, min: 0.02, max: 2, step: 0.01, ...mm,
    showWhen: dotsDrawn },
  { key: "emph", label: "Accent line", kind: "num", control: "select", layer: "Grid", section: "Style", default: 0,
    options: [[0, "None"], [2, "Every 2nd"], [4, "Every 4th"], [5, "Every 5th"], [10, "Every 10th"]],
    showWhen: FAM("graph", "dot", "ruled") },
  color("accentInk", "Accent ink", "#EDEBE6", { layer: "Grid", section: "Style", showWhen: FAM("graph", "dot", "seyes") }),
  { key: "accentMul", label: "Accent weight", kind: "num", control: "select", layer: "Grid", section: "Style", default: 2,
    options: MUL(1.5, 2, 2.5, 3), showWhen: FAM("graph", "dot", "seyes") },
  { key: "interMark", label: "Interline", kind: "str", control: "seg", layer: "Grid", section: "Style", default: "dot",
    options: [["dot", "Dots"], ["cross", "Crosses"], ["space", "Space"], ["share", "Shared"]], showWhen: FAM("calligraphy", "music") },
  { key: "tickH", label: "Tick height", kind: "num", layer: "Grid", section: "Style", default: 2, min: 0.5, step: 0.5, ...mm,
    showWhen: FAM("calligraphy", "music") },

  /* ---- Grid — Embellishments ---- */
  { key: "marginLine", label: "Margin line", kind: "str", control: "seg", layer: "Grid", section: "Embellishments", default: "left",
    options: [["none", "Off"], ["left", "Left"]], showWhen: FAM("ruled", "seyes") },
  { key: "marginLineAt", label: "Margin line at", kind: "num", control: "select", layer: "Grid", section: "Embellishments", default: 2,
    options: [[1, "1 col"], [2, "2 cols"], [3, "3 cols"]], showWhen: MARGIN_LINE_ON },
  color("marginLineInk", "Margin line ink", "#E3A9B8", { layer: "Grid", section: "Embellishments", showWhen: MARGIN_LINE_ON }),
  { key: "marginLineMul", label: "Margin line weight", kind: "num", control: "select", layer: "Grid", section: "Embellishments", default: 2,
    options: MUL(1, 1.5, 2, 3), showWhen: MARGIN_LINE_ON },
  { key: "border", label: "Border", kind: "str", control: "seg", layer: "Grid", section: "Embellishments", default: "none",
    options: [["none", "None"], ["square", "Square"], ["rounded", "Rounded"]], showWhen: MARGIN_ON,
    note: "A frame needs an inset to sit on, so Border only shows with Margin on." },
  { key: "borderRadius", label: "Corner radius", kind: "num", layer: "Grid", section: "Embellishments", default: 3, min: 0, step: 0.5, ...mm,
    showWhen: { all: [MARGIN_ON, ON("border", "rounded")] } },
  color("borderInk", "Border ink", "#E3A9B8", { layer: "Grid", section: "Embellishments", showWhen: BORDER_ON }),
  { key: "borderWeight", label: "Border weight", kind: "num", control: "select", layer: "Grid", section: "Embellishments", default: 1.5,
    options: MUL(1, 1.5, 2, 3), showWhen: BORDER_ON },

  /* ---- Grid — Layout ---- */
  { key: "origin", label: "Origin", kind: "str", control: "seg", layer: "Grid", section: "Layout", default: "trim",
    options: [["trim", "Trim corner"], ["center", "Centered"]] },
  { key: "margin", label: "Margin", kind: "str", control: "seg", layer: "Grid", section: "Layout", default: "off",
    options: [["off", "Off"], ["on", "On"]] },
  { key: "marginInset", label: "Inset", kind: "int", layer: "Grid", section: "Layout", default: 1, min: 0, step: 1,
    showWhen: MARGIN_ON, note: "In grid columns." },
  { key: "marginSnap", label: "Snap to grid", kind: "str", control: "seg", layer: "Grid", section: "Layout", default: "on",
    options: [["off", "Off"], ["on", "On"]], showWhen: MARGIN_ON },

  /* ---- view (never stored) ---- */
  { key: "unit", label: "Units", kind: "str", control: "seg", bucket: "view", default: "mm", options: [["mm", "mm"], ["in", "in"]] },
  { key: "showTrim", label: "Trim guides", kind: "bool", bucket: "view", default: true },
  { key: "zoom", label: "Zoom", kind: "str", control: "seg", bucket: "view", default: "fit", options: [["fit", "Fit"], ["actual", "Actual size"]] },
];

export const presets = [
  { name: "Graph 5 mm",        values: { pattern: "graph" } },
  { name: "Dot 5 mm",          values: { pattern: "dot" } },
  { name: "Ruled 6 mm",        values: { pattern: "ruled", spacing: 6 } },
  { name: "Seyès 8 mm",        values: { pattern: "seyes", spacing: 8 } },
  { name: "Copperplate sheet", values: { pattern: "calligraphy", spacing: 2.5, calliSet: "full", slant: 55,
                                         connector: "on", connectorAngle: 40, calliRules: "both", interMark: "space" } },
  { name: "Music staff",       values: { pattern: "music", spacing: 2, margin: "on", marginInset: 2 } },
];

/* ---- code exports ---- */

const VIEW_DEFAULTS = { unit: "mm", showTrim: true, zoom: "fit" };
let lastCounts = { cols: 0, rows: 0 };

// The sheet: trim plus bleed on every edge, in mm. What the renderer sizes the surface to.
export function extent(values){
  setState({ ...VIEW_DEFAULTS, ...values });
  const [width, height] = sheet();
  return { width, height };
}

// The engine draws in device pixels with its own transform (it resets the ctx transform
// and multiplies every coordinate by `scale`), so it takes surface.scale directly and
// ignores any pre-scaling. Its origin is the trim corner; it translates by the bleed
// itself, so the whole sheet lands in [0, width] × [0, height].
// `surface.export` (true when rendering for a file) maps to the engine's `print` option:
// 1 px hairline floor instead of 0.75, and a transparent background for paperMode "none".
export function render(values, surface){
  setState({ ...VIEW_DEFAULTS, ...surface.view, ...values });
  lastCounts = renderEngine(surface.ctx, surface.scale, { print: !!surface.export });
}

// Dynamic captions: thing-grids' spec `note` closures, the collapsed-layer summaries from
// lattice's layers(), and the docket line.
export function notes(values, view){
  setState({ ...VIEW_DEFAULTS, ...view, ...values });
  const s = S, n = {};
  const [tw, th] = trim(), [sw, sh] = sheet();
  const c = CALLI_SETS[s.calliSet] || CALLI_SETS.full;

  { const exactW = Math.abs(tw/s.spacing - Math.round(tw/s.spacing)) < 1e-6;
    const exactH = Math.abs(th/s.spacing - Math.round(th/s.spacing)) < 1e-6;
    n.origin = s.origin === "trim"
      ? "First line sits on the trim edge. " + (exactW && exactH
          ? "Divides the trim exactly on both axes."
          : "Leaves a part square at the far edge" + (exactW ? " (bottom)" : exactH ? " (right)" : "") + ".")
      : "Part squares split evenly between opposite edges."; }
  { const px = s.weight / MM_PER_IN * s.dpi;
    n.weight = round(s.weight,3) + " mm = " + round(s.weight * PT_PER_MM, 2) + " pt = "
      + round(px,1) + " px at " + s.dpi + " dpi"
      + (px < 1 ? " — thinner than one pixel, so it prints at 1 px." : "."); }
  n.dotSize = round(s.dotSize,3) + " mm = " + round(s.dotSize * PT_PER_MM, 2) + " pt diameter.";
  n.interSpace = round(s.interSpace, 4) + " × " + fmtU(s.spacing) + " = " + fmtU(s.interSpace * s.spacing) + " between rows.";
  { const a = Math.min(90, Math.max(5, s.slant)) * Math.PI/180;
    const p = s.spacing, g = fmtU;
    n.slantSpace = s.slantSpace === "even"
      ? "Matches the GAP YOU SEE: square-on, guides sit " + g(p) + " apart, the same as the rules. Along a rule that is "
        + g(p / Math.sin(a)) + " — wider than the rules, since a leaning line has further to travel between them."
      : s.slantSpace === "col"
      ? "Matches the GRID: one guide per column, " + g(p) + " apart along a rule, the same as the rules. But leaning shortens the gap you see to "
        + g(p * Math.sin(a)) + ", so they read tighter than the rules."
      : "Matches the ROWS: each guide starts where its neighbour did one writing row below. Guides sit "
        + g(latPitch(p, s.slant, bandMetrics(c[0], c[1]).P)) + " apart along a rule."; }
  { const rows = bandMetrics(c[0], c[1]).P / s.spacing;
    n.slantPer = s.slantPer < 1
      ? "A guide starts every " + Math.round(1/s.slantPer) + " writing rows" + (s.guidePhase === "set" ? " — but Per row re-anchors each row, so every row keeps its origin." : ".")
      : "One guide starts on each writing row's baseline. " + (Math.abs(rows - Math.round(rows)) < 1e-9
          ? Math.round(rows) + " puts one on every rule."
          : "A fractional Interline space means no whole value lands one on every rule."); }
  n.connPer = s.connPer >= 1
    ? "One connector starts on each writing row's baseline, where the slant does."
    : "A connector starts every " + Math.round(1/s.connPer) + " writing rows.";
  if (!s.connSnap) n.connSnap = "Off: Connector angle is whatever you dial.";
  else {
    const a = snapAngle(s.spacing, s.slant, bandMetrics(c[0], c[1]).P, s.connSnap);
    const rp = bandMetrics(c[0], c[1]).P / s.spacing;
    const gcd = (x, y) => y < 1e-9 ? x : gcd(y, x % y);
    const every = Math.abs(rp - Math.round(rp)) > 1e-9 ? null : Math.round(s.connSnap / gcd(s.connSnap, Math.round(rp)));
    n.connSnap = "Angle computed: " + round(a, 1) + "° — one node to the node " + s.connSnap + (s.connSnap === 1 ? " rule" : " rules")
      + " up, one column across. Connectors ride the slant's own columns while snap is on."
      + (every === 1 ? " Every connector lands on one."
         : every ? " Lands on the lattice every " + every + " writing rows — " + Math.round(rp) + " rows per row of writing, so pick a snap that divides it."
         : "");
  }
  n.bleed = s.bleed === 0 ? "No bleed. Any drift on the guillotine will show a white edge."
    : s.bleed < MIN_BLEED - 1e-9 ? "Under the 1/8 in (3.175 mm) most printers ask for."
    : "Grid is laid from the trim edge and runs out through the bleed.";
  { const mp = px(sw) * px(sh) / 1e6;
    n.dpi = px(sw).toLocaleString() + " × " + px(sh).toLocaleString() + " px, ≈" + mp.toFixed(mp > 120 ? 0 : 1) + " Mpx"
      + (mp > 120 ? ". Large enough that some browsers will refuse to render it — drop to 300 dpi if the export comes back blank." : "."); }
  n.fold = s.fold === "none" ? "No fold. Flat single-panel sheet."
    : FOLD_PANELS + " panels · " + round(toUnit(tw/FOLD_PANELS),2) + " × " + fmtU(th) + " each";

  // collapsed-layer summaries (lattice layers()) and the docket
  const fam = GRIDS[s.pattern];
  n["$layer:Sheet"] = [
    s.sizeKey === "custom" ? round(toUnit(s.customW),2) + "x" + round(toUnit(s.customH),2) : (SIZES[s.sizeKey] || [])[0] || s.sizeKey,
    s.orientation === "landscape" ? "landscape" : "portrait",
    s.bleed > 0 ? "bleed " + round(toUnit(s.bleed),2) : "no bleed",
  ].join(", ");
  n["$layer:Grid"] = (fam ? fam.label : s.pattern) + ", " + round(toUnit(s.spacing),2);
  n.$status = (fam ? fam.label : s.pattern) + "  " + (fam ? fam.divisions(lastCounts) : "")
    + "  ·  " + round(toUnit(tw),2) + " × " + fmtU(th) + " trim"
    + (s.bleed > 0 ? ", bleed " + fmtU(s.bleed) : "") + "  ·  " + s.dpi + " dpi";
  return n;
}
