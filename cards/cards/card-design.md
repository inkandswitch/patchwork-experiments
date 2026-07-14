# How to design a card

A card is a small playing card; it can sit anywhere a document can. The
shared shell draws its frame: the title, mirrored corner pips (an icon in
the card's accent color), a main section in the middle, and a text
section at the bottom.
The card's module fills these in. This guide is about what belongs where —
and what doesn't.

The card's spec has its own guide (see spec-style.md); the writing rules
there — concrete, plain, for someone who is not a programmer — apply to
the card's face too.

## The design lives in the code, the settings in the document

The icon, accent color, and text are part of the card's design: they
change when the behavior changes, and every instance of the card shares
them. They belong in the module, next to the behavior — never copied into
each card document.

The document holds only what differs per instance: the settings you can
change through the card (the bird card's "all birds / this week") and the
state a running card captures for itself (the page card's last captured
page, the zoom card's camera position to return to). Rule of thumb: if a
field would be identical in every freshly minted copy, it's design — put
it in code.

(The title is the exception: it's the document's name, stored in
`@patchwork.title` like every Patchwork document's, and the user can
rename it.)

## The main section must earn its place

Most cards render nothing there, and that's the norm — a card that does
its work elsewhere (glows, pins, stickers, menus) should show a calm
face, not a control panel.

Render into the main section only when there is content genuinely worth
looking at: the list of birds found, the captured web page. Never render
for debugging — channel readouts, version stamps, internal state. If you
need to see what a card is doing, that's the context viewer's job.

> **Not this:** a "selected: … / highlighted: …" readout of the card's
> channels
>
> **This:** nothing — the glow on the views themselves already shows
> what's highlighted

Cut status lines that repeat what's visible: "3 species seen" above a
list of three species says nothing. A status may stand in for content
that isn't there yet ("Looking for birds…", "No sightings reported here
yet") — and it disappears when the content arrives.

## The text section is the card in one sentence

The text at the bottom says what the card is doing, present tense, card
as subject: "Draws a blue glow around every view whose document is
highlighted." For a card whose main section is empty this sentence is the
whole face, so it carries the weight: name the visible effect, not the
machinery.

Keep the details that shape the experience, drop everything else — the
same rules as spec writing. The spec explains and teaches; the face just
states. Instructions ("put this card next to a map") belong in the spec,
not on the face.

## Settings are words in the sentence

When a card has settings, weave them into the text as pickable words
instead of adding form controls — the sentence is both the description
and the controls:

> Showing **all birds** spotted **this week** on any **map**.

Each bold word is a picker; changing one changes the setting and the card
follows. The current settings and the description of the behavior stay
one and the same thing.

## Point at what you name

When the text names something the card actually works with — "map", "geo
shapes" — hovering the word highlights the real thing: the map the card
watches, the documents contributing shapes. The reverse holds too where
it's cheap: hovering a bird in the list lights up its pin on the map.
These threads are what make a card feel connected to its surroundings
instead of merely describing them.

## Status may change the sentence

When the card's situation changes what the user should believe, the text
section may say so: "Not live — the browser extension isn't connected, so
this is the last page it saw." One muted line, and it goes the moment the
situation resolves.

## A worked example

The Bird Sightings card:

- **In code:** the bird icon, the green accent, and the text renderer.
- **In the document:** `kind` ("all" | "rare") and `period` ("today" |
  "week" | "month") — the two settings, nothing else.
- **Text section:** "Showing [all birds] spotted [this week] on any
  [map]." The bracketed words are pickers; hovering "map" glows the map
  it watches.
- **Main section:** the list of species found, each row lighting up its
  pin on hover. While searching, a single muted "Looking for birds…"
  where the list will appear; when nothing is found, "No sightings
  reported here yet."
- **Not on the card:** a count of results (the list shows that), the
  eBird mechanics (the spec explains that), anything about channels.
