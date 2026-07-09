# Geo Lines card

Publishes a map line for every route the canvas knows about. Drop this card
onto a canvas and every ordered list of `{lat, lon}` places in the open
documents becomes a line geo shape; remove it and they disappear.

- queries the shared LATLNG-line schema through `SchemaMatches` (the declared
  key interest is the query, answered by the schema matcher card)
- resolves each match to its point list and publishes
  `{ type: "line", points, target }` shapes into its slice of the `geo:shapes`
  channel, grouped under the owning document
- a multi-line / polygon arrives as several matches (one per ring); each is
  just another line
- pure source: does no drawing — pair it with the
  [geo-shapes card](../geo-shapes-card) to see the lines on a map
