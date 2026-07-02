# Make stickerable

A card that lets [stickers](automerge:2fygfMPPm6BdmtgRXbpQvVBbizRL) reach text
that isn't an automerge document — the rendered text of *other* cards on the
canvas.

It works as a bridge, not a sticker source of its own:

- it lists the datatypes currently on the canvas (found by schema-matching
  `@patchwork.type`) and lets you switch any of them on
- for each enabled datatype it watches the canvas for `patchwork-view`s showing
  that type, reacting to `patchwork:mounted` / `patchwork:unmounted`
- it copies each matching view's **visible text** (an `innerText`-style walk,
  skipping gutters/other chips) into a throwaway `markdown` document and
  announces that mirror, so the ordinary sources (schedule, unit, currency, …)
  scan it
- it keeps the mirror in step with the DOM with `updateText`, so automerge
  cursors — and therefore the stickers anchored to them — stay put across edits

When stickers land on a mirror it maps each range back to the live DOM via an
offset map captured during extraction and paints the result as a fixed overlay,
**without mutating the view**:

- only `before` and `after` slots are honored; any other slot renders after
- `style` stickers are skipped (an overlay can't recolor text it doesn't own)
- chips track their text by re-reading the range's screen position each frame, so
  they follow the view as the canvas pans

Known rough edge: the extracted text is whatever the view renders, so editor
chrome that isn't filtered (beyond gutters and existing sticker chips) can still
leak into the mirror and shift offsets.
