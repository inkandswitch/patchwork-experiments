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
in, with W3's review fixes (the clock is a UTC offset, Decision 15; no
place field, Decision 32; the commands the world's only, Decision 31). W4
(Fetch for this time: `open-meteo.js`) is in, with its review fixes (the
visibility field is the visibility in force, Decision 41; no Fetch now,
since Now then Fetch is it, Decision 42). W5 is in: sailing offers no
ambient, and every boat sails in this package's `wind` (Decisions 43–47).
W6 is in: terrain's place offers no sky (`terrain.sky` is `terrain.place`),
and Cadboro Bay's and Ucluelet's templates write this trait, each place
showing exactly the look it had (Decisions 48–52). A doc with the trait has
its weather's wind, sun and sky, dialled or fetched. The plan's
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
| `lat` | number | 48.454 | -90 | 90 | 0.0001 | | degrees north (WGS84) |
| `lon` | number | -123.2915 | -180 | 180 | 0.0001 | | degrees east (WGS84) |
| `date` | string | `"2026-07-15"` | | | | | calendar date on the clock, `YYYY-MM-DD` |
| `hour` | number | 15 | 0 | 24 | 0.25 | | clock hour: the sun slider |
| `offset` | number | -7 | -12 | 14 | 0.25 | | the clock's hours from UTC (-7 is PDT, and British Columbia's all year from November 2026) |
| `wind` | number | 4 | 0 | 40 | 0.1 | | mean wind speed at 10 m, m/s |
| `from` | number | 235 | 0 | 360 | 1 | | where the wind blows from, degrees true |
| `gustiness` | number | 0.3 | 0 | 1 | 0.05 | | the hour's peak gust over the mean, less 1: 0.3 is gusts to 130% and lulls to 70% (sailing's model) |
| `seed` | integer | 1 | | | | | the gusts' seed |
| `cover` | number | 0.35 | 0 | 1 | 0.05 | | cloud cover, 0 clear to 1 overcast |
| `clouds` | enum | `"cumulus"` | | | | | `cumulus`, `stratocumulus`, `stratus` or `cirrus` |
| `base` | number | 1200 | 50 | 12000 | 50 | log | cloud base, m |
| `visibility` | number | 10000 | 100 | 50000 | 100 | log | horizontal visibility, m, rain and all (as observed) |
| `rain` | number | 0 | 0 | 50 | 0.1 | | precipitation, mm/h |

Every field has a default, so every slider shows the value in force and can
be dialled back to it. One more key, `source`, is written only by a fetch
(`{ name, api, for, fetched, fields }`) and is not described.

`source` says where a snapshot came from: the provider (`"Open-Meteo"`), which
API (`forecast` or `archive`), the hour the data is for and when it was fetched
(ISO), and `fields`, the summed fields in force as the fetch wrote them, a map
by name (`fetchedFields(params)`). Nothing describes it, so the inspector
neither shows nor touches it. The pure `dialledSince(trait)` compares
`fields` with the fields in force key by key and names the ones that differ
(a field `fields` doesn't name counts as dialled), and `provenance(trait)`
answers "fetched", "dialled since fetch" or "dialled" from it. Nothing has to
intercept an edit to know.

The record is exact values, not a hash, so no dialled weather can pass for a
fetched one; it is a map, so no field order is implied and the doc can be
read. The summed fields (`SUMMED`) are every field but `seed`, which picks
the gust pattern and is not weather: a snapshot speaks for its conditions and
for the place and moment they are of, so moving the hour, the clock or the
coordinates after a fetch makes it "dialled since fetch" too (Decision 29).

**The clock.** `date` and `hour` are read on a clock `offset` hours from UTC,
and the instant is `date`'s midnight UTC + `hour` − `offset`: arithmetic, with
no time-zone data, so every peer computes the same instant from the doc
whatever its runtime's zone rules say (Decision 15). There is no place name in
the doc: the coordinates are the place, and the Place picker names them when
they are a preset's (Decision 32).

## What it offers

`ambient()` is a pure function of the trait, cached by its filled-in params
(the pattern of sailing's old weather.js), and null without the trait. It offers the two
existing conventions and adds no new ambient:

- **`wind`** = `{ speed: wind, from, seed, gustiness }`: the trait's own
  fields, passed through. This is the convention's documentation (it moved
  here from sailing/DESIGN.md in W5; scene STAGE.md, "Conventions", points
  here). How the world's air moves, one copy: nothing else carries it.
  - `speed`: m/s at 10 m.
  - `from`: the compass bearing it blows *from*, in degrees, measured from
    −Z (north) toward +X (east), as sailors say it: 0 from −Z (it blows
    toward +Z), 90 from +X.
  - Both are in the outermost doc's root frame, on its world time. A reader
    in a linked stage maps them by its frame (sailing's `sea-view.js`
    `windFor`).
  - `seed` (an integer) and `gustiness` (0..1) make its gusts: sailing's
    `wind.js` turns the four into a wind field, speed ±g and direction
    ±33°·g in smooth deterministic noise carried downwind. Nothing converts
    `gustiness`; it is sailing's own quantity.
  - Three readers: sailing's physics, which makes it a wind in each stage's
    frame (`sea-view.js`); sailing's seas, whose waves are its spectrum
    (`sea.js`); and the water package's surface, whose fine waves,
    roughness and foam follow it.
- **`atmosphere`** = `atmosphereOf(trait)` (STAGE.md's shape):
  - **sun**: the direction comes from `solar.js`'s `sunAt` at
    `instantOf({ date, hour, offset })` (`time.js`) and `lat`/`lon`: Meeus's
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

    Rain does one thing, and at 0 mm/h nothing: it darkens the sky's
    colours and the sun's intensity by `wet = 1 - 0.3 · R / (R + 4)`
    (Decision 21). It leaves the visibility, and so the haze, as they are:
    the `visibility` field is the visibility in force, with the rain in it,
    as an observation is (Decision 41). Dialling rain up doesn't draw the
    fog in; dialling visibility down does.

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

- **sailing** (done, W5) lost `weather.js`, its `sailing.weather` extension
  and trait, and its constant bright-day atmosphere. It offers no ambient
  and reads only `wind`. Its Sea and Sloop parts list the trait key
  `weather` among what they bring, and they and its templates write the air
  of it, `{ wind, from, seed }`, where a scene has none (parts.js
  `newWeather`; Decision 43): data, a late-bound runtime lookup, never a
  build-time dependency. Its tests stand in for this package's offer with a
  pass-through of those numbers (Decision 44). Its probes load this
  package's build and check that the boat's wind is the weather's
  (Decision 47). Without this package loaded a sailing scene is becalmed,
  and nothing says why (Decision 45, Question 15).
- **terrain** (done, W6): its place trait offers no atmosphere. It keeps the
  shore in the water, the water's shelter and the ground's grain, and is
  renamed `terrain.place` (`place.js`, no fields), because a trait called
  sky that gives no sky is a rough edge. The colours of its `SKIES` are this
  package's anchors; what stays in terrain is what each sky *is*, as this
  trait's sky fields (Ucluelet's `SKIES`: Ukee grey, the marine layer, the
  clear afternoon; Cadboro's `SKY`: the fair afternoon). The Cadboro Bay and
  Ucluelet templates write a whole `weather`: the place's coordinates (the
  Place picker's own), 15:00 on 15 July on UTC−7, the place's wind
  climatology and its sky (terrain template.js `placeWeather`; Decisions
  48–52). Under it each place shows exactly the look it had; only the sun
  moves, to where it is (at Ucluelet within 0.41° of the direction once
  hand-set for that moment).

## Setting it

Both ways are in Edit, in view, with no menu diving.

- **Dial it in**: on the scene inspector, which stays on the scene when
  nothing is selected, the Weather behaviour shows every field. Every number
  is a bounded slider; visibility and cloud base use log sliders.
- **Commands** (null target, `edit: true`, `show: ["toolbar", "menu"]`): on
  the toolbar, which is Edit's and always in view there, and in the scene's
  right-click menu. Not on the inspector: the scene inspector shows no scene
  commands (Decision 28). They are the world's weather's only: in a linked
  world, whose weather the outermost rule leaves out of force, they don't
  apply, so entering a linked boat shows one of each, the world's
  (`isWorlds`: `api.ambient("wind").mine`; Decision 31). There are three:
  - **Place** is a picker of Cadboro Bay (48.454, -123.2915) and Ucluelet
    (48.95, -125.558), terrain's origin there, both on British Columbia's
    clock, UTC−7 (`PLACES`). It shows the place the weather is at, by lat
    and lon exactly (`placeOf`; the clock is when, not where). When the
    weather is at neither, it shows a third entry, "here", labelled with
    the coordinates in force (`48.4540° N, 123.2915° W`): a read-out, and
    picking it writes nothing. Picking a place writes those of its lat, lon
    and clock the trait doesn't already hold, in one change; the date and
    hour stay, so it is the same time of day there.
  - **Now** sets date and hour to the present quarter hour on the
    weather's clock (floored to the hour slider's step, so it writes only
    what the slider can show, and the hour never reaches 24), those that
    differ, in one change (Decision 30). Its tooltip says that Fetch for
    this time then fetches the present conditions.
  - **Fetch for this time** fetches the conditions for the place, date and
    hour in force; after Now, the present conditions, since Now's time is
    within 15 minutes of now, inside the present conditions' 30 (Decision
    42). Its button says the provenance, so it shows without
    hovering: "Fetch for this time" (dialled), "Fetched for this time" (as
    fetched; pressing it fetches again), or "Fetch again (hour, cover)"
    once fields are dialled since, naming up to two and counting more
    ("Fetch again (3 dialled)"). Its tooltip says it in full: "Weather:
    dialled by hand", "Weather: as fetched from Open-Meteo (archive) for
    2025-07-15 15:00 UTC−7" or "Weather: dialled since it was fetched from
    … (hour, cover)", then what pressing it fetches. For a time Open-Meteo
    has no weather for (more than 15 days ahead, or before 1940) it is
    disabled, and its tooltip says why (Decision 37).

  A fetch runs in the pressing viewer's page, writes when the reply comes,
  and a notice says what was fetched ("Weather fetched from Open-Meteo
  (forecast) for 2026-11-16 14:45 UTC−7"). A failure is a notice ("Couldn't
  fetch the weather: …") and writes nothing (Decision 38).

The commands' writes are a package's (`api.change`), so they are not on the
undo stack; only the stage's own parts have `api.edit` (STAGE.md; Question
6). A slider's write through the inspector is the stage's, and is.

