A copy of tabletop/contract/v1's `schema.json` and `validate.js` (the
tabletop-game format, tabletop/GAME-FORMAT.md), for this package's tests:
packages never import each other, so every game an import makes is checked
against a copy. Copy both again, whole, when the format changes.
