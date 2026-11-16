# Weather

A world's weather as physical data. One scene trait, `weather`, says where and
when the world is and what the air and sky are doing. One extension offers it
as the world's two existing ambient conventions, `wind` and `atmosphere`
(scene STAGE.md, "Ambients" and "Atmosphere"). Everything that already reads
those (the viewport's sky, sun and fog, water's tint, reflection and roughness,
sailing's sea and every boat's physics) follows the weather without knowing
this package exists.

Status: W0 (this scaffold) is in. The trait is described and the extension
runs, but it offers nothing until W2. The plan's steps are listed under "Plan"
below.

## The data

The trait is flat: one field per inspector slider, so two peers dialling
different fields at once both keep their edit (writes are field by field,
STAGE.md "Describing traits"). A missing field is its default, and `init` is
the defaults.

| Field | Meaning | Default | Range |
|---|---|---|---|
| `place` | a name, for people | `"Cadboro Bay"` | text |
| `lat`, `lon` | degrees north, east (WGS84) | 48.454, -123.2915 | ±90, ±180 |
| `zone` | IANA time zone the clock reads in | `"America/Vancouver"` | text |
| `date` | local calendar date, `YYYY-MM-DD` | `"2026-07-15"` | text |
| `hour` | local clock hour (the sun slider) | 15 | 0..24, step 0.25 |
| `wind` | mean wind speed at 10 m, m/s | 4 | 0..30 |
| `from` | wind direction, degrees true, where it blows from | 235 | 0..360 |
| `gust` | gust speed, m/s | none: 30% over the wind | 0..45 |
| `seed` | the gusts' seed | 1 | integer |
| `cover` | cloud cover, 0 clear to 1 overcast | 0.35 | 0..1 |
| `clouds` | `cumulus` / `stratocumulus` / `stratus` / `cirrus` | `cumulus` | enum |
| `base` | cloud base, m | 1200 | 50..12000 (log) |
| `visibility` | horizontal visibility, m | 10000 | 100..50000 (log) |
| `rain` | precipitation, mm/h | 0 | 0..20 |
| `source` | set only by a fetch: `{ name, api, for, fetched, sum }` | none | not described |

`source` says where a snapshot came from: the provider (`"Open-Meteo"`), which
API (`forecast` or `archive`), the hour the data is for and when it was fetched
(ISO), and `sum`, a key of the fields as fetched. Nothing describes it, so the
inspector neither shows nor touches it. The pure `provenance(trait)` compares
`sum` with the fields as they are now and answers "fetched", "dialled since
fetch" or "dialled". Nothing has to intercept an edit to know.

## What it offers