## Fetch

`open-meteo.js` is pure except for `fetchWeather`'s one `fetch` call.

- **Routing**: `requestFor(params, now)` routes the instant the weather's
  date, hour and clock name (`routeOf`):
  - within 30 minutes of now (inclusive): the forecast API's `current`, the
    present conditions (15-minutely), which stand for any instant that
    near;
  - else the hour nearest the instant (half past rounds up), by its UTC day
    from today: from 90 days back to 15 ahead, the forecast API's hours;
    further back, to 1 January 1940, the archive's (ERA5);
  - otherwise `null`: nobody has weather for it, and Fetch for this time
    is disabled with the reason.

  Both hourly routes ask for that one UTC day (`start_date` = `end_date`),
  and the snapshot takes exactly the hour routed to, not "the nearest one
  sent". On the present route the conditions are the present ones, which
  must be stamped within 30 minutes of the press (`request.now`, the point
  routing measures from too), and `source.for` is their own time
  (Decision 34).
- **What leaves the machine**: the URL, and nothing else. Its query keys
  are a fixed whitelist per route (`QUERY`): `latitude`, `longitude`,
  `current` or `hourly` (the variable names), `start_date` and `end_date`
  (hourly only), `wind_speed_unit=ms` and `timezone=GMT`. No other field
  of the weather reaches the URL (a test varies every one). The fetch
  sends no credentials and no referrer (`credentials: "omit"`,
  `referrerPolicy: "no-referrer"`), so nothing names the viewer or the doc
  (Decision 39).
- **Model**: Open-Meteo's `best_match`. The archive and `gem_seamless` send
  `visibility: null` (the archive's unit is even `"undefined"`; recorded in
  the fixtures), so visibility is derived when absent.
- **The snapshot** (`snapshotFrom(json, request)`): every summed field, on
  its slider (clamped into its range and rounded to its step, `onStep`),
  plus `source`. The place and clock are the request's, so the snapshot is
  of exactly the place and moment asked; the conditions are the reply's:
  the present ones, or the hour routed to (Decision 35):
  - `wind`, `from`: as sent. Both are required: a reply without them is no
    weather, and fails.
  - `gustiness`: `gustinessOf(mean, peak)`, the hour's peak gust
    (`wind_gusts_10m`) over the mean, less 1, on the slider (Decision 10);
    in a calm (under 0.5 m/s) or with no peak, the default 0.3 (Decision 24).
  - `cover`: the total cloud cover, else the dominant layer's, else 0.
  - `base`: under a low layer (or none), the lifting condensation level,
    `125 m · (T − Td)`, clamped to 100..3000 m; over a dominant mid or high
    layer, its étage's typical base, 3000 or 7000 m (`BASES`); without a
    temperature or dew point, 1000 m.
  - `clouds` (`kindOf`): what falls says it first (fog, drizzle, steady
    rain and snow fall from a flat layer: stratus; showers of rain or snow,
    WMO 80–82 and 85–86, and thunder from heaps: cumulus), else the dominant layer: high is cirrus; a sheet
    (cover 0.6 or more) is stratus when low and under 300 m, else
    stratocumulus; heaps are cumulus. No cloud at all is cumulus, which
    doesn't show at cover 0. The kind is judged on the base as written, so
    the doc is consistent with itself.
  - `visibility`: as observed, rain and all: the field is the visibility
    in force, so the slider shows what was reported (Decision 41). With no
    visibility sent, it is derived (`derivedVisibility`), and is the
    visibility in force too: the air's (fog 500 m; else humid air's haze,
    20 km at 80% relative humidity and under, falling log-linearly to 4 km
    at 100%, capped at 2 km in snow and snow showers and 5 km in drizzle),
    seen through the rain that fell: rain's extinction, `0.25 · R^0.73` per
    km, added to the air's (`3.912 / visibility`, Koschmieder). Moderate
    rain alone (2.5 mm/h) sees about 8 km, heavy rain (25 mm/h) about
    1.5 km.
  - `rain`: the precipitation as a rate, mm/h: the reply's amount over its
    interval (the present conditions are a 15-minute sum).
  - `source`: `{ name: "Open-Meteo", api: "forecast" | "archive", for: the
    data's instant (ISO), fetched: the press's instant (ISO), fields }`,
    `fields` exactly the fields written, so the weather reads "fetched".

  It fails, with a reason people can read, on an error reply
  (`{ error: true, reason }`, its reason said when it is a string), a
  reply not in GMT, any variable with a number this hour in another unit
  than asked (one loop over `UNITS`, so every variable is checked), a reply without the hour asked for,
  or present conditions more than 30 minutes from now.
