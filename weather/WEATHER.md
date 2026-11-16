# Weather

A world's weather as physical data. One scene trait, `weather`, says where and
when the world is and what the air and sky are doing. One extension offers it
as the world's two existing ambient conventions, `wind` and `atmosphere`
(scene STAGE.md, "Ambients" and "Atmosphere"). Everything that already reads
those (the viewport's sky, sun and fog, water's tint, reflection and roughness,
sailing's sea and every boat's physics) follows the weather without knowing
this package exists.

Status: W0 (the scaffold), W1 (the sun from time and place: `time.js`,
`solar.js`) and W2 (the ambients as pure functions: `weather.js`'s
`weatherParams` and `windOf`, `atmosphere.js`'s `atmosphereOf`) and W3 (the
extension offers them, and the Place and Now commands: `extension.js`) are
in. A doc with the trait now has its weather's wind, sun and sky. The plan's
steps are listed under "Plan" below.

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

The sum is exact, not a hash: `sumOf(params)` is the JSON of the summed fields
in force, in order, so no dialled weather can pass for a fetched one. The
summed fields (`SUMMED`) are every field but `place`, a label, and `seed`,
which picks the gust pattern and is not weather: a snapshot speaks for its
conditions and for the place and moment they are of, so moving the hour or
the coordinates after a fetch makes it "dialled since fetch" too
(Decision 29).

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
    low-accuracy algorithm, whose solar coordinates NOAA's calculator also
    uses, with the hour angle from apparent sidereal time and the
    `apparent` elevation through Sæmundsson's refraction (Bennett's,
    inverted; Decision 14). It is mapped to the stage's frame, north -Z
    and east +X (terrain tmerc.js, sailing wind.js), by
    `sunDirection(azimuth, apparent)` =
    `[sin A cos E, sin E, -cos A cos E]`. The sun gives light only while
    its *geometric* elevation (`sunAt`'s `geometric`) is above -0.833°:
    the almanac's sunrise, where refraction lifts the upper limb onto the
    horizon. Its disc fades to black there with its light, and its colour
    rounds to `#000000` a thousandth of a degree early. Below that the atmosphere keeps a dark sun
    (colour `#000000`, intensity 0) pointing where the sun is, so the
    stage's own key light never stands in for it (Decision 19). The bands
    below (civil twilight to -6°, night by -12°) are geometric too, as the
    almanac's are, and so is every other elevation gate below (the 20° hold,
    the 2° shadow gate); only the direction uses the `apparent` elevation
    (Decision 18). Under the default weather
    (Cadboro Bay, 2026-07-15 15:00 PDT) the sun is at azimuth 225.57° and
    apparent elevation 56.30°, a solar.test.js row checked against an
    independent ephemeris.
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
    3. *Sun elevation.* That look holds while the sun's geometric
       elevation is 20° or more. Below, it is filtered through the bands
       (the table below; linear between nodes, night held below -12°):
       each sky colour by a gain and a tint, the sun's colour by a tint and
       `disc`, its intensity by `light`, and exposure by its factor. A tint
       is greyed toward white by `s = max(effective cover, h)`, so an
       overcast or fogbound sunset dims but stays grey (Decision 20).
       Exposure never rises as the sun sinks.

    Rain does two things, and at 0 mm/h neither: its extinction,
    `0.25 · R^0.73` per km, adds to the air's (`3.912 / visibility`,
    Koschmieder), which draws the visibility in force and so the haze in;
    and at that haze it darkens the sky's colours and the sun's intensity
    by `wet = 1 - 0.3 · R / (R + 4)` (Decision 21). Moderate rain alone
    (2.5 mm/h) sees about 8 km, heavy rain (25 mm/h) about 1.5 km.

    | Band | Geometric | Top | Horizon | Bottom | Sun tint | `disc` | `light` | Exposure | Key light |
    |---|---|---|---|---|---|---|---|---|---|
    | day | 20° and up | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
    | low | 6° | 0.85 × (0.97, 1, 1.04) | 0.95 × (1.08, 0.98, 0.85) | 0.85 × (1.03, 0.99, 0.94) | (1, 0.83, 0.62) | 0.7 | 0.95 | 0.92 | 0.612 |
    | horizon | 0° | 0.5 × (0.92, 0.96, 1.1) | 0.75 × (1.3, 0.78, 0.45) | 0.5 × (1.12, 0.88, 0.75) | (1, 0.55, 0.25) | 0.2 | 0.8 | 0.72 | 0.115 |
    | set | -0.833° | 0.42 × (0.9, 0.95, 1.12) | 0.62 × (1.3, 0.72, 0.45) | 0.42 × (1.1, 0.86, 0.78) | (1, 0.5, 0.22) | 0 | 0 | 0.64 | 0 |
    | civil | -6° | 0.06 × (0.75, 0.88, 1.25) | 0.1 × (1.1, 0.8, 0.85) | 0.05 × (0.85, 0.9, 1.1) | (1, 0.5, 0.22) | 0 | 0 | 0.3 | 0 |
    | night | -12° and down | 0.008 × (0.7, 0.85, 1.35) | 0.01 × (0.85, 0.9, 1.15) | 0.006 × (0.85, 0.9, 1.1) | (1, 0.5, 0.22) | 0 | 0 | 0.15 | 0 |

    The light the sun actually delivers is the stage's key light,
    `sun.color × intensity × exposure` (viewport.js `lighting()`), so all
    three factors multiply: the last column, `disc · light · exposure`, is
    that light as a fraction of the day's (before the tint and the look's
    own colour and intensity). At 6° it is 0.61 of the day's, at 0° 0.115,
    and from set on nothing. The table is the spec: atmosphere.test.js
    parses it and checks `BANDS` against every cell, the last column
    included.

    The sun's colour (and so its disc in the sky, which the stage draws in
    `sun.color` whatever the intensity) is the look's, tinted, times
    `disc`; its intensity is the look's times `light` and `wet`. Every
    colour is continuous in the elevation. A hundredth of a degree either
    side of every node and of the 2° gate, no sky colour moves more than
    1/255 in sRGB, the space the doc writes it in, before the hex rounds
    it (measured worst 0.46/255). The sun's colour, which fades to black,
    moves no more than 1/255 in linear RGB, the space it lights in
    (measured worst 0.82/255, at 0°; Decision 22).
  - **fog**: the colour is the sky's horizon (true of all four anchors), far
    is `0.9 ·` the visibility in force (Koschmieder style), and near is the
    look's near ratio times far, both in whole metres.
  - **shadows**: only while effective cover < 0.75, `h` < 0.5 and the
    sun's geometric elevation is above 2°.
  - **clouds**: `{ cover, contrast, scale, base }` (`deckOf`), base from
    the trait and contrast and scale from a per-kind table (cumulus 0.25
    and 700, stratocumulus 0.12 and 500, from the anchors; stratus 0.05 and
    1500, a flat grey barely textured, and cirrus 0.08 and 3000, faint and
    wide, are new). The stage has two decks, not one: a cover under 1 is
    drawn as scattered clouds (the noise's top `cover` whitened, up to 0.6,
    and brightened overhead) and a cover of 1 as a layer (the whole sky
    textured ±contrast, nothing whitened). Handing it the trait's cover
    straight would jump between them at cover 1. So each kind is drawn by
    one deck at every cover (Decision 27):
    - *scattered* (cumulus, cirrus): cover `min(cover, 0.95)`, which never
      reaches the layer (at 0.95 it already whitens all but under half a
      percent of the sky, so 0.95 to 1 is one look), and the kind's
      contrast;
    - *layer* (stratocumulus, stratus): the stage's cover 1, contrast the
      kind's `× cover`.

    The haze fades either deck toward none, `× (1 - h)`: a layer's
    contrast, and a scattered deck's cover and contrast (its whitening
    follows its cover alone). There is no deck at cover 0 or at `h` = 1: a
    clear sky has none, and fog hides it. As the stage draws it (a test
    copy of its `cloudAt` and its noise, over 864 directions), no direction
    moves more than 0.04 for a 0.01 step of cover or haze, for every kind.

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

