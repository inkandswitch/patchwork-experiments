# sailing

A sea you can crew a ship on together, as a kind of scene: open water with
wind and waves, a 12 m sloop that floats and sails by the forces on it, and
first-person play where everyone in the scene walks her deck, takes the
helm, trims the sail, works the windlass, falls overboard and climbs back up
the ladder. One view simulates; everyone else sees the same ship, played
back smoothly, and takes over if that view goes.

It is two scene extensions, two templates and parts for the scene tool (see
[../scene/STAGE.md](../scene/STAGE.md)), not a tool of its own. How it's
built, and the conventions its modules share, are in [DESIGN.md](DESIGN.md).

## A ship at sea

- **From the template.** In an empty scene, pick **Ship at sea** on the start
  screen. It lays out a sloop under way on a beam reach (sail up, anchor
  up), a sea with a north-easterly breeze, two buoys and an islet upwind,
  and opens in Play. Or **Ship at anchor**: the same sloop lying head to
  wind at anchor off the islet in a moderate breeze, sail down, anchor down,
  somewhere still to set things up aboard (a card table in her cockpit:
  tabletop's *Card table* and *Lost Cities* parts) and to get under way
  from (raise the sail, weigh the anchor).
- **Coming aboard.** Click the sea, the sky, the ship, a fitting of hers or
  the shore (or press Enter). A click on something else aboard her, a card
  on a table in her cockpit say, isn't a way aboard: it's that thing's (the
  hand picks the card up). Seated at a table aboard her (your view riding
  it), only Enter, the button or a click on the open sea or sky comes
  aboard, so a stray click on the benches round the table doesn't throw you
  into first person; the HUD then offers *Come aboard (Enter)* top left,
  without the walking keys (S and D are the table's Shuffle and Draw), and
  before you're aboard its panel is just the dial, top left, clear of your
  hand of cards. In play the hand never carries the ship or her fittings
  (anything with a sailing trait or tag: `carryable`), so a game aboard her
  can't dismast her; a table and its cards are the game's to move.
- **From the parts bin, in any scene.** While editing, the sidebar's parts
  list a *Sailing* group: drag **Sloop** onto the view and she's on the
  water where you dropped her, rigged, her bow away from you (and the scene
  gets a sea if it had none). The rest are her parts on their own: **Mast
  and sail**, **Wheel**, **Windlass and anchor**, **Ladder**, to drag onto
  a hull; **Red buoy**, **Green buoy** and **Islet** to sail past. Dropped on
  a hull that's a ship, a part lines up with her bow and attaches under her
  (on the sloop, each snaps to its place); a click instead of a drag puts it
  where you're looking.
- **By hand, in any scene.** With the inspector's *Add behaviour…*:
  - **Sea** on the scene (wind speed and direction, a seed, wave height);
  - **Ship** on the hull object (its size and weight come from the
    `extras.ship` its GLB declares, else its box; *Bow points* or the frame
    say which way is forward when the model doesn't; the spec field
    overrides);
  - attached under the hull: **Helm** on the wheel, **Sail** on the
    boom-and-sail (its `Sail` node is lowered and bellied in play),
    **Anchor** on the windlass, **Anchor (the hook)** on the anchor itself,
    **Ladder** on the ladder;
  - **Float** on anything that should bob where it's moored.

  A ship sails only at the scene's root, and only on a scene with a sea.

## Sailing a hull from another tool

A hull drawn elsewhere (camber's, or any model) sails once she has a rig:

1. Drop the hull's document into a scene, as any model. Build her at her
   length (camber: *Scale to length*), or scale the object up to it: she
   sails in metres either way. The parts are drawn for the 12 m sloop (the
   mast's stays, the wheel), so they suit a hull of about that size.
2. Give it **Ship** (*Add behaviour…*). If her model says where her bow
   points and where her middle is on her waterline (camber's does:
   `extras.ship.forward` and `origin`), that's all; else set *Ship frame*:
   `{ "rotation": [0, -1.5708, 0] }` turns a model whose bow is +X, and a
   `position` says where her middle is on her waterline. Her waterline is
   her model's y = 0.
3. Drag **Mast and sail**, **Wheel**, **Windlass and anchor** and
   **Ladder** from the parts onto her deck (locked or not), and place them
   with the gizmo. Each squares itself to her bow.
4. Give the scene a sea if it hasn't one (the sloop part brings one; else
   **Sea** on the scene), and play.

Where you put the mast is where the sail pulls: forward and she bears away,
aft and she rounds up. Her weight is her model's stated displacement, else
the sloop's scaled to her size.

A rig built by the **Rig** tool (the `rig/` package) carries its design as
`extras.rig`. Put on her as her sail station, it states her frame, her
waterline, weight, centre of gravity, keel, rudder and sail for her, in
place of her model's guesses; a rig designed on a different hull says so
in the console. Her keel and rudder are the ones it drew, her weight sits
where it put it, and a dinghy's crew hike to windward. She floats on her
own hull (her drawn model, when the rig was designed on it), meets the
water's resistance the rig worked out for her, and a dinghy that can plane
climbs onto the plane past her hull speed. She flies its main and jib, each
its own sail where the rig drew it, a reef lowering the main's head; the
physics can back the jib to get her out of irons, though no station
works the jib yet (for now it's trimmed with the main; DESIGN.md, "The rig
contract").

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
node probes/camber-run.mjs    # a camber hull rigged from the parts bin and sailed (build ~/dev/camber/patchwork too)
node probes/aboard-run.mjs    # Lost Cities at a table in her cockpit, two players, at anchor and under way (build scene/, tabletop/, card-table/ too)
node probes/publish-aboard.mjs --dry-run   # make that scene with the tools and check it; without --dry-run, publish it
```