- **Writing it** (`fetchWrites`): those of the snapshot's fields that
  differ from the trait's, and `source`, whole, in one change; `seed`, not
  weather, stays the trait's.
- **Never automatic**: nothing in `ambient()`, any command's `state`, an
  update or the loop fetches; only Fetch for this time's `run` does
  (Decision 33). The stage's signal is the fetch's: stopping the stage
  aborts it, and nothing is written or said, whatever reason it aborts
  with. A notice says a fetch only when it wrote. The weather is a snapshot in the doc until someone presses Fetch
  again.
- **The recorded replies** (`src/fixtures/*.json`, written by
  `probes/record-fixtures.mjs` with the package's own `requestFor`): the
  present conditions at Cadboro Bay, tomorrow's forecast hours at Ucluelet,
  the archive at Ucluelet on 15 July 2025, `gem_seamless` at Cadboro Bay
  (the recorder adds `models=gem_seamless`; requests never carry it), an
  error reply (the forecast's hours 30 days ahead: a URL routing never
  makes), and a clear hour (all cloud 0, the archive at Cadboro Bay on
  1 July 2025). open-meteo.test.js turns each into its expected fields,
  worked out by hand from the hour's numbers.

## Plan

| Step | What | State |
|---|---|---|
| W0 | package scaffold, this doc, the fetch-from-Patchwork spike; review fixes (gustiness, the doc's table as spec, the entry evaluated alone, the sky model settled) | done |
| W1 | `time.js` (`instantOf`, `localOf`, `offsetAt`, `validDate`, `validZone`) and `solar.js` (`sunAt`, `sunDirection`, `refraction`), against Meeus's, NREL's and USNO's published values, and the default's sun end to end; every quarter hour of three Vancouver days round-tripped, and of the days around every transition of a year in eight zones, where `instantOf` never goes backwards (Decision 13). `validDate` and `validZone` are the predicates W2's params use to fall back to the default (Decision 16). W3's review replaced the zone with a fixed clock (Decision 15): `instantOf` is now arithmetic, and `offsetAt`, `validZone` and the gap and overlap rules are gone | done |
| W2 | `weather.js`: `weatherParams` (every field in force: a missing or malformed field is its default, an invalid zone or date too, a number clamped into its range), `windOf` (a pass-through); `atmosphere.js`: `atmosphereOf` (pure) as specified under "The look", the four anchors exact fixed points, every output over a grid of 6720 weathers passing the stage's own check unchanged; presence, the bands and the gates on the geometric elevation. Review fixes: rows between the anchors computed independently (cover and haze quarters and midpoints, cirrus as thin cumulus, the sun untinted at s = 1), the bands table parsed as the spec, sky continuity in sRGB, the deck drawn without a jump (Decision 27), `gustinessOf` moved to W4 (Decision 24) | done |
| W3 | `extension.js`: `ambient()` offers `{ wind, atmosphere }` of the trait, the same object while the params in force are unchanged, null without the trait; Place and Now on the toolbar and the menu, Edit's only (Decision 28); `provenance` (Decision 29); `placeOf`. Local probe `probes/weather-run.mjs` in the built scene tool: the ambients exactly the page's own `atmosphereOf`/`windOf`, the sun and the key light to 1e-9 at 9, 15, 21, Ucluelet and Now; the toolbar's picker and button; the inspector's fields. Its first run found the zone-data disagreement. Review fixes: the clock is an `offset`, not a zone, so `instantOf` is arithmetic and no peer's zone data enters the ambient (Decision 15; time.js loses `offsetAt`, `validZone` and Decision 13's gap and overlap rules); `place` dropped, the coordinates are the place (Decision 32); `source.fields`, a map, for the order-dependent `sum` (Decision 29); Now to the slider's quarter hour (Decision 30); the commands only in the world's stage, not a linked one's (Decision 31). The probe now also checks node's sun against the page's (a winter date among them) and a linked world entered: 61 of 61 checks pass in Chrome 157 | done |
| W4 | `open-meteo.js`: `routeOf` and `requestFor` (the routing at every boundary, the URL's keys the whitelist, no other field reaching it), `fetchWeather` (one GET, no credentials, no referrer), `snapshotFrom` (six recorded replies to their fields, the derivations' tables: LCL, layers, kinds, WMO codes, visibility, rain rate, `gustinessOf` with its rows from 07a3a291 and the plan's gust factors, clamping wind 45 and rain 80), Fetch for this time (gated by `isWorlds`; the provenance on Fetch for this time's label; disabled for a time with no weather; a failure a notice that writes nothing; Fetch does not set `offset`, Decision 35); the one `fetch` call shown to be the only one. Live: `probes/live-fetch.mjs`, both places now and on 2025-07-15 15:00 PDT, every field finite and on its slider. Local probe: Now then Fetch for this time on the real network in the built tool, and a refused Fetch for this time. Review fixes: the visibility field is the visibility in force, so a fetch writes the observed one (Decision 41); Fetch now dropped, Now then Fetch is it (Decision 42); the present conditions checked against the press, the point routing measures from, with `source.for` their own time (Decision 34); every variable's unit checked by one loop; the stage's signal shown to reach the fetch; a notice only when a fetch wrote, and no fetch or notice when the trait is gone at the press; snow showers are cumulus, as the doc's rule says. 79 of 79 probe checks pass | done |
| W5 | sailing reads the weather's wind; `sailing.weather` goes: sailing's `weather.js`, its extension and describes, and `ATMOSPHERE` deleted; `traits.js` names the weather's trait `weather` and the ambient `wind` (`WIND_AMBIENT`); parts and templates write `{ wind, from, seed }` (Decision 43); the Sea and Sloop parts bring `weather`; the `wind` convention documented here. Tables: the 48 weathers {wind 0/7/12 × from 0/90/235/300 × gust none/0.5 × seed 1/7} → the offer's fields (here, `weather.test.js`) and → `createWind` sampled exactly (sailing `sea-view.test.js`, through its stand-in, Decision 44), each field shown to reach her; no sailing extension, created on a stage, has an `ambient` (`index.test.js` for the sea's, `aboard.slow.test.js` for the ships'). Probes (`sailing-run`, `harbour-run`) with this package's build loaded: her wind is her weather's, alone, and the harbour's, linked (Decision 47). Publishers write `weather` and list this package (Decision 46) | done |
| W6 | terrain: `terrain.sky` → `terrain.place` (`place.js`: the shore, shelter and grain, no ambient, no fields); `SKIES` (Ucluelet) and `SKY` (Cadboro) are this trait's sky fields; `placeWeather` writes each template's whole weather (place, 15:00 on 15 July on UTC−7, wind, sky); the template's `sky` option picks a preset, a sky it hasn't refused before anything is written. Tables: each template's trait literal, each Ucluelet sky, no terrain extension offering an ambient on either template's scene, the place object table; here, each template weather gives its old look exactly and Ucluelet's sun is within 1° of the old hand-set one (0.41°). Probes: publish-rvyc and publish-ucluelet `--dry-run` check the world's atmosphere and wind are the weather's, exactly the old looks, and the same for a viewer without terrain | done |
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
3. **The default is a fair summer afternoon at Cadboro Bay**: 15:00 PDT
   (UTC−7) on 15 July 2026, wind 4 m/s from 235° (the Cadboro template's), cover 0.35
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
   it, and provenance comes from its `fields`. So dialling a fetched field needs
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
13. **Superseded by Decision 15 (W3 review).** W1 read a local time in an
    IANA zone, and needed rules for a time that names no instant (a
    spring-forward gap: the sun paused at the transition) or two (a
    fall-back overlap: the earlier). On a fixed clock every reading names
    exactly one instant, so neither rule exists, and `instantOf` is
    increasing in the hour by construction (time.test.js: every quarter
    hour of four dates on every quarter-hour clock from UTC−12 to UTC+14).
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
15. **The clock is a UTC offset in the doc, not a time zone.** W1 read
    `date` and `hour` in an IANA zone through the runtime's
    `Intl.DateTimeFormat`, so a doc's sun was the same only on peers whose
    time-zone data agreed. W3's probe found that they don't, for the
    presets' own zone: tz 2026f (macOS's zoneinfo, `zdump`, and Chrome
    157) has British Columbia on UTC−7 all year from 2026-11-01, while
    node 24.8 (ICU 77.1, tz 2025b, the stale side) still falls back to
    UTC−8. So every winter date at Cadboro Bay or Ucluelet put the sun an
    hour apart on the two, and W1's and W3's 2026-11-01 test rows asserted
    a fall-back that current data no longer has. The trait now carries
    `offset` (hours from UTC, −12..14 in quarter hours) in place of
    `zone`, and `instantOf` is the date's midnight UTC + hour − offset:
    arithmetic, so no peer's zone data enters the ambient, and the
    invariant "every peer computes the same world from the doc" holds by
    construction. Tests: `instantOf`, `localOf` and `offerOf` give the
    same answers with `Intl` removed, and the probe checks node's sun
    against the page's to 1e-9, a winter date among them. Nothing reads
    time-zone data anywhere in the package now: the presets carry their
    clock (−7) as data, and Now reads the trait's own offset. The cost: a
    clock doesn't follow daylight saving. Dialling a January date at a
    place that keeps DST shows its hour on the summer clock until someone
    dials `offset` (or, if W4 decides so, fetches); the sun is right for
    the instant either way, only the label is an hour off that day's civil
    time. That cost is Question 12. *Decided unattended (2026-11-16,
    lane/weather), for the lead.*
16. **`instantOf` throws on an invalid date, or an hour or offset that
    isn't finite; the params fall back.** W0 carried "an invalid zone or a
    malformed date falls back to
    the default" to W1. A pure time function shouldn't know the weather's
    defaults, so W1 provides the predicates, `validDate` (a real proleptic
    Gregorian `YYYY-MM-DD`, years 1–9999; `validZone` went with the zone,
    Decision 15), with a table, and W2's `weatherParams`
    uses them to fall back field by field. The ambient never throws.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
17. **`localOf(t, offset)`, the inverse, is in W1.** The Now command (W3)
    needs the clock's reading at an instant, and the
    inverse makes `instantOf`'s exhaustive round-trip table possible. It
    returns the hour unrounded; Now floors it to the slider's step
    (Decision 30). *Decided unattended (2026-11-16, lane/weather), for the
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
21. **Rain darkens, calibrated rather than cited; its extinction only
    derives a missing visibility.** The sky and the sun's light are
    darkened by `wet = 1 - 0.3 · R / (R + 4)`: 0.85 at 4 mm/h, tending to
    0.7, exactly the identity at 0 mm/h, so a dry world is untouched. W2
    also added rain's extinction to the visibility; W4's review moved that
    out (Decision 41), and it now lives in open-meteo.js, where it derives
    the visibility when a reply sends none: `0.25 · R^0.73` per km, the
    usual power-law form, its constants set so that rain alone gives about
    8 km of visibility at 2.5 mm/h (moderate rain) and about 1.5 km at
    25 mm/h (heavy rain), the visibilities usually described for those
    rates, added to the air's `3.912 / visibility` as extinctions add.
    There are no particles and no wet decks. *Decided unattended (2026-11-16, lane/weather), for the lead.*
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
    their range. An integer must be a safe integer. A date must pass
    `validDate` (an offset is a number like any other), and an enum must
    be one of its options. `source` is dropped, because no ambient reads it. Any trait,
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
29. **The provenance record is the fetched fields, as a map, and covers the
    place and moment.** W3 first wrote `source.sum`, the JSON of the summed
    fields in a positional array: exact, but its meaning hung on the
    describes' order (reordering or inserting a field would silently turn
    every fetched doc into "dialled since fetch"), it couldn't be read in
    the doc, and it couldn't say which field was dialled. Now a fetch
    writes `source.fields`, the summed fields in force by name
    (`fetchedFields`), and `dialledSince` compares key by key: the same
    exactness, no hidden order, and the tooltip names what was dialled
    ("… (hour, cover)"). A field the record doesn't name counts as
    dialled, so a partial record can't vouch for what it didn't fetch; a
    key it names that isn't summed is ignored. It records every field but
    `seed` (which gust pattern plays). Moving the hour, the date, the
    clock or the coordinates after a fetch makes it "dialled since fetch",
    because the snapshot was the conditions of that place at that hour;
    the sun still follows the slider. The comparison is over the params in
    force, so a field left out and the same field written as its default
    are one weather. A source, or a `fields`, that isn't the trait's own
    map is no fetch on record: "dialled". The cost is a few hundred bytes
    in the doc per fetch. *Decided unattended (2026-11-16, lane/weather),
    for the lead.*
