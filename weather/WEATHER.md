# Weather

A world's weather as physical data. One scene trait, `weather`, says where and
when the world is and what the air and sky are doing. One extension offers it
as the world's two existing ambient conventions, `wind` and `atmosphere`
(scene STAGE.md, "Ambients" and "Atmosphere"). Everything that already reads
those (the viewport's sky, sun and fog, water's tint, reflection and roughness,
sailing's sea and every boat's physics) follows the weather without knowing
this package exists.

Status: W0 (the scaffold) and W1 (the sun from time and place: `time.js`,
`solar.js`) are in. The trait is described and the extension runs, but it
offers nothing until W2. The plan's steps are listed under "Plan" below.

## The data

The trait is flat: one field per inspector slider, so two peers dialling
different fields at once both keep their edit (writes are field by field,
STAGE.md "Describing traits"). A missing field is its default, and `init` is
the defaults.

Each row is the field exactly as `index.js` describes it: `index.test.js`
reads this table and checks every field against it, so the doc is the spec.

| Field | Kind | Default | Min | Max | Step | Slider | Meaning |
|---|---|---|---|---|---|---|---|
| `place` | string | `"Cadboro Bay"` | | | | | a name, for people |
| `lat` | number | 48.454 | -90 | 90 | 0.0001 | | degrees north (WGS84) |
| `lon` | number | -123.2915 | -180 | 180 | 0.0001 | | degrees east (WGS84) |
| `zone` | string | `"America/Vancouver"` | | | | | the IANA time zone the clock reads in |
| `date` | string | `"2026-07-15"` | | | | | local calendar date, `YYYY-MM-DD` |
| `hour` | number | 15 | 0 | 24 | 0.25 | | local clock hour: the sun slider |
| `wind` | number | 4 | 0 | 40 | 0.1 | | mean wind speed at 10 m, m/s |
| `from` | number | 235 | 0 | 360 | 1 | | where the wind blows from, degrees true |
| `gustiness` | number | 0.3 | 0 | 1 | 0.05 | | the hour's peak gust over the mean, less 1: 0.3 is gusts to 130% and lulls to 70% (sailing's model) |
| `seed` | integer | 1 | | | | | the gusts' seed |
| `cover` | number | 0.35 | 0 | 1 | 0.05 | | cloud cover, 0 clear to 1 overcast |
| `clouds` | enum | `"cumulus"` | | | | | `cumulus`, `stratocumulus`, `stratus` or `cirrus` |
| `base` | number | 1200 | 50 | 12000 | 50 | log | cloud base, m |
| `visibility` | number | 10000 | 100 | 50000 | 100 | log | horizontal visibility, m |
| `rain` | number | 0 | 0 | 50 | 0.1 | | precipitation, mm/h |

Every field has a default, so every slider shows the value in force and can
be dialled back to it. One more key, `source`, is written only by a fetch
(`{ name, api, for, fetched, sum }`) and is not described.

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

- **`wind`** = `{ speed: wind, from, seed, gustiness }`: the trait's own
  fields, passed through. `gustiness` is sailing's quantity (g: speed ±g,
  direction ±33°·g), so nothing converts it. The convention's own
  documentation moves here from sailing/DESIGN.md in W5.
