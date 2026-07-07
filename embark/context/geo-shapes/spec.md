# Geo shapes

The map analog of [stickers](../stickers): a plain-JSON `geo:shapes` channel
where cards publish shapes for the map, and one renderer that draws the union.

- shapes are grouped under the *document* they stand for (the channel key);
  each shape carries a `target` sub-url naming the exact node it was derived
  from — its stable identity
- two kinds: `marker` (`{lat, lon}`) and `line` (an ordered point list); both
  may carry a `color`
- `geoShapeRenderer()` is a `MapExtension` (see
  [map-extensions-host](../map-extensions-host)) published by the
  [geo-shapes card](../../cards/geo-shapes-card): it reconciles markers and a
  GeoJSON line layer against the channel, lights shapes up while their document
  is focused (selection ∪ highlight), writes hovered shapes' documents into
  `Highlight`, and pops up a `<patchwork-view>` of a hovered pin's document
- cross-shape policy lives in the renderer, which sees the whole union: a
  marker on an interior vertex of a published line (target `…/@i`) is
  suppressed, so lines show pins only at their ends
- sources ([geo-markers](../../cards/geo-markers-card),
  [geo-lines](../../cards/geo-lines-card), or any future card) resolve
  coordinates themselves and publish resolved, renderable JSON
