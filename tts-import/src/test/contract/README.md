A copy of tabletop/contract/v1's `schema.json` and `validate.js` (the
tabletop-game format, tabletop/GAME-FORMAT.md), for this package's tests:
packages never import each other, so every game an import makes is checked
against a copy. Copy both again, whole, when the format changes.

`tts-tiny-mod.json` goes the other way: it is what this package translates
its tiny fixture mod (`fixtures/tiny-mod`) into, and tabletop keeps the same
file as `contract/v1/fixtures/valid/tts-tiny-mod.json`, where its tests lay
it out and play it. `src/importer.test.js` checks the translation still is
this file; when the translation changes on purpose, write the new game here
and copy it to tabletop's fixture, whole.
