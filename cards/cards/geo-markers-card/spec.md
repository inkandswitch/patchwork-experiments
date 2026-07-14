# Geo Markers card

Publishes a map marker for every place the canvas knows about. Drop this card
onto a canvas and every `{lat, lon}` pair in the open documents becomes a
marker geo shape; remove it and they disappear.

- queries the shared LATLNG schema through `SchemaMatches` (the declared key
  interest is the query, answered by the schema matcher card)
- resolves each match to its coordinates and publishes
  `{ type: "marker", at, target }` shapes into its slice of the `geo:shapes`
  channel, grouped under the owning document
- pure source: does no drawing — pair it with the
  [geo-shapes card](../geo-shapes-card) to see the markers on a map