30. **Now writes the present quarter hour, floored, and Place offers "here"
    only when it is true.** W3 first wrote the minute, because a quarter
    hour is 3.75° of sun. But the hour field steps in quarter hours, and
    the inspector's number box then held a value its step calls invalid
    (`15.116666666666667`): the field and its only programmatic writer
    disagreed. A step of 1/60 has no exact decimal, so the browser's step
    check on it is a float comparison. So Now floors to the field's own
    step, read from the describes: it writes only what the slider can
    show. Open-Meteo's `current` is itself 15-minutely (W0's spike:
    `interval: 900`), so the present quarter hour is what a fetch of now
    describes. Floored, so the hour never reaches 24 and stays on the date
    it reads. It is exact, with no exceptions now that the clock is fixed:
    over every minute of two days on eight clocks (UTC−12 to UTC+14, half
    and quarter hours among them), the hour Now writes is on the step and
    reads back through `instantOf` as the quarter hour that minute is in.
    Place's "here" entry, the plan's third choice, is the coordinates in
    force: it appears only when the weather is at neither preset, as the
    picker's honest value, and picking it is a no-op (a picker can only
    show a value it offers). Nothing asks the browser for the viewer's own
    location: that would put a person's whereabouts into a shared doc.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
31. **The commands are the world's weather's only.** The toolbar shows
    one segment per stage on the focus path, so with focus inside a linked
    boat that carries a `weather` of her own, Place and Now showed twice,
    and the inner pair wrote a weather the outermost rule keeps out of
    force, with nothing to say so. Each command's state is now null, and
    its run writes nothing, unless this stage is the outermost:
    `api.ambient("wind").mine` (STAGE.md "Ambients": `mine` is "this is
    the outermost stage"; a stage with the trait offers a wind, so it is
    non-null exactly there). A boat linked into a dry room gets none
    either (the outermost offers no wind: null). No scene change. The
    linked world's Weather sliders in the inspector are still shown and
    still inert: the inspector draws every behaviour a doc has, and hiding
    one is the inspector's business (a scene question, folded into
    Question 11). The probe enters a linked boat with her own weather and
    checks one Place and one Now, showing the world's place. *Decided
    unattended (2026-11-16, lane/weather), for the lead.*