Both ways are in Edit, in view, with no menu diving.

- **Dial it in**: on the scene inspector, which stays on the scene when
  nothing is selected, the Weather behaviour shows every field. Every number
  is a bounded slider; visibility and cloud base use log sliders.
- **Commands** (null target, `edit: true`, `show: ["toolbar", "menu"]`): on
  the toolbar, which is Edit's and always in view there, and in the scene's
  right-click menu. Not on the inspector: the scene inspector shows no scene
  commands (Decision 28).
  - **Place** is a picker of Cadboro Bay (48.454, -123.2915, America/
    Vancouver) and Ucluelet (48.95, -125.558, America/Vancouver), terrain's
    origin there (`PLACES`). It shows the place the weather is at, by
    lat, lon and zone exactly (`placeOf`; the name is a label). When the
    weather is at neither, it shows a third entry, "here", labelled with
    the coordinates in force (`48.4540° N, 123.2915° W`), and picking it
    writes nothing. Picking a place writes those of place, lat, lon and
    zone the trait doesn't already hold, in one change. Its tooltip is the
    provenance: "Weather: dialled by hand", "Weather: as fetched from
    Open-Meteo (forecast) for …" or "Weather: dialled since it was fetched
    from …".
  - **Now** sets date and hour to the present minute in the weather's zone
    (the minute floored, so the hour is a whole number of minutes and never
    24), those that differ, in one change (Decision 30).
  - **Fetch now** and **Fetch for this time** (W4) fetch from Open-Meteo in
    the pressing viewer's browser, then write the fields plus `source` in
    one change.

