import type {OpenscadDoc} from "./types"

export const DEFAULT_SOURCE = `// A simple parametric box with a lid recess.
// Edit the numbers below and press Render (or wait for auto-render).

width = 40;
depth = 30;
height = 18;
wall = 2.5;

module box() {
  difference() {
    cube([width, depth, height]);
    translate([wall, wall, wall])
      cube([width - wall * 2, depth - wall * 2, height]);
  }
}

module studs() {
  positions = [
    [wall * 2, wall * 2],
    [width - wall * 2, wall * 2],
    [wall * 2, depth - wall * 2],
    [width - wall * 2, depth - wall * 2],
  ];
  for (p = positions)
    translate([p[0], p[1], height])
      cylinder(h = 4, r = 3, $fn = 32);
}

box();
studs();
`

export const OpenscadDatatype = {
	init(doc: OpenscadDoc) {
		doc.title = "OpenSCAD"
		doc.source = DEFAULT_SOURCE
	},

	getTitle(doc: OpenscadDoc) {
		return doc.title || "OpenSCAD"
	},

	setTitle(doc: OpenscadDoc, title: string) {
		doc.title = title
	},

	markCopy(doc: OpenscadDoc) {
		doc.title = `Copy of ${OpenscadDatatype.getTitle(doc)}`
	},

	/**
	 * The document as source another tool can include: its OpenSCAD text for
	 * "scad", nothing for any other format. This is what lets one OpenSCAD
	 * document `include <name.scad>` or `use <name.scad>` another linked into
	 * its imports, as a library of modules (see linkedSources.ts).
	 */
	asSource(doc: OpenscadDoc, format: string): string | null {
		if (format !== "scad") return null
		const source = doc?.source as unknown
		if (typeof source === "string") return source
		const val = (source as {val?: unknown} | null)?.val
		return typeof val === "string" ? val : null
	},
}