32. **No `place` field: the coordinates are the place.** W3 had `place`, a
    free string the Place command wrote and nothing read (the picker
    matched coordinates), shown in the inspector as a second control also
    called "Place". Nudging the latitude left it saying "Ucluelet" while
    the picker showed coordinates, and typing "Ucluelet" into it moved
    nothing: a field that could lie. It is gone. A preset's name lives in
    `PLACES` and is shown when the coordinates are a preset's; otherwise
    the coordinates themselves are shown. The plan's shape had the field.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*

33. **A fetch happens only when someone presses Fetch, and there is one
    `fetch` call.** `fetchWeather` holds the package's only `fetch` call,
    and only the two Fetch commands' `run` call it. Tests: a scan of the
    runtime sources finds exactly one `fetch(` (dotted or not), inside
    `fetchWeather`; making the extension, its `ambient()` and every
    command's `state`, over every trait and world in the tables, calls a
    stubbed `fetch` that throws, and it is never called. The fetch runs in
    the pressing viewer's page (Decision 7), so nobody else's browser
    talks to Open-Meteo, and every peer reads the snapshot from the doc.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
34. **Routing is by whole UTC days, both hourly routes ask for one day,
    and the snapshot takes exactly the hour asked for.** The plan named
    `start_hour`/`end_hour` for the forecast; the archive takes dates. One
    shape for both (`start_date` = `end_date` = the UTC day of the hour
    nearest the instant) is simpler, and 24 hours is a small reply. The
    forecast's reach was measured on 2026-11-16: its error reply names the
    allowed range, 2026-08-15 to 2026-12-01, so 93 days back and 15 ahead
    of today (UTC). Routing uses 90 back: the 3 days' margin keeps a
    request near that edge from being refused for a day boundary or clock
    that isn't quite ours, and the archive has every day beyond it (ERA5
    lags 5 days), so nothing is lost. 15 ahead is the edge itself, so on
    the 15th day, just after UTC midnight, a forecast whose "today" lags
    could refuse it: a notice, nothing written. Rather than "the hour
    nearest the request among those sent", the snapshot looks up the one
    hour `routeOf` named (half past rounds up) and fails without it, so it
    can't silently take another hour. "Within 30 minutes of now" is
    inclusive. On the present route there is no hour to look up: the
    present conditions stand for any instant within 30 minutes of now, and
    the snapshot checks that they are stamped within 30 minutes of the
    press (`request.now`), the same point routing measured from, so a
    reply routing accepted can't then be refused for a time off the
    hour slider's step; `source.for` is their own stamp, not the time
    asked (W4 review). *Decided unattended (2026-11-16, lane/weather), for the lead.*
35. **The snapshot is of the place and moment asked, and Fetch never
    sets the clock.** A snapshot writes every summed field: the conditions
    from the reply, and lat, lon, date, hour and offset from the request,
    as they were when Fetch was pressed. So the doc's record is consistent
    by construction (`source.fields` is exactly what was written), even if
    someone moved the hour while the fetch was out. Only the fields that
    differ are written, so a field dialled while the fetch was out, to the
    snapshot's own value, isn't written over, and a field dialled after it
    landed is theirs and named by the provenance. `source` is written
    whole: it is one record, so two fetches at once leave one record,
    never a blend. W3 left open whether Fetch sets `offset` from
    Open-Meteo's `utc_offset_seconds` (with `timezone=auto`). It doesn't:
    the clock is when people read the hour, and the presets carry theirs;
    the reply's offset would be its zone's at fetch time, not at the date
    asked (the zone-data question again, Decision 15); and `timezone=GMT`
    keeps the whitelist to one fixed value. *Decided unattended (2026-11-16, lane/weather), for the lead.*
36. **What Open-Meteo doesn't send is derived, by finite tables, and every
    value lands on its slider.** No model sends a cloud kind or base, and
    the archive and GEM send no visibility. The base is the LCL (Espy's
    125 m per degree of dew-point spread, clamped 100..3000 m as the plan
    said) under a low layer or none; a dominant mid or high layer has no
    base in the data, so it takes its étage's typical base (3000, 7000 m),
    and the LCL, which is where low cloud forms, would be wrong for it.
    The kind is read from the weather code first and then the dominant
    layer (sheet at 0.6 cover or more, stratus under 300 m), judged on the
    base as written; showers of snow (WMO 85, 86) are cumulus like showers
    of rain, as the rule says (W4 review). Visibility is written as sent
    (Decision 41); derived, it is humidity's haze with caps for fog, snow
    and drizzle, seen through the rain that fell. Precipitation is
    turned into a rate by the reply's own interval (the present conditions
    are a 15-minute sum, measured: `interval: 900`). Every number is then
    clamped and rounded to its slider's step (`onStep`), so a fetched
    weather is one the sliders can show, and reading it back through
    `weatherParams` changes nothing. The tables' thresholds are reasoned,
    not calibrated; the recorded replies show they give sane skies
    (Question 13). *Decided unattended (2026-11-16, lane/weather), for the lead.*
