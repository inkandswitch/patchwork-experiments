# Routes

A card that adds `/Drive`, `/Walk`, and `/Transit`
[commands](automerge:2hQnZDS6iDYoANsjEDsRsm7HF3Po): type
`/Drive berlin to munich` in a note and it drops in a trip between two
[places](automerge:r1gkpehGtt4WTR1pz7mBac9SnJp) already nearby or freshly looked
up. Routing comes from a switchable backend (Valhalla or OSRM); on OSRM, which
only offers driving, walk and transit fall back to a car route.

Each route is a small card of its own:

- its two endpoints (links to their
  [places](automerge:r1gkpehGtt4WTR1pz7mBac9SnJp), not copies)
- the distance and travel time
- the path itself, which the [map](automerge:4Mrgb9EZpScpUgUo2dZ2wQCJKkEn) draws
  as a line
