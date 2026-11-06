# sailing

A sea you can crew a ship on together, as a kind of scene: open water with
wind and waves, a 12 m sloop that floats and sails by the forces on it, and
first-person play where everyone in the scene walks her deck, takes the
helm, trims the sail, works the windlass, falls overboard and climbs back up
the ladder. One view simulates; everyone else sees the same ship, played
back smoothly, and takes over if that view goes.

It is two scene extensions and a template for the scene tool (see
[../scene/STAGE.md](../scene/STAGE.md)), not a tool of its own. How it's
built, and the conventions its modules share, are in [DESIGN.md](DESIGN.md).

## A ship at sea

- **From the template.** In an empty scene, pick **Ship at sea** on the start
  screen. It lays out a sloop under way on a beam reach (sail up, anchor
  up), a sea with a north-easterly breeze, two buoys and an islet upwind,
  and opens in Play.
- **By hand, in any scene.** With the inspector's *Add behaviour…*:
  - **Sea** on the scene (wind speed and direction, a seed, wave height);
  - **Ship** on the hull object (its size comes from its box, or the
    `extras.ship` its GLB declares; the spec field overrides);
  - attached under the hull: **Helm** on the wheel, **Sail** on the
    boom-and-sail (its `Sail` node is lowered and bellied in play),
    **Anchor** on the windlass, **Anchor (the hook)** on the anchor itself,
    **Ladder** on the ladder;
  - **Float** on anything that should bob where it's moored.

  A ship sails only at the scene's root, and only on a scene with a sea.

## Controls

Click the view (or press Enter) to come aboard; Esc goes back to the view
off her quarter. Where pointer lock is refused, drag to look.

| Where | Keys |
|---|---|
| On deck | WASD walk · Shift run · Space jump · mouse look · F use what you look at |
| At the wheel (F) | A / D steer · Q / E haul in / ease out the sheet · F leave |
| At the mast or the boom | hold F raise or lower the sail · hold Q haul in · hold E ease out |
| At the windlass | hold F raise the anchor (it says how much chain is out) · F drop it |
| In the water | WASD swim · F at the ladder to climb aboard |

The panel bottom left reads her speed over the ground, her heading, the
true wind (and on the dial, the apparent wind as an arrow and the true wind
as a hollow mark), the sail and the anchor. Head to wind with the sail up
she goes astern ("in irons"): lower the sail and let her fall off, then
raise it. That is slow (a minute or two: with one sail there's no jib to
back), so don't let her round up, and drop the anchor only where you mean
to stay.

## Working on it

```sh
pnpm install
pnpm test          # vitest: the physics, the sea, the parts on a fake stage
pnpm build
node probes/sailing-run.mjs   # two views crewing her in headless Chrome (build scene/ too)
```
