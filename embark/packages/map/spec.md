# Map

A map that shows everything geographic around it: it drops a pin on every
[place](automerge:r1gkpehGtt4WTR1pz7mBac9SnJp) nearby and draws a line for every
[route](automerge:41HBbYkbrqYd9STaojjQUsFc1jDW) nearby, then frames them in view.
Tiles come from openfreemap.

- pins and lines update live as places and routes come and go
- hovering a pin or line highlights the matching card, and the reverse
- where you've panned and zoomed is remembered; framing markers is temporary

It also carries a built-in search box, like a traditional maps app, with two
tabs. **Places** geocodes free text (Nominatim) and drops ephemeral pins.
**Routes** resolves a start and destination and draws a route between them
(Valhalla), for Drive / Walk / Bike / Transit, with distance and time. These
results live only on the map and clear on the next search — nothing is written
to the canvas — and they share no code with the routes card. While a search
result is on screen it holds the camera, pausing the automatic pin framing.
