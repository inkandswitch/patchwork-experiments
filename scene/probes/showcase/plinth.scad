// A display plinth sized from the sculpture that stands on it.
// `sculpture` is the Twisted strands document, imported as data (drag any
// document onto the Imports bar to bind it). Change the sculpture's bounds and
// this plinth rebuilds to fit, in the editor and in every scene showing it.

margin = 45;     // mm of top around the sculpture
height = 320;    // mm
chamfer = 14;    // mm

// the sculpture's footprint, metres -> mm (its Y is up; OpenSCAD's Z is up)
w = (sculpture.bounds.max[0] - sculpture.bounds.min[0]) * 1000 + 2 * margin;
d = (sculpture.bounds.max[2] - sculpture.bounds.min[2]) * 1000 + 2 * margin;

module slab(sx, sy, h, c) {
  hull() {
    translate([-sx/2 + c, -sy/2 + c, 0]) cube([sx - 2*c, sy - 2*c, h]);
    translate([-sx/2, -sy/2, c]) cube([sx, sy, h - 2*c]);
  }
}

difference() {
  union() {
    slab(w + 40, d + 40, 24, 6);                         // foot
    translate([0, 0, 18]) slab(w, d, height - 36, chamfer);  // body
    translate([0, 0, height - 30]) slab(w + 20, d + 20, 30, 6);  // cap
  }
  // a shallow recess on the front face for a label
  translate([-w/4, -d/2 - 1, height * 0.55]) cube([w/2, 4, 40]);
}
