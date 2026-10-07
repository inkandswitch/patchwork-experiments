// Example sources for the menu. Every one compiles (examples.test.js checks)
// and fits inside its bounds. Y is up, units are metres.

export const EXAMPLES = [
  {
    id: "gyroid-block",
    title: "Gyroid block",
    bounds: { min: [-0.17, -0.17, -0.17], max: [0.17, 0.17, 0.17] },
    source: `// A gyroid lattice clipped to a rounded box, fused to a solid base plate.
// Try changing the cell size (100mm) or the wall thickness (8mm).
let s = 0.3
let body = roundBox(s, s, s, 25mm)
let lattice = intersect(body, gyroid(100mm, 8mm))
let plate = translate(0, -s/2 + 6mm, 0, roundBox(s, 12mm, s, 5mm))

smoothUnion(6mm, lattice, plate)
`,
  },
  {
    id: "cleat",
    title: "Mooring cleat",
    bounds: { min: [-0.12, -0.02, -0.05], max: [0.12, 0.1, 0.05] },
    source: `// A mooring cleat: a base, two posts and a tapered horn,
// blended with 14 mm fillets, flat underneath, with two bolt holes.
let base = roundBox(0.17, 12mm, 55mm, 6mm)
let post(dx) = translate(dx, 30mm, 0, capsule(13mm, 40mm))
// the horn's radius shrinks towards its tips: arguments can use x, y, z
let horn = segment(-0.1, 62mm, 0, 0.1, 62mm, 0, 12mm - abs(x) * 0.05)
let hole(dx) = translate(dx, 0, 0, cylinder(4mm, 0.1))

subtract(
  intersect(
    smoothUnion(14mm, base, post(-38mm), post(38mm), horn),
    plane(0, -1, 0, 6mm)),   // keep everything above y = -6 mm
  hole(-68mm), hole(68mm))
`,
  },
  {
    id: "hull",
    title: "Hull blend",
    bounds: { min: [-0.56, -0.38, -0.17], max: [0.56, 0.16, 0.17] },
    source: `// A hull-like body: an ellipsoid that narrows towards the bow (+X),
// cut flat at the deck, with a fin keel, a ballast bulb and a deckhouse,
// all blended with 20 mm fillets.
let beam = 0.13 - 0.05 * max(x, 0) / 0.5
let body = intersect(ellipsoid(0.5, 0.12, beam), plane(0, 1, 0, 40mm))
let keel = translate(0.02, -0.2, 0, rotateZ(-12deg, roundBox(0.12, 0.2, 14mm, 6mm)))
let bulb = translate(0.03, -0.31, 0, rotateZ(90deg, capsule(26mm, 0.14)))
let house = translate(-0.1, 0.06, 0, roundBox(0.22, 60mm, 0.12, 25mm))

smoothUnion(20mm, body, keel, bulb, house)
`,
  },
  {
    id: "tower",
    title: "Twisted tower",
    bounds: { min: [-0.11, -0.27, -0.11], max: [0.11, 0.27, 0.11] },
    source: `// A rounded square tower twisted as it rises,
// hollowed into a 14 mm shell and cut open at the top.
let h = 0.5
let section = roundBox(0.12, h, 0.12, 20mm)
let tower = twist(3, section)   // 3 radians per metre of height

intersect(shell(14mm, tower), plane(0, 1, 0, 0.2))
`,
  },
  {
    id: "chain",
    title: "Chain links",
    bounds: { min: [-0.19, -0.06, -0.06], max: [0.19, 0.06, 0.06] },
    source: `// Three interlocking chain links. Each link is a torus stretched along X,
// written with at(), which evaluates a shape at a warped point.
let stretch = 35mm
let ring = rotateX(90deg, torus(30mm, 8mm))
let link = at(x - clamp(x, -stretch, stretch), y, z, ring)
let pitch = 0.1

union(
  translate(-pitch, 0, 0, link),
  rotateX(90deg, link),
  translate(pitch, 0, 0, link))
`,
  },
  {
    id: "vase",
    title: "Rippled vase",
    bounds: { min: [-0.12, -0.17, -0.12], max: [0.12, 0.17, 0.12] },
    source: `// A vase whose radius is a function of height and angle.
// Dividing by 1.3 keeps the distance conservative where the wall ripples.
let h = 0.3
let angle = atan(z, x)
let r = 0.07 + 0.03 * sin(y * 12) + 4mm * sin(angle * 9)
let body = max((length(x, z) - r) / 1.3, abs(y) - h/2)

// cut below the top wall (which spans h/2 ± 4mm) to open the vase
intersect(shell(8mm, body), plane(0, 1, 0, h/2 - 10mm))
`,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];

/** The example whose source matches exactly, if any. */
export function exampleFor(source) {
  return EXAMPLES.find((e) => e.source === source) ?? null;
}
