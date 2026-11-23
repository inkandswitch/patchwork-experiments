// Models for the harness. `pack` is a battery module's shape: cells pressed
// against barriers in a lidded, translucent enclosure, two rows of modules.
export const SAMPLES: Record<string, string> = {
	pack: `// A small battery pack
module cell() color("royalblue") cube([10, 20, 30]);
module barrier() color("darkorange") cube([1, 20, 30]);
module enclosure() {
  color("dimgray", 0.35) difference() {
    cube([40, 30, 40]);
    translate([2, 2, 2]) cube([36, 26, 40]);
  }
  color("gray", 0.25) translate([0, 0, 38]) cube([40, 30, 2]);
}
module battery_module() {
  for (i = [0 : 2]) translate([4 + i * 11, 5, 4]) {
    cell();
    if (i < 2) translate([10, 0, 0]) barrier();
  }
  enclosure();
}
for (k = [0 : 1]) translate([k * 50, 0, 0]) battery_module();
`,
}