- **`atmosphere`** = `atmosphereOf(trait)` (STAGE.md's shape):
  - **sun**: the direction comes from `solar.js`'s `sunAt` at
    `instantOf({ date, hour, zone })` (`time.js`) and `lat`/`lon`: Meeus's
    low-accuracy algorithm, the one NOAA's calculator uses, with the hour
    angle from apparent sidereal time and the apparent elevation through
    Sæmundsson's refraction (Bennett's, inverted; Decision 14). It is
    mapped to the stage's frame, north -Z and east +X (terrain tmerc.js,
    sailing wind.js), by `sunDirection(azimuth, elevation)` =
    `[sin A cos E, sin E, -cos A cos E]`. The sun is present only while its
    *geometric* elevation (`sunAt`'s `geometric`) is above -0.833°: the
    almanac's sunrise, where refraction lifts the upper limb onto the
    horizon. The bands below (civil twilight to -6°, night by -12°) are
    geometric too, as the almanac's are; only the direction uses the
    apparent elevation.
  - **The look** (sky gradient, sun colour and intensity, exposure, fog near)
    comes from a finite table of looks, each a complete daytime atmosphere,
    combined in three steps:
    1. *Cloud.* The sky's effective cover is `cover · opacity(kind)`, with
       opacity 1 for cumulus, stratocumulus and stratus and 0.3 for cirrus
       (thin cirrus lets the blue through). The look is interpolated
       piecewise linearly over effective cover between three nodes: 0 (the
       clear afternoon), 0.35 (the bright day) and 1 (Ukee grey). Colours
       interpolate in linear RGB, numbers linearly.
    2. *Haze.* The haze weight `h` is 0 at visibility ≥ 10 km and 1 at
       ≤ 1 km, linear in log visibility between. The look blends by `h`
       toward the fogbound look (the marine layer), whatever the cover: in
       thick fog the sky is the fog.
    3. *Sun elevation.* That look holds while the sun is 20° or more up.
       Below, it blends through bands (low, horizon, civil twilight to -6°,
       night by -12°) toward new art direction, with exposure
       non-increasing as the sun sinks.

    Rain is a darkening of the sky and a cut in visibility, and is the
    identity at 0 mm/h.
  - **fog**: the colour is the sky's horizon (true of all four anchors), far
    is `0.9 · visibility` (Koschmieder style), and near is the look's near
    ratio times far.
  - **shadows**: only while effective cover < 0.75, `h` < 0.5 and the sun
    is above 2°.
  - **clouds**: `{ cover, contrast, scale, base }`, with cover and base
    taken from the trait and contrast and scale from a per-kind table
    (cumulus 0.25 and 700, stratocumulus 0.12 and 500, from the anchors;
    stratus and cirrus are new). There is no deck at cover 0 or at `h` = 1:
    a clear sky has none, and fog hides it.

### The anchors (fixed points)

The existing art direction is four looks. Each is reproduced at its
conditions, with the sun 20° or more up: sky colours, fog colour and near,
sun colour, intensity and shadows, exposure, and clouds (present or absent).
Only the sun's direction moves, to where the real sun is.

| Look | Was | Cover | Clouds | Base | Visibility | `h` | Fog far |
|---|---|---|---|---|---|---|---|
| bright day | sailing `ATMOSPHERE` | 0.35 | cumulus | 1200 | 10 000 | 0 | 9000 (same) |
| clear afternoon | terrain `SKIES` | 0 | any | any | 20 000 | 0 | 18 000 (same) |
| Ukee grey | terrain `SKIES` | 1 | stratocumulus | 600 | 19 000 | 0 | 17 100 (was 17 000) |
| marine layer | terrain `SKIES` | any | any | any | 1000 | 1 | 900 (same) |

The weather's defaults are the bright day's conditions, so a new world looks
as sailing's did. The one number that moves is Ukee grey's fog far, by 0.6%
(Decision 9).

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
- **Gusts**: `gustiness = clamp(gust / wind - 1, 0, 1)`, from the hour's
  peak gust (`wind_gusts_10m`) and mean. In a calm (wind under 0.5 m/s) a
  gust factor means nothing, and the default 0.3 is written (Decision 10).
- **Ranges**: every fetched number is clamped to its described range (for
  example, wind 45 m/s becomes 40), so a snapshot is always a state the
  sliders can show.
- **Snapshot**: `snapshotFrom(json, request)` takes the hour nearest the
  request. A failure, or an `{ error: true, reason }` reply, becomes a notice
  and leaves the doc untouched.
- **Never automatic**: nothing in `ambient()`, an update or the loop fetches.
  The weather is a snapshot in the doc until someone presses Fetch again.

## Plan

| Step | What | State |
|---|---|---|
| W0 | package scaffold, this doc, the fetch-from-Patchwork spike; review fixes (gustiness, the doc's table as spec, the entry evaluated alone, the sky model settled) | done |
| W1 | `time.js` (`instantOf`, `localOf`, `offsetAt`, `validDate`, `validZone`) and `solar.js` (`sunAt`, `sunDirection`, `refraction`), against Meeus's, NREL's and USNO's published values; every quarter hour of three Vancouver days round-tripped. `validDate` and `validZone` are the predicates W2's params use to fall back to the default (Decision 16) | done |
| W2 | `weatherParams` (defaults, and the fallback rows: an invalid zone or a malformed date is the default, from W1's predicates), `windOf` (a pass-through), `atmosphereOf` (pure) as specified under "The look", with the four anchors as fixed points; presence and bands on the geometric elevation | |
| W3 | the extension's ambient, inspector fields, the Place and Now commands; local probe | |
| W4 | `open-meteo.js`, Fetch commands, recorded fixtures; table rows for gust factor {1.3, 2, 2.5, calm} → gustiness {0.3, 1, 1, 0.3} and for clamping (wind 45, rain 80) | |
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
2. **The trait is flat, not nested** (`wind`, `from` and `gustiness` rather than
   `wind: { speed, from }`). Each field is one slider, and concurrent edits
   merge field by field. *Decided unattended (2026-11-16, lane/weather), for
   the lead.*
3. **The default is a fair summer afternoon at Cadboro Bay**: 15:00 PDT on
   15 July 2026, wind 4 m/s from 235° (the Cadboro template's), cover 0.35
   cumulus at 1200 m, visibility 10 km (so the fog's far is the bright day's
   9 km). Sailing's old default, 7 m/s from 45°, was a working breeze with
   no place; examples that want it say so. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
4. **The gusts are `gustiness`, sailing's own quantity, with default 0.3.**
   W0 had `gust` in m/s with no default, meaning "30% over the wind". The
   review found that such a field can't be cleared once set (an emptied
   number input writes nothing), and that its slider shows a value that
   isn't in force. A gust in m/s can't have a default, because the stock
   gust scales with the wind. `gustiness` can: the slider always shows what
   is in force, `windOf` passes it through, and the fetch converts the
   hour's peak (Decision 10). *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
5. **`source` is not described.** The inspector neither shows nor touches
   it, and provenance comes from its `sum`. So dialling a fetched field needs
   no hook to mark the snapshot stale. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
6. **Ranges**: cloud base 50..12 000 m on a log slider (cirrus sits at
   6–12 km); visibility 100..50 000 m on a log slider; rain 0..50 mm/h (a
   Pacific Northwest cloudburst; W0's 20 was short of heavy showers); wind
   0..40 m/s (above hurricane force, 32.7; W0's 30 was a Ucluelet storm);
   gustiness 0..1 (sailing's range). A fetch clamps into them. *Decided
   unattended (2026-11-16, lane/weather), for the lead.*
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

9. **The sky model is cloud, then haze, then the sun's elevation, and its
   anchors are stated by their visibilities.** W0's doc said both "fog far
   ≈ 0.9 · visibility" and "the anchors reproduced exactly", which can't
   both hold for the old numbers, and it gave no interpolation between four
   scattered points. The model under "The look" is defined everywhere and
   meets every anchor:
   - cover nodes 0, 0.35 and 1;
   - haze from 10 km down to 1 km;
   - fog far at 0.9 · visibility;
   - fog near as a per-look ratio of far (the old ratios are 0.044, 0.033,
     0.053 and 0.033, so no single rule fits them).

   Ukee grey keeps a round 19 km visibility, so its fog far moves from
   17 000 to 17 100. The alternative, a visibility of 18 889 m, is a
   number nobody would dial. The cover nodes come from two places' art, so
   the sky's top gets bluer from cover 0 to 0.35 before it greys. That is
   inherited art direction, not physics. If it reads wrong, the cover-0
   node is the one to redraw. *Decided unattended (2026-11-16,
   lane/weather), for the lead.*
10. **A fetched gust maps to gustiness with a scale of 1:
    `g = clamp(peak / mean - 1, 0, 1)`.** Sailing's gust noise is clamped
    to ±1. Measured at a fixed point over an hour (speeds 2, 5 and 10 m/s ×
    seeds 1, 7 and 42, g 0.5), the model's peak speed reaches
    `mean · (1 + 0.97..1.00 · g)`. So the observed hourly peak gust is the
    model's hourly peak. The review's worry that a gust factor of 1.5–2
    "overdrives" is about the model's symmetric lulls and veers, not about
    this mapping. At a gust factor of 1.5, the model's deepest lull is 50%
    of the mean. Real turbulence, with intensity about (G - 1)/3 and lulls
    about 2.5σ, gives about 58%. At a gust factor of 2 (light, fluky air)
    the lulls reach calm, which happens. Changing the lulls' shape is a
    sailing change, not this package's. *Decided unattended (2026-11-16,
    lane/weather), for the lead.*
11. **The entry's worker-safety is checked by running it.** W0's regex
    missed `export * from` and an unspaced `import{…}from`. The test now
    copies `index.js` alone into an empty folder and imports it in a fresh
    node. Any static import or re-export, in any spelling, fails there.
    `load()` is shown to be the only thing that reaches for `extension.js`.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
12. **The standalone lint.** patchwork-experiments has no `pnpm lint`
    script. The proof uses patchwork-base's `scripts/lint-standalone.mjs`,
    with its root (line 35) replaced by `process.env.LINT_ROOT`, run as
    `LINT_ROOT=/Users/pvh/dev/pe-lane-weather node lint-standalone.mjs`. It
    reports 130 findings on both this lane and the scene-stage baseline,
    and none under `weather/`. The "weather" hits are the unrelated
    `cards/cards/weather` (`@embark/weather`, plugin ids `weather-card`
    and so on: no clash). The other proof is the folder copied out alone
    (`git archive`): `pnpm install --frozen-lockfile`, build and test all
    pass. *Decided unattended (2026-11-16, lane/weather), for the lead.*
13. **A local time that names no instant, or two, is resolved as clocks
    do.** In a fall-back overlap (01:30 on 2026-11-01 in Vancouver happens
    twice) it is the earlier instant, 01:30 PDT. In a spring-forward gap
    (02:30 on 2026-03-08 never happens) it is the later instant, the clock
    pushed forward by the gap: 03:30 PDT. That is Temporal's and Date's
    "compatible" rule; the plan's "the later offset" for the gap meant this
    (the later instant uses the offset in force *before* the jump). So on
    the spring-forward date the hour slider's 02:00–02:45 put the sun where
    it is at 03:00–03:45 PDT, and 03:00 steps it back to 03:00 PDT. The
    slider's hour that no clock shows is a repeat, rather than a sun that
    pauses. Table rows in time.test.js
    cover both directions in both hemispheres. *Decided unattended
    (2026-11-16, lane/weather), for the lead.*
14. **The sun is Meeus's low-accuracy algorithm, in UT, with three
    choices.** (a) The hour angle comes from apparent sidereal time (Meeus
    ch. 12, plus the nutation's principal term) and the sun's apparent
    right ascension, not from NOAA's equation-of-time shortcut, which errs
    by seconds of time and is no shorter. (b) Time is UT, not TT: ΔT
    (about 69 s) moves the sun 0.003°, a third of the algorithm's 0.01°,
    and a ΔT table would be an appendage. (c) Refraction is Sæmundsson's
    formula (Meeus 16.4), the true-to-apparent inverse of Bennett's, which
    the plan named (Bennett's runs apparent to true). It diverges at
    -5.11°, so below -1° it holds its -1° value: continuous, and it only
    moves a sun that is below the horizon. It assumes standard air (1010
    hPa, 10 °C). Measured: Meeus Example 25.a to 0.000005° in right
    ascension and declination; the NREL SPA example to 0.005° in zenith and
    azimuth; USNO's 2026 equinoxes and solstices to 0.006°. *Decided
    unattended (2026-11-16, lane/weather), for the lead.*
15. **The zone's rules are the runtime's.** `instantOf` reads offsets
    through `Intl.DateTimeFormat`, so a doc's sun is the same on every peer
    whose time-zone data agrees for that date and zone, which is every
    up-to-date browser and node for any real zone today. A zone whose rules
    change (a country dropping DST) moves the sun by an hour on peers that
    haven't updated, until they do. Storing a UTC offset instead would
    pin it, but no one dials an offset, and it would be wrong half the year
    for a date dialled across a DST change. *Decided unattended
    (2026-11-16, lane/weather), for the lead.*
16. **`instantOf` throws on an invalid date, zone or hour; the params fall
    back.** W0 carried "an invalid zone or a malformed date falls back to
    the default" to W1. A pure time function shouldn't know the weather's
    defaults, so W1 provides the predicates, `validDate` (a real proleptic
    Gregorian `YYYY-MM-DD`, years 1–9999) and `validZone` (a zone this
    runtime's Intl knows), each with a table, and W2's `weatherParams`
    uses them to fall back field by field. The ambient never throws.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
17. **`localOf(t, zone)`, the inverse, is in W1.** The Now and Fetch now
    commands (W3, W4) need the zone's clock at an instant, and the inverse
    makes `instantOf`'s exhaustive table possible: every quarter hour of a
    summer day, the spring-forward day and the fall-back day round-trips
    (in the gap it reads an hour later, as Decision 13 says). *Decided
    unattended (2026-11-16, lane/weather), for the lead.*

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

- **W0**: none at run time. The extension runs where the trait is and
  offers nothing. In the tests, `index.test.js` spawns one node (about
  50 ms) to evaluate the entry alone.
- **W1**: none at run time until W2 calls it. `sunAt` is about 40
  transcendental calls; `instantOf` is three or four `formatToParts` calls on a
  formatter cached per zone (a few microseconds each). Both run only when
  the trait changes.
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
