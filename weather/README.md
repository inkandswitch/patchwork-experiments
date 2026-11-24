# weather

A world's weather for scenes: one scene trait, `weather`, plain physical
data, offered as the world's `wind` and `atmosphere` ambients, a pure
function of the trait, so every peer and the deterministic sim compute the
same world from the doc. One `scene:extension`, `weather`
(`src/extension.js`). The design and its decisions:
[WEATHER.md](WEATHER.md).

```
pnpm install && pnpm build && pnpm test
```

## Conventions

What other packages may rely on (scene/CONVENTIONS.md lists them).

| Name | |
|---|---|
| trait `weather` | on the scene, flat, one field per slider, a missing field its default: `{ lat: 48.454, lon: -123.2915, date: "2026-07-15", hour: 15, offset: -7, wind: 4, from: 235, gustiness: 0.3, seed: 1, cover: 0.35, clouds: "cumulus", base: 1200, visibility: 10000, rain: 0 }`: degrees north and east; the date and hour on a clock `offset` hours from UTC; wind m/s at 10 m, from a bearing (degrees from −Z, north, toward +X, east); gustiness 0..1; an integer gust seed; cover 0..1; `clouds` one of `cumulus`, `stratocumulus`, `stratus`, `cirrus`; cloud base and visibility in metres; rain mm/h. A fetched snapshot also writes `source` (`{ name, api, for, fetched, fields }`), which nothing else reads. Written by sailing's Sea and Sloop parts and terrain's templates |
| ambient `wind` | `{ speed, from, seed, gustiness }`, the trait's `wind`, `from`, `seed` and `gustiness` passed through (WEATHER.md, "What it offers"), in the outermost doc's root frame on its world time; null without the trait. Sailing makes it a wind field (`wind.js`) and its seas' waves; the water package's fine waves and foam follow `speed` and `from` |
| ambient `atmosphere` | scene's convention (scene/CONVENTIONS.md, "Atmosphere"), made from the trait: the sun where it is for the place and time, the sky, fog and clouds from cover, base and visibility |

Where this doc is the outermost, its weather is the world's; a linked
world brings its things, not its weather (`api.ambient("wind").mine`).