The commands' writes are a package's (`api.change`), so they are not on the
undo stack; only the stage's own parts have `api.edit` (STAGE.md; Question
6). A slider's write through the inspector is the stage's, and is.

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
  W4's `gustinessOf(mean, peak)` in `open-meteo.js` is this rule, rounded
  to the slider's step (Decision 24).
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
| W1 | `time.js` (`instantOf`, `localOf`, `offsetAt`, `validDate`, `validZone`) and `solar.js` (`sunAt`, `sunDirection`, `refraction`), against Meeus's, NREL's and USNO's published values, and the default's sun end to end; every quarter hour of three Vancouver days round-tripped, and of the days around every transition of a year in eight zones, where `instantOf` never goes backwards (Decision 13). `validDate` and `validZone` are the predicates W2's params use to fall back to the default (Decision 16) | done |
| W2 | `weather.js`: `weatherParams` (every field in force: a missing or malformed field is its default, an invalid zone or date too, a number clamped into its range), `windOf` (a pass-through); `atmosphere.js`: `atmosphereOf` (pure) as specified under "The look", the four anchors exact fixed points, every output over a grid of 6720 weathers passing the stage's own check unchanged; presence, the bands and the gates on the geometric elevation. Review fixes: rows between the anchors computed independently (cover and haze quarters and midpoints, cirrus as thin cumulus, the sun untinted at s = 1), the bands table parsed as the spec, sky continuity in sRGB, the deck drawn without a jump (Decision 27), `gustinessOf` moved to W4 (Decision 24) | done |
| W3 | `extension.js`: `ambient()` offers `{ wind, atmosphere }` of the trait, the same object while the params in force are unchanged, null without the trait; Place and Now on the toolbar and the menu, Edit's only (Decision 28); `provenance` and the exact `sumOf` (Decision 29); `placeOf`; Now to the minute (Decision 30). Local probe `probes/weather-run.mjs` in the built scene tool: 43 checks pass in Chrome 157 (the ambients exactly the page's own `atmosphereOf`/`windOf`, the sun and the key light to 1e-9 at 9, 15, 21, Ucluelet and Now; the toolbar's picker and button; the inspector's 15 fields), and it found the zone-data disagreement (Decision 15, Question 12) | done |
| W4 | `open-meteo.js`, Fetch commands, recorded fixtures; `gustinessOf` with its rows from 07a3a291 (Decision 24), including gust factor {1.3, 2, 2.5, calm} → gustiness {0.3, 1, 1, 0.3}; rows for clamping (wind 45, rain 80) | |
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
   the sky's top gets bluer from cover 0 to 0.35 before it greys; whether
   that stays is the lead's taste, Question 9, and this decision only
   keeps the anchors as they were meanwhile. *Decided unattended
   (2026-11-16, lane/weather), for the lead.*
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
13. **A local time that names no instant, or two: the overlap takes the
    earlier instant, and the gap pauses at the transition.** In a fall-back
    overlap (01:30 on 2026-11-01 in Vancouver happens twice) it is the
    earlier instant, 01:30 PDT. In a spring-forward gap (02:00–03:00 on
    2026-03-08 never happens) every hour is the transition instant itself,
    10:00Z, so the sun waits while the slider crosses hours no clock shows.
    This departs from the plan's wording ("the later offset", which would
    put 02:30 at 01:30 PST) and from Temporal's and Date's "compatible"
    rule (02:30 → 03:30 PDT), which W1 first shipped: under it the slider's
    02:45 is 10:45Z and 03:00 is 10:00Z, so the sun stepped backwards. A gap
    hour is only reachable by dragging the slider (`localOf` never writes
    one, so Now and Fetch can't), and for a slider the invariant matters
    more than matching a clock: `instantOf` is non-decreasing in the hour
    for every date and zone. time.test.js proves it over every quarter hour
    of the days around every transition of a year in eight zones (both
    hemispheres, a 30-minute DST, midnight transitions, no DST, +12:45,
    and Apia's skipped day in 2011), where each hour either round-trips
    through `localOf` or lies in a gap and maps to its transition. The cost
    is a bisection on `offsetAt` to the whole second, about 25 formatter
    calls, only in a gap. *Decided unattended (2026-11-16, lane/weather),
    for the lead.*
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
    for a date dialled across a DST change. For the same reason the zone
    must be an IANA name (ASCII parts, each starting with a letter:
    `America/Vancouver`, `UTC`, `Etc/GMT+8`, `EST5EDT`, and the aliases and
    lowercase spellings ICU accepts), never a UTC-offset string: ES2024's
    offset zones (`+05:30`, `-08:00`) are accepted by newer runtimes and
    throw on older ones, so peers would disagree on whether to fall back.
    `validZone` rejects them on every runtime. *Decided unattended
    (2026-11-16, lane/weather), for the lead.*

    **Measured in W3: the cost is real now, for the presets' own zone.**
    The local probe (`probes/weather-run.mjs`) asked both engines for
    America/Vancouver's offset. Chrome 157's zone data keeps it at UTC−7
    through the winter from 2026-11-01 (British Columbia's permanent
    daylight time); node 24.8 (ICU 77.1, tz 2025b) still falls back to
    UTC−8. So for any Cadboro Bay or Ucluelet date from 2026-11-01 on, a
    peer on older zone data puts the sun an hour away from one on newer
    data (the probe's Now row: 0.22 apart as unit vectors), and Now
    written by one reads an hour off on the other. Summer dates agree, so
    the examples' 15 July doesn't show it. The tests run in node, so
    time.test.js's Vancouver fall-back rows (2026-11-01) are node's
    data's truth, not Chrome 157's. Question 12 proposes the fix.
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
    (a gap hour reads as the gap's end, 03:00, since its instant is the
    transition; Decision 13). It returns the hour to the second, unrounded;
    W3 and W4 decide whether Now and Fetch round it to the slider's
    quarter hour. *Decided unattended (2026-11-16, lane/weather), for the
    lead.*
18. **`sunAt` names its two elevations for what they are, and reports
    nothing unused.** It returns `{ azimuth, apparent, geometric,
    declination }`. There is no field called `elevation`, because the
    obvious name would be the wrong one for most uses: presence, the bands
    and every gate read `geometric`, and only the direction reads
    `apparent`. The plan's `eqTime` (and Meeus 28.a's row) is dropped:
    nothing reads it, and the Meeus 25.a and NREL rows already pin the
    coordinates it would cross-check. A test pins the field set. *Decided
    unattended (2026-11-16, lane/weather), for the lead.*

19. **After sunset the atmosphere keeps a dark sun.** The plan said the
    sun is present only while it is up. Taken literally (no `sun` key
    below -0.833°), the stage's own rig would stand in: its white key light
    at 1.5 from a fixed direction high to one side, and its headlight back
    at full strength. That is an editor's lamp lighting the night sea, and
    it pops on at the instant of sunset. So the `sun` entry is always
    there, pointing where the sun really is (below the horizon at night).
    Its colour and intensity fade to `#000000` and 0 as it sets, so it
    gives no light and draws no disc. "Present" is therefore tested as
    "gives light", which holds iff the geometric elevation is above
    -0.833°. The disc fades with it and its colour rounds to `#000000` a
    thousandth of a degree early (at -0.8329° the light is still 2e-4 of
    the day's, too little to see); a test row pins both. The night is lit only by the sky's hemisphere light
    (the dark sky colours), a third of the headlight and the environment,
    all scaled by the night's exposure. *Decided unattended (2026-11-16, lane/weather), for the lead.*
20. **The twilight is a finite table of bands, with every node but the day
    new art direction.** Each sky colour has a gain and a tint (linear RGB
    multipliers). The sun has a tint, a `disc` and a `light` factor, and
    exposure has its own factor, at 20°, 6°, 0°, -0.833°, -6° and -12°
    geometric, linear between. Tints are greyed toward white by
    `s = max(effective cover, h)`, so an overcast or fogbound sunset dims
    but takes no orange. A test checks every channel scales alike at
    s = 1. The disc fades from 0.7 at 6° to 0.2 at 0° to 0 at set: the
    sinking sun dims through thicker air, and that slope is what keeps its
    colour continuous (Decision 22). Limits: the stage's sky has one
    horizon colour, so a sunset glow warms the whole horizon, not just the
    sun's side, and the sky has no stars and no moon. The values were set by
    reasoning, not seen; W7's screenshots (dawn, noon, dusk, night) are the
    first look, and the lead's eye should judge them. *Decided unattended (2026-11-16, lane/weather), for the lead.*
21. **Rain is extinction plus darkening, calibrated rather than cited.**
    Rain's extinction coefficient, `0.25 · R^0.73` per km, is the usual
    power-law form. Its constants were set so that rain alone gives about
    8 km of visibility at 2.5 mm/h (moderate rain) and about 1.5 km at
    25 mm/h (heavy rain), the visibilities usually described for those
    rates. It adds to the air's own extinction, `3.912 / visibility`, as
    extinctions do. The sky and the sun's light are darkened by
    `wet = 1 - 0.3 · R / (R + 4)`: 0.85 at 4 mm/h, tending to 0.7. Both are
    exactly the identity at 0 mm/h, so a dry world is untouched. There are
    no particles and no wet decks. *Decided unattended (2026-11-16, lane/weather), for the lead.*
22. **Continuity is measured before the hex rounds it: the sky in sRGB,
    the sun in linear RGB.** The plan asked for no more than 1/255 of
    change a hundredth of a degree either side of each band's edge. The
    hex rounding adds up to a level of its own, so the check is on the
    unrounded colour (`skyAt`, through `toSrgb`). The sky's three colours
    hold it in sRGB, the space the doc writes them in, as the plan asked:
    measured worst 0.46/255 (W2's first cut measured them in linear RGB,
    which is the weaker check for them). The sun's colour cannot: its disc
    fades from 0.2 to 0 over the 0.833° before set, into sRGB's steep toe
    (12.92 per unit of linear below 0.0031), and moves 7.9/255 in sRGB
    across -0.833 ± 0.01°. It is held to 1/255 in linear RGB, the space it
    lights in (worst 0.82/255, at 0°). Both hold over every kind, cover
    {0, 0.5, 1}, visibility {20, 3, 1} km and rain {0, 10} mm/h, at every
    node and at the 2° gate. The colour transfer itself is checked
    separately: every byte in every channel round-trips exactly. *Decided
    unattended (2026-11-16, lane/weather), for the lead.*
23. **`weatherParams` is strict, and its spec is the describes.** The
    fields, defaults and ranges are read from `index.js`'s describes, the
    one source that WEATHER.md's table is checked against. A number must be
    a JSON number: a numeric string such as `"7"` is malformed and gives the
    default, because the inspector writes numbers and a lenient parse would
    make `"7"` and `7` two spellings of one state. Numbers are clamped into
    their range. An integer must be a safe integer. A zone must pass
    `validZone` and a date `validDate`, and an enum must be one of its
    options. `source` is dropped, because no ambient reads it. Any trait,
    including none, gives a whole set of params, and the ambients never
    throw. *Decided unattended (2026-11-16, lane/weather), for the lead.*
24. **The fetch's gust rule waits for the fetch.** W2's first cut put
    `gustinessOf(mean, peak)` (Decision 10's rule, rounded to the slider's
    0.05) in `weather.js`, with nothing to call it until W4. Review called
    it an appendage, and it is: it moved out again, and W4 writes it in
    `open-meteo.js` beside its one caller. Its code and table rows are in
    commit 07a3a291 (`weather.js`, `weather.test.js`): the plan's rows; a
    calm (mean under 0.5 m/s) or no peak giving the default 0.3, not 0, as
    Decision 10 says (a gust factor over a calm means nothing); and the
    rounding, so a fetched value is one the slider can show. *Decided
    unattended (2026-11-16, lane/weather), for the lead.*
25. **What "every peer agrees" means, exactly.** `atmosphereOf` uses
    `Math.sin`, `Math.pow` and friends, which ECMAScript does not require
    to be bit-identical across engines. V8, JavaScriptCore and SpiderMonkey
    may therefore differ in the last bit of the sun's direction or an
    intensity, and a hex colour sitting exactly on a rounding boundary
    could round differently. The atmosphere is only drawn, so that is
    invisible. The `wind`, which the deterministic sim reads, is the doc's
    own numbers passed through, with no arithmetic, and is bit-identical
    everywhere. *Decided unattended (2026-11-16, lane/weather), for the lead.*
26. **The two new cloud kinds.** Cirrus has opacity 0.3, so at full cover
    the sky's look is cumulus's at cover 0.3 (a test row), nearer the
    bright day than Ukee grey, and its deck is scattered, faint and wide
    (contrast 0.08, cells 3000 m). Stratus has opacity 1 and is a barely
    textured layer (0.05, 1500 m): under it at cover 1, the sky is Ukee
    grey's and only the deck differs. *Decided unattended (2026-11-16,
    lane/weather), for the lead.*
27. **Each kind is drawn by one of the stage's two decks at every cover,
    so the deck as drawn has no jump.** The stage's `cloudAt` (and water's
    copy) draws a cover under 1 as scattered clouds and a cover of exactly
    1 as a layer. W2's first cut handed it the trait's cover, so at 0.99
    cumulus was drawn with a mean factor of 1.21 and whitening of 0.54,
    and at 1 with 0.98 and 0: Ukee grey 25% brighter and washed out just
    short of full cover, and cirrus 60% washed out at 0.99 but fully blue
    at 1. The fix lives here, with no scene change. Heaps and wisps
    (cumulus, cirrus) are always scattered, at `min(cover, 0.95)`. Sheets
    (stratocumulus, stratus) are always the layer, with contrast
    `× cover`. The haze fades a layer's contrast, and a scattered deck's
    cover and contrast. Every lever is one the stage's deck is continuous
    in, and no kind crosses between decks, so the drawn sky is continuous
    in cover and haze. Tests check this on a copy of the stage's
    `cloudAt` and the sky shader's noise: every 0.01 step of cover and of
    haze, for every kind, against the stage's own steepness (no direction
    moves more than 0.04), plus the review's row (0.95, 0.99 and 1 are one
    sky). The anchors' decks are unchanged: the bright day is scattered at
    0.35, and Ukee grey is the layer at 1. Two costs:
    - stratocumulus under full cover is now drawn as a faint layer (0.12 ×
      cover), not as scattered white heaps over the blue (a broken
      stratocumulus sky reads as a texture, not as clouds);
    - cumulus at full cover is a scattered deck that whitens nearly the
      whole sky, not a layer.

    The other way to fix this is a stage `cloudAt` continuous as cover
    approaches 1. That is a scene change and the lead's call (Question
    10). *Decided unattended (2026-11-16, lane/weather), for the lead.*

