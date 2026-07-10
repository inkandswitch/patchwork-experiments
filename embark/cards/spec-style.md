# How to write a card spec

A card's `spec.md` does two jobs. It explains the card to the person using
it: what it does and how to use it. And it is how you change the card: edit
the spec, regenerate, and the card's high-level behavior should follow.

That second job doesn't mean the spec has to contain everything. It carries
the behavior worth deciding at this level; the code is still the source of
truth for the more technical aspects.

## Shape

- One short paragraph: what the card does overall and how you'd use it.
- A few bullets: the behavior in more detail.
- Keep the whole spec brief. If the paragraph and a bullet say the same
  thing, cut one of them.

## Write for someone who is not a programmer

Describe what the user sees and does — pins, glows, stickers, text — not the
machinery. Channels, extensions, modules, and observers don't belong in a
spec. Someone who has never programmed should read the spec and know what
the card will do for them.

> **Not this:** publishes a zooming map extension into the canvas
> `map:extensions` channel while present, released on removal
>
> **This:** while this card is face-up, every map on the canvas moves its
> own camera; flip or remove the card and the camera stops moving on its own

## Say what concretely happens

Every sentence should say what happens, ideally in the form "when you do X,
the card does Y". No slogans, no personification — if a sentence sounds like
a product page, replace it with the plain version. The plain version always
carries more information.

> **Not this:** Pan or zoom the map and the results follow.
>
> **This:** when you pan or zoom the map, it waits half a second for the map
> to settle, then searches the new area and replaces the pins.

> **Not this:** Makes maps frame what matters.
>
> **This:** Automatically points maps at the highlighted geo shapes.

Prefer the user's concrete action over an abstraction the spec would then
have to define: "the position you last set by hand", not "the home view".

Cut filler: "of its own", "at once", "quietly".

## Keep the details that shape the experience

Some implementation details are the experience — keep those, in plain words:

- "waits half a second after the map stops moving, then searches the new
  area"
- "holds still while your pointer is over the map, and catches up when it
  leaves"
- "stickers stay attached to their text as the document is edited around
  them"

And leave these out:

- Reactivity. Everything in Patchwork updates live; never write "stays up to
  date as documents change".
- Multi-instance trivia ("two of these cards on one canvas are fine").
- Incidental dependencies the card touches but doesn't conceptually rely on.

## Settings

Describe what you can set on the card, not the widget that sets it.

> **Not this:** the sentence on the card is editable
>
> **This:** on the card you can set which birds to show (all or rare) and
> from when (today, this week, or this month)

## Link what the card depends on

- Other cards: link them instead of re-explaining them, with a one-clause
  division of labor ("this card only moves the camera — the
  [Geo Shapes](../geo-shapes-card) card draws the pins and lines it zooms
  to").
  If the card is one half of a pair like that, say so in the opening
  paragraph, not the last bullet.
- Outside services: name them, add a one-phrase explanation and a link:
  "[eBird](https://ebird.org) (a public database of bird sightings)".
- In this repo, link cards by their package folder (`../schema-matcher`);
  cards that live inside Patchwork link by automerge url.

## Describe capabilities at their real scope

Check where the behavior actually applies before scoping it. Stickers
annotate markdown documents wherever they're edited, so a spec that says "on
the canvas" is wrong. And name the specific thing rather than gesturing at
it: "highlighted [geo shapes](../geo-shapes-card)", not "whatever is
highlighted" — abstract referents read as mysterious.

## Editing an existing spec

- If the spec is already well-written, keep its structure and voice; fold in
  only what changed.
- If it is a rough, ambiguous pile of bullets, restructure it.
- Never drop a requirement the person who wrote the spec put there.

## A worked example

```markdown
# Bird Sightings

Shows which birds have been spotted in the area a map is looking at. Put
this card on a canvas with a map: it asks [eBird](https://ebird.org) (a
public database of bird sightings) what's been reported inside the map's
current view, and pins a card on the map for each species found.

- on the card you can set which birds to show (all or rare) and from when
  (today, this week, or this month)
- each species found becomes its own bird card, pinned to the map where it
  was seen; hovering a name in the card's list lights up its pin
- needs the [Schema Matcher](../schema-matcher) card to find the map
- when you pan or zoom the map, it waits half a second for the map to
  settle, then searches the new area and replaces the pins
```