37. **Fetch for this time's label is the provenance, and Place's tooltip
    says what Place does.** W3 put the provenance in Place's tooltip, seen
    only by hovering, on a control about where, not where from. The
    button that fetches is where "is this fetched?" belongs: its label
    reads "Fetch for this time", "Fetched for this time" or "Fetch again
    (hour, cover)", and its tooltip says it in full. For a time
    Open-Meteo has no weather for, the button is disabled and its tooltip
    says why (the stage writes a disabled command's title as the reason).
    The disabled state is computed when the toolbar renders, so it can be
    stale by however long the toolbar sits unrendered; pressing it then
    is a notice and no fetch. *Decided unattended (2026-11-16, lane/weather), for the lead.*
38. **There is no busy state, and every failure is a notice.** A fetch
    takes a few hundred milliseconds, the success notice is the feedback,
    and a second press while one is out is a second fetch whose snapshot
    lands last: harmless, and a busy flag would be state to keep and
    clear. The reply is checked before anything is written: an error
    reply's reason is said (when it is a string); a reply not in GMT, any
    variable with a number in another unit than asked (one loop over
    `UNITS`), no reply for the hour asked, or present conditions more
    than 30 minutes from now each fail with a reason. The stage stopping
    while a fetch is out aborts it through `api.signal`, passed to the
    fetch, and nothing is said or written, whatever reason it aborts with;
    a reply landing after this stage stopped being the world's writes
    nothing. The success notice is said only when the change wrote, so a
    trait removed while the fetch was out is neither made again nor
    reported fetched; a press with no trait (removed after the toolbar
    drew) neither fetches nor says anything. *Decided unattended (2026-11-16, lane/weather), for the lead.*
39. **The fetch sends the URL and nothing else.** `credentials: "omit"`
    and `referrerPolicy: "no-referrer"`, so neither a cookie nor the
    page's address goes with it; the browser still sends its CORS `Origin`
    (the Patchwork origin, which names no doc). The URL's keys are a
    fixed whitelist per route, and a test varies every other field of the
    weather, each at both ends of its range or through each option, and
    finds the URL unchanged. *Decided unattended (2026-11-16, lane/weather), for the lead.*
40. **The recorded replies are real, and recorded by the package's own
    request.** `probes/record-fixtures.mjs` builds each URL with
    `requestFor`, so the fixtures are what the runtime would fetch; the
    GEM fixture adds `models=gem_seamless`, which requests never carry,
    and the error fixture asks 30 days ahead, which routing never does.
    The clear-sky fixture is the first afternoon hour of July 2025 at
    Cadboro Bay with every cloud layer at 0, found by the recorder in the
    archive. *Decided unattended (2026-11-16, lane/weather), for the lead.*
41. **The `visibility` field is the visibility in force, rain and all, as
    it is observed, and rain only darkens.** W2 made `visibility` the
    air's and added rain's extinction on top, so W4 had to take the rain
    back out of an observed visibility (`airVisibility`), which was lossy
    at the slider's 50 km end: 24.14 km observed in 0.5 mm/h became 50 km
    on the slider and 17.1 km in force, and the inspector showed a number
    nobody reported. One field, one meaning: the slider shows the
    visibility in force, which is what Open-Meteo reports and what a
    person dials. So `atmosphere.js` reads `visibility` as it is
    (`visibilityOf` is gone), and rain darkens the sky and sun (`wet`)
    without drawing the fog in; `airVisibility` is gone. Where a reply
    sends no visibility, the derived one is the visibility in force too:
    the air's seen through the rain that fell (Decision 21). The cost: a
    hand who dials rain up must dial visibility down to see the rain close
    the horizon in. The plan's W2 row said rain lowers visibility; it
    still does in a fetch, through the data, but not on the sliders.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
42. **No Fetch now: Now, then Fetch for this time, is it.** Now writes the
    present quarter hour, within 15 minutes of now, inside the present
    conditions' 30, so Fetch for this time then fetches the present
    conditions (a table checks every minute of an hour on four clocks).
    The plan's Fetch now was the same snapshot in one change instead of
    two, at the cost of a fourth weather control on every boating scene's
    toolbar in Edit (Question 11). Three commands, each doing one thing:
    Place (where), Now (when), Fetch for this time (what it was then and
    there). Now's tooltip says that Fetch for this time then fetches the
    present conditions. If one press for the present matters more than a
    shorter toolbar, Fetch now comes back as Now and Fetch in one change
    (Question 3). *Decided unattended (2026-11-16, lane/weather), for the lead.*
43. **Sailing writes the air only, `{ wind, from, seed }`, and its wind
    stays its own.** Where a scene has no open water, the Sea and Sloop
    parts and the Ship at sea and Ship at anchor templates write
    `weather: { wind, from, seed }` (sailing parts.js `newWeather`): the
    breeze sailing chose (7 m/s from 45°; at anchor 6.5) and one seed for
    the waves and the gusts, as before. Every other field is the weather's
    default, so a new boat's world is a fair afternoon at Cadboro Bay,
    15:00 PDT on 15 July 2026, under the bright day, which is the sky
    sailing's constant atmosphere drew (W2's anchor). Writing the whole
    trait (`init`) would need sailing to know this package's fields; not
    writing one would need a defaulted wind the sim could not read from
    the doc. Sailing never reads the trait back: what it reads is the
    `wind` ambient (sea-view.js, sea.js). The cost: without this package
    loaded, a sailing scene has no wind, and its boat lies becalmed.
    *Decided unattended (2026-11-16, lane/weather), for the lead.*
44. **Sailing's tests stand in for this offer with a pass-through.**
    `sailing/src/test/weather.js` `windOffer(trait)` passes the trait's
    own `wind`, `from` and `seed` through as `{ speed, from, seed,
    gustiness }`, with sailing's own `GUSTINESS` (wind.js) where the trait
    has none, and null for no trait; sailing's fakes offer it as the
    `wind` ambient. It copies none of this package's policy (defaults,
    ranges, clamping), which sailing never relies on, since its parts and
    templates always write the three numbers (Decision 43); a sailing row
    pins that a number this package would clamp (wind 45, from 400) or
    refuse (a fractional seed) passes through unchanged, and that the
    module exports nothing else. The two packages meet at the
    convention's four numbers: here, trait → offer over W5's 48 rows
    (`weather.test.js`); in sailing, offer → her wind, sampled exactly
    against `createWind`, each field shown to reach her. The probes
    (Decision 47) run the real offer. (W5 review: the first stand-in
    copied the defaults and ranges, which pinned this package's defaults
    inside sailing, and its self-check row proved nothing.) *Decided
    unattended (2026-11-16, lane/weather), for the lead.*
45. **A boat alone is the world by the wind's `mine`, now this package's;
    without it, a Sloop dropped in is becalmed and says nothing.**
    sailing's `world()` (her camera ride and HUD) reads the `wind`
    ambient's `mine` (WATER.md Decisions 19, 28, 64; the stage gap D4,
    "whether a stage is the outermost, without an offer"). That wind is
    now this package's offer, so whether her doc is the world now
    depends on another package being loaded, which is a change, not "as
    before". What lists this package is STAGE.md's "Reconcile": a peer
    adds a package's URL only when it has a plugin of that package
    answering a need in the doc (or ran its part or template). The
    publishers list it (Decision 46), so every published example loads
    it. The gap: a viewer who has sailing but not this package and drops
    a Sea or Sloop from the bin writes `weather: { wind, from, seed }`
    (parts.js `newWeather`), but sailing's part can list only sailing,
    and no peer of that viewer can list this package. The trait is then
    inert: no `wind` ambient, so the Sea is flat, the boat becalmed and
    `world()` false (no HUD, no camera ride), with nothing telling the
    user (sailing `sea-view.test.js`, "no weather, no wind"). Before W5
    sailing sailed on its own there. Once any peer with this package
    opens the doc, it lists the package and everyone gets the wind.
    Closing the gap needs either a notice for a scene trait no loaded
    plugin answers (a stage change), the stage's D4 answer to "is my doc
    the world" without an offer (a stage change), or sailing knowing this
    package's URL (a build-time coupling CLAUDE.md rules out). None is
    taken; it is the lead's call (Question 15). *Decided unattended
    (2026-11-16, lane/weather), for the lead.*
46. **Publishers list this package wherever they write `weather`.** Ship
    at sea and Ship at anchor (`publish-ship`), Lost Cities aboard
    (`publish-aboard`) and the Harbour (`publish-harbour`) list `weather`
    with the rest; the Breezy pavilion (`publish-model-room --weather`)
    lists `weather` instead of `sailing`, which it listed only for the
    weather extension. They cannot run until W8 syncs this package (its
    pushwork URL), and W8 runs them. `publish-fitout` writes a weather
    through sailing's template, but lane/n11 is changing it, so W8 adds
    `weather` to its list after n11 merges. The harbour still turns each
    boat by her weather's `from` less its own (WATER Decision 22), now
    read as `weather.from`. *Decided unattended (2026-11-16, lane/weather),
    for the lead.*