28. **The weather's commands are on the toolbar and the menu, not the
    inspector.** The plan put Place and Now on the scene inspector, by the
    sliders. The scene inspector shows no scene commands: its
    `commandsFor` (scene/src/parts/inspector-model.js) answers [] for the
    null target, and with nothing selected it shows only the scene's
    Behaviours and Starts in. The Behaviours section draws describes
    fields, one write each, and no field kind is a button or writes four
    fields at once, so Place can't be a field without a scene change. The
    toolbar is the scene commands' own surface: Edit's only, always in
    view there, a picker for `choices` and a button otherwise (the cups'
    Lift all is there too). The menu is a second way for a right-click.
    The local probe found exactly this in the built tool: the toolbar shows
    the picker and the button, and the scene inspector shows the Weather
    behaviour's 15 fields and no weather commands. If the lead wants them
    beside the sliders, the scene change is one rule: the scene inspector
    shows the null target's commands that name "inspector" in `show`
    (Question 11). *Decided unattended (2026-11-16, lane/weather), for the
    lead.*
29. **The provenance sum is exact and covers the place and moment.**
    `source.sum` is the JSON of the summed fields in force, not a hash, so
    a dialled weather never collides with a fetched one (a few hundred
    bytes in the doc, once per fetch). It sums every field but `place` (a
    label) and `seed` (which gust pattern plays). Moving the hour, the
    date or the coordinates after a fetch makes it "dialled since fetch",
    because the snapshot was the conditions of that place at that hour;
    the sun still follows the slider. The sum is compared over the params
    in force, so a field left out and the same field written as its
    default are one weather. A source read as anything but the trait's
    own map with a string `sum` is "dialled". *Decided unattended
    (2026-11-16, lane/weather), for the lead.*
