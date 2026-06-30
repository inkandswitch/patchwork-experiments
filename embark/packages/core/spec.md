# Core

The shared foundation every other package builds on. It isn't a card you place;
it's the shared code that lets the separate cards work together without knowing
about each other.

It provides:

- the shared state cards read and write to coordinate — searches, commands,
  geographic matches, highlights, and stickers
- the matching that answers "where, around here, is something shaped like this?"
- common helpers for resolving places, rendering embeds, and scanning text for
  stickers

The [canvas](automerge:2inNEjqtyHgqxUHAphpoiHvaM2s6) hosts this shared state;
everything else is a reader or writer of it.