47. **The probes load this package's build and check the boat's wind is
    its offer.** Every sailing probe page that loads water's build loads
    `weather/dist` too (the harbour, basin, model room, aboard, camber,
    links, pins and sailing probes). `sailing-run` checks that her wind in
    both views is the doc's weather (speed, from, the default gustiness).
    `harbour-run` checks that each boat alone sails in her own weather's
    wind, and that the world ambient is exactly the offer, and that,
    linked, both boats' winds turned back into the world are the
    harbour's (5 m/s from 250°), not their own. The harbour's sky check
    (`#2f6db5`) stands: the weather's default is the bright day. Run
    2026-11-16 in Chrome with the built scene, sailing, water and weather:
    `sailing-run` 86 of 86 (her wind in both views 7 m/s from 45°,
    gustiness 0.3, the doc's `{ wind: 7, from: 45, seed }`), `harbour-run`
    26 of 26 (alone, each boat's wind and the world ambient her own
    weather's; linked, both boats' winds 5 m/s from 250° to 1e-13, the
    harbour's).
    *Decided unattended (2026-11-16, lane/weather), for the lead.*

48. **A place's template writes the whole weather, not only the air.**
    Cadboro Bay's and Ucluelet's templates write every field the place
    knows: `lat` and `lon` (the place's frame origin, which are this
    package's `PLACES` exactly, so the Place picker reads the place's
    name), `date`, `hour` and `offset` (15:00 on 15 July 2026 on UTC−7,
    inside the 13:00–18:00 PDT hours both wind climatologies are of),
    `wind`, `from` and `seed`, and `cover`, `clouds`, `base` and
    `visibility`. `gustiness` and `rain` are left to their defaults (0.3,
    the stock; 0): the places' climatologies say nothing of either. A
    place doesn't lean on this package's defaults for what it does know
    (Cadboro's sky equals the defaults today, and is written anyway).
    Sailing's parts write only the air (Decision 43) because a boat has
    no place; a place does. *Decided unattended (2026-11-16,
    lane/weather), for the lead.*
49. **What a sky *is* stays with the place; how it looks is this
    package's.** The plan said `SKIES` leave terrain. Their colours did
    (they are the anchors, Decision 9); their conditions stayed, as this
    trait's sky fields: Ucluelet's `SKIES` (Ukee grey: stratocumulus,
    cover 1, 600 m, 19 km; marine layer: stratus, cover 1, 100 m, 1 km;
    clear afternoon: cover 0, 20 km, cumulus at 1200 m, the default base,
    meaning nothing without cloud) and Cadboro's `SKY` (the fair
    afternoon: cumulus, 0.35, 1200 m, 10 km). They are the place's
    climatology (ECCC's Amphitrite Point record for Ucluelet; art
    direction for Cadboro, whose Discovery Island record has wind and no
    sky), so they belong to the place, and the name `SKIES` is kept
    because the template's option is still `sky`. The marine layer's base
    (100 m) is new: the old look had no deck, and the fog hides any deck
    at 1 km (haze 1). *Decided unattended (2026-11-16, lane/weather), for
    the lead.*
50. **No per-place look override (Question 2's default, taken).** A place
    gives no sky at all, not even an art-directed one over the generic
    model: under its template's weather each place's old look comes back
    exactly (the anchors), and every other weather there is the model's.
    Only the sun moves. At Ucluelet the computed sun (azimuth 221.71°,
    apparent elevation 56.98°) is 0.41° from the old hand-set
    `[-0.36, 0.84, 0.4]`, which was set for this moment; at Cadboro
    sailing's old sun stood in the north-east (`[0.55, 0.7, -0.45]`, set
    for no moment) and the real one is in the south-west, so Cadboro's
    light now comes from the other side of the sky. Ukee grey's fog far
    is 17 100 m, not 17 000 (Decision 9); terrain's far-forest tests now
    check against the weather's numbers through a test copy
    (`terrain/src/test/ukee-grey.js`), which the Ucluelet publisher checks
    against the page's own atmosphere. *Decided unattended (2026-11-16,
    lane/weather), for the lead.*
51. **`terrain.place` has no fields and no ambient.** It says only "this
    object is the place": the shore in the water, the water's shelter and
    the ground's grain, for the lowest-id shown object that has it, as
    before. Its `ambient()` went with the sky; it had also called the
    grain's `dress()` at every flush, and the stage already calls
    `update()` whenever content changes (a GLB arriving), so the grain is
    still dressed (the Ucluelet probe's grain check). No back-compat: a
    doc with `terrain.sky` gives no shore and no grain until republished
    (W8). *Decided unattended (2026-11-16, lane/weather), for the lead.*
52. **A sky the template hasn't is refused before anything is written.**
    `layOut(ctx, url, { sky })` throws a `RangeError` naming the three
    skies for any other name, inherited ones (`toString`) included,
    before the terrain is added. The template itself always passes Ukee
    grey; the option is for publishers and tests. *Decided unattended
    (2026-11-16, lane/weather), for the lead.*

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
  transcendental calls; `instantOf` is a date check and an addition (W1's
  first `instantOf` read a zone's offsets through `Intl`; Decision 15).
  Both run only when the trait changes.
- **W2**: none at run time until W3 calls it. `atmosphereOf` is one
  `instantOf` and one `sunAt`, plus about 60 multiplies and 12 `pow`
  calls for the colours: tens of microseconds. The test grid (6720
  weathers, each computed four times and checked) runs in about a second;
  the drawn-deck sweeps (a copy of the stage's `cloudAt` over 864
  directions, every 0.01 of cover and haze for every kind) add under a second.
- **W3**: `ambient()` runs on every flush. Each time it fills the params
  (`weatherParams`: fourteen field checks and one `validDate`) and stringifies them, a few microseconds; only a change in
  the params in force recomputes the atmosphere, and otherwise it returns
  the same object, so the stage's merge does nothing. The commands' state
  is the same params, asked once per toolbar render. The tests: about
  140 rows, of which the two-day minute table on eight clocks (23 040
  `nowWrites` and `instantOf` round trips) takes about 0.2 s, and time.js's
  table of every quarter hour on every quarter-hour clock (40 740 round
  trips) about 0.4 s.
  Dragging the hour slider writes a change per input event, as every
  slider does, and each one is one `atmosphereOf` (tens of microseconds)
  and one viewport relight.
- **W4 (Fetch)**: one HTTP request per press, from the pressing viewer
  only, a few kilobytes (the hourly routes fetch one day, 24 hours of 13
  variables). Open-Meteo's free tier allows 10 000 calls a day for
  non-commercial use, far beyond a button. The snapshot goes stale
  silently: the doc says when it was fetched and for what hour, and
  nothing refetches. In the doc, a fetch adds `source`, about 400 bytes,
  replaced whole by the next. Each toolbar render now also routes Fetch
  for this time's request (one `instantOf`, no fetch) to know whether to
  disable it. The tests add about 390 rows (after the review, open-meteo.test.js has 226 and extension.test.js 208), all under a second; the six
  fixtures are 26 kB. The review fixes cost nothing at run time: the unit
  loop is 13 lookups per reply, and dropping Fetch now and
  `airVisibility` removed code.
- **W5 (sailing)**: a sailing scene runs one extension fewer
  (`sailing.weather`) and this one instead, which computes an
  atmosphere (tens of microseconds) only when the trait's params change,
  where sailing returned a constant. Sailing's wind is the same four numbers
  as before, so its physics costs the same. Each sailing probe page loads
  one more build (this package's, about 21 kB). Sailing's word `wind` is
  two things: the option `{ speed, from }` (parts.js `WIND`, layout.js
  `ANCHORAGE_AIR`, `bringSea`'s and `layOutShip`'s `wind`) and the
  trait's number (m/s), so `newWeather` reads `wind.speed` into `wind`.
  Renaming the option `air` is left until lane/n6, which edits parts.js
  and template.test.js, has merged (W5 review nit).
- **W6 (terrain)**: a place's scene runs one extension fewer offering an
  ambient (the place's), and this one instead: at Ucluelet the atmosphere
  was a copy of a trait, now `atmosphereOf` once per change of the
  weather's fields (tens of microseconds). The doc gains a `weather` of
  12 fields (about 200 bytes) and its terrain object loses the sky's JSON
  (about 400 bytes at Ucluelet). The place's grain is dressed on
  `update()` alone, not also at every flush. A viewer without this
  package sees a place under the stage's own sky with no wind (Question
  15's gap, now for the places too). Terrain's tests carry two copies of
  this package's numbers: Ukee grey's horizon and fog for its far forest
  (`test/ukee-grey.js`) and this trait's field names (template.test.js);
  the publishers check both against the page.

## Questions for the lead

1. Does the day pass? The default is a fixed snapshot, so the sun stays
   where date and hour put it. The alternative is that the sun follows world
   time (date and hour plus `clock.t`), reflushing every minute.
2. Ucluelet's Ukee grey and Cadboro's bright day become fixed points of one
   generic sky model, and terrain gives no sky of its own. Is that enough, or
   should a place keep an art-direction override? (W6 took the default,
   Decision 50: no override. Cadboro's sun now shines from the south-west,
   where it is at 15:00, not from sailing's old north-east.)
3. The UI is the scene inspector's Weather behaviour (the sliders) and the
   toolbar's Place picker and the Now and Fetch for this time buttons, in
   Edit, the world's weather's only (Decision 31). The present conditions
   are two presses, Now then Fetch (Decision 42): do you want a one-press
   Fetch now back? Do you want a dedicated
   weather pane (a compass dial, a day scrubber with the sun's path), or a
   weather chip on N8's world bar that shows outside Edit?
4. Dry rooms (the Model room, the Model basin, the basin mashup, the Quiet
   games room, Games night) have no weather. Should any of them be under a
   sky, such as the Breezy pavilion?
5. The data source is Open-Meteo `best_match`, plus the ERA5 archive for the
   past. Should Canadian places use GEM explicitly, with the source naming
   the model, even though it returns no visibility? The recorded GEM reply
   (`src/fixtures/cadboro-gem.json`) also disagrees with itself: total
   cloud 18% under a low layer of 55%. `best_match` at Cadboro sent a
   visibility.
6. A fetch is a one-time snapshot written by whoever presses it, and it is
   not on the undo stack (a package's writes can't be without a scene
   change). Is that acceptable, or do you want undo, or a live mode that
   refetches hourly?
7. Night has no moon and no stars. After sunset the sun stays in the
   atmosphere as a dark light pointing where it is (Decision 19), so the
   night is lit only by the dim sky. Rain shows only as a darker sky
   (and, in a fetch, the lower visibility reported with it), with no
   particles; dialling rain doesn't draw the fog in (Decision 41). Is that OK for now?
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
11. The scene inspector shows no scene commands, so Place, Now and Fetch
    for this time are on the toolbar and the menu, not beside the weather's
    sliders (Decision 28), and the weather's controls sit on two surfaces:
    in Edit, every boating scene carries its weather commands on the
    toolbar next to the view toggles even when nobody is touching the
    weather. Should the scene inspector show the scene's commands that name
    "inspector" in `show`? That is a one-rule scene change, and the
    weather's commands would then sit in its Weather section, all of the
    weather in one place. This should be settled together with your new
    request to integrate the sidebar's objects list and the inspector,
    which rewrites this surface: the merged panel is where scene commands
    would land. The same work could hide a linked world's Weather
    behaviour, whose sliders are shown but not in force (Decision 31).
12. The clock is a fixed UTC offset in the doc, not a time zone, so every
    peer computes the same sun (Decision 15: peers' zone data disagreed for
    British Columbia from 2026-11-01). It doesn't follow daylight saving:
    dial a January date at a place that keeps DST and its hour reads on the
    summer clock (the sun is right for that instant; the label is an hour
    off that day's civil time) until someone dials `offset`. British
    Columbia itself is UTC−7 all year from November 2026, so the presets
    are unaffected from then on. Is a fixed clock acceptable, or should the
    date slider carry the clock with it (which needs zone data at the
    moment of writing, by whoever dials, frozen in the doc)?
13. Fetched gusts often saturate. ERA5's and the forecast's hourly peak
    gust over a light mean is commonly 2 to 4 times it (the recorded
    replies: 1.93 m/s gusting 7.7; 3.59 gusting 8.7; 6.93 gusting 14.6),
    so by Decision 10's rule a fetched light day is gustiness 1: gusts to
    double, lulls to calm, veers of ±33°. That is the rule doing what it
    says with what the models send, but it makes most fetched light airs
    as fluky as the slider goes. Keep it, or cap a fetched gustiness
    (say at 0.5), or scale it down below some wind speed? (The derivation
    tables in Decision 36, the LCL, the sheet threshold and the humidity
    haze, are reasoned too, and are yours to tune.)
14. The trait stores a cloud kind (`clouds`: cumulus, stratocumulus,
    stratus, cirrus), which is the renderer's vocabulary; Open-Meteo sends
    layer covers (low, mid, high) and a weather code. So a fetch has to
    classify (`kindOf`, `SHEET`, `STRATUS_BELOW`, `BASES`, the code
    groups) and writes its guess into the doc as if it were data. One
    case the guess gets visibly wrong: code 3 (overcast) with no single
    layer at 0.6 or more, e.g. low, mid and high at 50% each, total 100%,
    gives cumulus at cover 1, drawn as scattered heaps at 0.95. The
    alternative is to store what is measured (`low`, `mid`, `high`
    covers) and let the sky derive the kind, with the kind slider
    becoming three cover sliders. That is a data-shape change, so it
    wants your call before W8 republishes the examples. Default: keep the
    kind, keep the classifier.
15. A Sloop or Sea dropped from the bin by a viewer who has sailing but
    not the weather package is becalmed, flat and HUD-less, and nothing
    says why (Decision 45): the doc's `weather` trait waits for a peer
    with the weather package to list it. Before W5 sailing carried its
    own wind. Options: accept it (every published example lists the
    weather; anyone with the weather package fixes the doc by opening
    it); a stage notice for a scene trait no loaded plugin answers (a
    scene change, the general fix, and the one that also helps every
    other package's traits); or the stage's D4 (whether a stage is the
    outermost without an offer), which fixes the HUD but not the wind.
    Default: accept it.
