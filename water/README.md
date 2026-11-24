# water

Water for scenes: a shape (an object with the `water` trait), drawn, and
asked by whatever floats or swims which water a point is in. One
`scene:extension`, `water` (`src/extension.js`), and two parts, Water and
Pond. Why it is shaped so, and how it was built: [WATER.md](WATER.md).

```
pnpm install && pnpm build && pnpm test
```

## Conventions

What other packages may rely on (scene/CONVENTIONS.md lists them). Lengths
are metres; a bearing is degrees from −Z (north) toward +X (east).

| Name | |
|---|---|
| trait `water` | on an object, its origin the surface at rest: `{ size?: [w, d, l], clip?: [w, d, l], colour?: { deep?, scatter?, shore? } }`. No `size`: **open water**, everything below the origin; only the outermost doc's counts (the lowest id of its shown open bodies), offered as the ambient `water`, and a linked doc's floats on its world's instead. `clip` (open water only): the box it keeps, as its doc's own, where the world it is placed in offers no open water. `size`: a **box** `w` across (x) and `l` long (z), `d` deep below the origin, its doc's own wherever the doc is placed, never offered. `colour`: sRGB `#rrggbb` per field, the rest the water's own. Written by sailing's Sea and Sloop parts, terrain's templates and ink-studio's "Add this world's water" |
| trait `water.current` | `{ speed: 0.5, toward: 0 }` (m/s, a bearing) on a water object: it drifts, carrying its waves and what floats in it |
| ambient `water` | the world's open water, in the outermost doc's root frame on its world time, or none: `{ v, level, components, look?, current? }`. `level`: the surface's height; `components`: the waves, `[{ dir: [dx, dz], k, omega, amp, steep, phase }]` (Gerstner: unit direction, rad/m, rad/s, m, steepness, rad), already carried by the current; `look`: `{ seed, stats: { hs, peakPeriod, peakWavelength, whitecaps } }`; `current`: `[ux, uz]` m/s, absent when still. Read it through the contribution `water`, which maps it to a stage's frame and clock |
| contribution `water` | `{ at(p, { not? }) → reader \| null }`, in its stage's frame and on its clock: the water point `p` (`[x, y, z]`; `y` null: from above) is in, leaving out any water carried by `not` (an object id or a list: what a hull or a support carries along). A reader is `{ body, level, components, heightAt(x, z, t), sampleAt(x, z, t, out), normalAt(x, z, t, out?), velocityAt(x, y, z, t, out?), displaced(x0, z0, t, out?) }` plus `seed` and `stats` for open water; `body` the box's object id, null for open water; `t` world seconds (`use("clock").t()`) |
| contribution `water.waves` (collected) | what makes waves gives `{ bodies: { [objectId]: { components, look? } } }` in the water's stage, `components` and `look` as in the ambient, in that object's frame. For each body the last contributor in running order wins whole. Sailing's sea gives it, from the world's `wind` |
| contribution `water.shore` (collected) | the shore's shape round an eye, for the reflection (WATER.md, "The shore in the water"); the last one's counts: `{ v, azimuths, bins, near, reach, profile(eye) → { key, eye, data } \| null, exposure?(from) → { key, n, data, origin, u, v, size } \| null }`. `data` holds, per azimuth (2π(a + ½)/azimuths from +x toward +z) and per log-spaced distance bin (bin b at near·(reach/near)^(b/(bins−1)) m), four numbers: the highest land elevation at or beyond it (rad), that point's distance (km), the nearest land at or beyond it (km), and the highest elevation within a kilometre past that (rad). `exposure(from)`: for a wind from bearing `from`, `n` × `n` bytes over `size` m a side at `origin` along axes `u` and `v`, each how open that water is to the wind (255: the open sea). A `key` changes iff its data does. Terrain's place gives it |

It reads the world's ambients `wind` (the weather package's: speed and
from) and `atmosphere` (scene's: the sky it reflects).