`ambient()` is a pure function of the trait, cached by its filled-in params
(sailing's weather.js pattern), and null without the trait. It offers the two
existing conventions and adds no new ambient:

- **`wind`** = `{ speed: wind, from, seed, gustiness }`, with
  `gustiness = clamp(gust / wind - 1, 0, 1)` (sailing's model: gustiness g
  means speed ±g), 0.3 when `gust` is missing, and 0 in a calm. The
  convention's own documentation moves here from sailing/DESIGN.md in W5.
- **`atmosphere`** = `atmosphereOf(trait)` (STAGE.md's shape):
  - **sun**: the direction comes from `solar.js` (the NOAA/Meeus low-accuracy
    algorithm, with apparent elevation through Bennett's refraction) at
    `instantOf(date, hour, zone)` and `lat`/`lon`. It is mapped to the stage's
    frame, north -Z and east +X (terrain tmerc.js, sailing wind.js), as
    `[sin A cos E, sin E, -cos A cos E]`. The sun is present only while its
    apparent elevation is above -0.833° (its upper limb on the horizon).
    Intensity, colour and shadows follow elevation and cover.
  - **sky** gradient and **exposure**: interpolated in linear RGB over a finite
    anchor table indexed by cover, kind and visibility, and by sun elevation
    in bands (day, low, horizon, civil twilight, night). The anchors are the
    existing art direction, reproduced exactly at their conditions:
    - sailing's bright day: cover 0.35, cumulus;
    - Ucluelet's clear afternoon: cover 0;
    - Ukee grey: cover 1, stratocumulus, base 600 m, visibility 19 km;
    - the marine layer: visibility under 1 km.

    Twilight and night are new art direction.
  - **fog**: from visibility, Koschmieder style (`far ≈ 0.9 · visibility`).
    Rain lowers the visibility and darkens the sky.
  - **clouds**: from cover, kind and base, with a per-kind table for contrast
    and cell scale.

## The outermost rule

A world's ambients are its outermost doc's (STAGE.md). So a boat linked into a
harbour sails in the harbour's wind under the harbour's sky, and the boat's
own weather counts only where she is the world. Nothing in the weather has to
know about links. A dry room (the Model room, the Model basin) carries no
weather: no wind, and the stage's own look.

## The consumers (unchanged code)

| Ambient | Reader | What it does with it |
|---|---|---|
| `atmosphere` | scene viewport (`lighting()`, the sky pass, fog) | sky gradient, sun as the key light, shadows, exposure, cloud deck |
| `atmosphere` | water's surface (`material.js`, `cloudAt`) | reflection of the sky and clouds; overcast scatter when there are no shadows |
| `wind` | sailing `sea.js` | the waves' spectrum |
| `wind` | sailing `sea-view.js` | every boat's true wind (`createWind`) |
| `wind` | water `surface.js` | roughness and foam |

## What moves (W5, W6)

- **sailing** loses `weather.js` and the `sailing.weather` trait. Its Sea and
  Sloop parts bring the trait key `weather` as data: a late-bound runtime
  lookup, never a build-time dependency.
- **terrain**'s place trait stops offering an atmosphere. It keeps the shore,
  exposure and grain, and is renamed `terrain.place`, because a trait called
  sky that gives no sky is a rough edge. `SKIES` leave terrain and become this
  package's anchors. The Ucluelet and Cadboro templates write a `weather` with
  their place preset.

## Setting it

Both ways are in Edit, on the scene inspector, which stays on the scene when
nothing is selected. There is no menu diving.

- **Dial it in**: every number is a bounded slider. Visibility and cloud base
  use log sliders.
- **Commands** (null target, `edit: true`, `show: ["inspector"]`):
  - **Place** is a choice of Cadboro Bay (48.454, -123.2915), Ucluelet
    (48.95, -125.558) or Here (the current lat/lon). It writes place, lat, lon
    and zone in one change.
  - **Now** sets date and hour to the present in the zone.
  - **Fetch now** and **Fetch for this time** fetch from Open-Meteo in the
    pressing viewer's browser, then write the fields plus `source` in one
    change. The provenance is shown in the command's title.

## Fetch

`open-meteo.js` is pure except for one `fetch` call.

- **Routing**: `requestFor(lat, lon, instant, now)` goes to the forecast API's
  `current` when the instant is within 30 min of now. Otherwise it goes to
  forecast `hourly` when the instant is between now - 90 d and now + 15 d, and
  to the archive API (ERA5, 1940 to now - 5 d) for anything older.
- **What leaves the machine**: only coordinates, times and variable names. The
  query keys are a fixed whitelist, which a test checks. Units are
  `wind_speed_unit=ms` and `timezone=GMT`. No identity or user data is sent.
- **Model**: `best_match`. Both `gem_seamless` and the archive return
  `visibility: null` (checked live on 2026-11-16), so visibility, cloud base
  and kind are derived when absent:
  - base from the lifting condensation level, `125 m · (T - Td)`, clamped to
    100..3000 m;
  - kind from the low, mid and high cloud layers and the WMO weather code;
  - visibility from the code, precipitation and relative humidity.
- **Snapshot**: `snapshotFrom(json, request)` takes the hour nearest the
  request. A failure, or an `{ error: true, reason }` reply, becomes a notice
  and leaves the doc untouched.
- **Never automatic**: nothing in `ambient()`, an update or the loop fetches.
  The weather is a snapshot in the doc until someone presses Fetch again.

## Plan

| Step | What | State |
|---|---|---|
| W0 | package scaffold, this doc, the fetch-from-Patchwork spike | done |
| W1 | `time.js` (`instantOf`) and `solar.js` (`sunAt`, `sunDirection`), against published ephemerides | |
| W2 | `windOf`, `atmosphereOf` (pure), with the anchors as fixed points | |
| W3 | the extension's ambient, inspector fields, the Place and Now commands; local probe | |
| W4 | `open-meteo.js`, Fetch commands, recorded fixtures | |
| W5 | sailing reads the weather's wind; `sailing.weather` goes | |
| W6 | `terrain.sky` → `terrain.place`; the place templates write weather | |
| W7 | end-to-end local probe: weather reaches sky, water and boat | |
| W8 | republish every boating example with weather; swap links | |
| W9 | real-Patchwork checks (sun, sky, wind at the boat, a fetch) | |

## Decisions

1. **One package, one unprefixed scene trait, `weather`.** The package owns
   the name as water owns `water`. It offers only the existing `wind` and
   `atmosphere` conventions, so no consumer changes and no new ambient
   exists. *Decided unattended (2026-11-16, lane/weather), for the lead.*
2. **The trait is flat, not nested** (`wind`, `from` and `gust` rather than
   `wind: { speed, from }`). Each field is one slider, and concurrent edits
   merge field by field. *Decided unattended (2026-11-16, lane/weather), for
   the lead.*
3. **The default is a fair summer afternoon at Cadboro Bay**: 15:00 PDT on
   15 July 2026, wind 4 m/s from 235° (the Cadboro template's), cover 0.35
   cumulus at 1200 m, visibility 10 km (so the fog's far is the bright day's
   9 km). Sailing's old default, 7 m/s from 45°, was a working breeze with
   no place; examples that want it say so. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
4. **`gust` has no default.** A missing gust means the stock gustiness, 30%
   over the wind, and no fixed number says that, so the field shows empty.
   *Decided unattended (2026-11-16, lane/weather), for the lead.*
5. **`source` is not described.** The inspector neither shows nor touches
   it, and provenance comes from its `sum`. So dialling a fetched field needs
   no hook to mark the snapshot stale. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
6. **Ranges**: cloud base 50..12 000 m on a log slider (cirrus sits at
   6–12 km), visibility 100..50 000 m on a log slider, rain 0..20 mm/h,
   wind 0..30 m/s, gusts 0..45 m/s. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
7. **The fetch runs in the page, with no worker or embed.** The W0 spike
   (below) found no Content-Security-Policy on patchwork.inkandswitch.com,
   neither as a header nor as a meta tag, and Open-Meteo answers with
   `access-control-allow-origin: *` on both `api.` and `archive-api.`. A
   fetch from the page context succeeded in Chrome. The scene's extensions
   run in that page's document (no iframe), so the Fetch command calls
   `fetch` directly. *Decided unattended (2026-11-16, lane/weather), for the
   lead.*
8. **The standalone check's file count.** water's `standalone.test.js`
   asserts more than 10 files, which a scaffold doesn't have. The copy here
   asserts instead that the files it walks include `src/index.js` and
   itself. Every file is still read. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*

## Spike: can a tool in Patchwork fetch Open-Meteo? (W0)

- `curl -I https://patchwork.inkandswitch.com/`: no
  `content-security-policy` header, and the HTML has no
  `http-equiv` meta tag.
- `curl -I` on both APIs with `Origin: https://patchwork.inkandswitch.com`:
  `access-control-allow-origin: *`.
- The browser check is `probes/fetch-spike.mjs`: one headless Chrome on
  the real page with no doc opened, so nothing is written. Run on
  2026-11-16, it found:
  - `location.origin` is `https://patchwork.inkandswitch.com`;
  - there are no `http-equiv` metas and no iframes;
  - `fetch("https://api.open-meteo.com/v1/forecast?latitude=48.454&longitude=-123.2915&current=wind_speed_10m")`
    returned 200 with `current: { time: "2026-11-16T19:30", interval: 900, wind_speed_10m: 5.6 }`
    (km/h: no `wind_speed_unit` was asked for, so W4 asks for `ms`);
  - the archive's 2025-07-15 Ucluelet hourly fetch returned 200 with 24
    hours;
  - no `securitypolicyviolation` fired.

## Costs

- **W0**: none at run time. The extension runs where the trait is and offers
  nothing.
- **Planned**: `ambient()` runs on every flush but is a cache hit unless the
  trait changed. `atmosphereOf` (a solar position, about a hundred flops, and
  a table lookup) runs only on a change. Dragging the hour slider writes a
  change per input event, as every slider does, and each one is one
  recompute and one viewport relight.
- **Fetch**: one HTTP request per press, from the pressing viewer only.
  Open-Meteo's free tier allows 10 000 calls a day for non-commercial use,
  far beyond a button. The snapshot goes stale silently: the doc says when it
  was fetched, and nothing refetches.

## Questions for the lead

1. Does the day pass? The default is a fixed snapshot, so the sun stays
   where date and hour put it. The alternative is that the sun follows world
   time (date and hour plus `clock.t`), reflushing every minute.
2. Ucluelet's Ukee grey and Cadboro's bright day become fixed points of one
   generic sky model, and terrain gives no sky of its own. Is that enough, or
   should a place keep an art-direction override?
3. The UI is the scene inspector in Edit. Do you want a dedicated weather
   pane (a compass dial, a day scrubber with the sun's path), or a weather
   chip on N8's world bar that shows outside Edit?
4. Dry rooms (the Model room, the Model basin, the basin mashup, the Quiet
   games room, Games night) have no weather. Should any of them be under a
   sky, such as the Breezy pavilion?
5. The data source is Open-Meteo `best_match`, plus the ERA5 archive for the
   past. Should Canadian places use GEM explicitly, with the source naming
   the model, even though it returns no visibility?
6. A fetch is a one-time snapshot written by whoever presses it, and it is
   not on the undo stack (a package's writes can't be without a scene
   change). Is that acceptable, or do you want undo, or a live mode that
   refetches hourly?
7. Night has no moon, and rain shows only as lower visibility and a darker
   sky, with no particles. Is that OK for now?