30. **Now writes the present minute, floored, and Place offers "here"
    only when it is true.** Decision 17 left the rounding to W3. The slider
    steps in quarter hours, but a quarter hour is 3.75° of sun, so Now
    writes the minute (0.25°): floored, so the hour never reaches 24 and
    stays on the date it reads. It is exact: over every minute of five
    days (a summer day, the spring-forward and fall-back days in
    Vancouver, Kolkata, Chatham) the hour Now writes reads back through
    `instantOf` as that minute (in node's zone data), but for the 60
    minutes of the fall-back's second pass, which read an hour early, as Decision 13's overlap rule
    says (the trait has a clock time and a zone, not an offset, so the
    second 01:30 can't be named). Place's "here" entry, the plan's third
    choice, is the coordinates in force: it appears only when the weather
    is at neither preset, as the picker's honest value, and picking it is
    a no-op. Nothing asks the browser for the viewer's own location: that
    would put a person's whereabouts into a shared doc. *Decided
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
  formatter cached per zone (a few microseconds each), plus about 25 more
  for an hour inside a spring-forward gap. Both run only when the trait
  changes.
- **W2**: none at run time until W3 calls it. `atmosphereOf` is one
  `instantOf` and one `sunAt`, plus about 60 multiplies and 12 `pow`
  calls for the colours: tens of microseconds. The test grid (6720
  weathers, each computed four times and checked) runs in about a second;
  the drawn-deck sweeps (a copy of the stage's `cloudAt` over 864
  directions, every 0.01 of cover and haze for every kind) add under a second.
- **W3**: `ambient()` runs on every flush. Each time it fills the params
  (`weatherParams`: fifteen field checks, one `validZone` and one
  `validDate`) and stringifies them, a few microseconds; only a change in
  the params in force recomputes the atmosphere, and otherwise it returns
  the same object, so the stage's merge does nothing. The commands' state
  is the same params, asked once per toolbar render. The tests: about
  110 rows, of which the five-day minute table (9360 `localOf` and
  `instantOf` round trips) takes about 0.4 s.
  Dragging the hour slider writes a change per input event, as every
  slider does, and each one is one `atmosphereOf` (tens of microseconds)
  and one viewport relight.
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
3. The UI is the scene inspector's Weather behaviour (the sliders) and the
   toolbar's Place picker and Now button, in Edit. Do you want a dedicated
   weather pane (a compass dial, a day scrubber with the sun's path), or a
   weather chip on N8's world bar that shows outside Edit?
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
7. Night has no moon and no stars. After sunset the sun stays in the
   atmosphere as a dark light pointing where it is (Decision 19), so the
   night is lit only by the dim sky. Rain shows only as lower visibility
   and a darker sky, with no particles. Is that OK for now?
8. The twilight and night colours (Decision 20's bands) are new art
   direction, set by reasoning. Do you want to tune them from W7's
   screenshots, or hand them to someone with an eye for skies?
9. The cloudless sky is Ucluelet's pale clear afternoon (top `#5b86b0`),
   and the bright day at 35% cumulus is bluer (`#2f6db5`). So every
   fetched clear day at Cadboro renders pale, and adding a little cloud
   makes the sky bluer: inherited art, physically backwards. Keep it, or
   redraw the cover-0 node with the bright day's blues? Ucluelet's clear
   afternoon would then reproduce only if something the trait carries
   (a summer haze, say) accounts for its paleness. Default for now: keep
   the anchors as they were (Decision 9).
10. The stage's cloud deck jumps from scattered to layer at cover exactly
    1. Weather avoids the jump by always drawing a kind with one deck
    (Decision 27), so broken stratocumulus is a faint texture rather than
    heaps. Would you rather the stage's `cloudAt` crossfade the two decks
    as cover nears 1? That is a scene change, and it would let every kind
    run from heaps to a sheet.
11. The scene inspector shows no scene commands, so Place and Now (and W4's
    Fetch) are on the toolbar and the menu, not beside the weather's
    sliders (Decision 28). Should the scene inspector show the scene's
    commands that name "inspector" in `show`? That is a one-rule scene
    change, and the weather's commands would then sit in its Weather
    section.
12. **Peers' zone data disagree for Vancouver from 2026-11-01** (measured
    in W3; Decision 15): Chrome 157 has British Columbia on permanent
    UTC−7, node 24.8 still falls back to UTC−8, so the same doc's sun is
    an hour apart on the two for every winter date at both presets. The
    fix that makes it correct by construction is a data-shape change: the
    trait carries the UTC offset in force (`offset`, minutes), written
    with date and hour by Now, Place and Fetch from the writer's zone data
    and then frozen in the doc, so `instantOf` becomes arithmetic (the
    date's midnight UTC + hour − offset) and no peer's zone data enters
    the ambient. `zone` stays, for Now and Fetch to know which offset to
    write. It also removes Decision 13's gap and overlap rules (the slider
    can't fall into a gap). Its cost: dialling the date across a DST
    change keeps the old offset until someone presses Now. Make that
    change (before W8 republishes), or keep the zone's rules as the
    runtime's and live with the disagreement until browsers and node
    agree?
