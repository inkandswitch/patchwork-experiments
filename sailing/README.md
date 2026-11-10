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
  and sail**, **Wheel**, **Mainsheet**, **Windlass and anchor**, **Ladder**,
  to drag onto a hull; **Red buoy**, **Green buoy** and **Islet** to sail past. Dropped on
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
    **Mainsheet** on whatever the sheet is worked at in the cockpit,
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
3. Drag **Mast and sail**, **Wheel**, **Mainsheet** (into her cockpit,
   under the boom's end), **Windlass and anchor** and **Ladder** from the
   parts onto her deck (locked or not), and place them
   with the gizmo. Each squares itself to her bow.
4. Give the scene a sea if it hasn't one (the sloop part brings one; else
   **Sea** on the scene), and play.

Where you put the mast is where the sail pulls: forward and she bears away,
aft and she rounds up. Her weight is her model's stated displacement, else
the sloop's scaled to her size.

A rig built by the **Rig** tool (in the `naval/` package) carries its design as
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
works a contract boat's own jib (for now it's trimmed with the main;
DESIGN.md, "The rig contract").

The stock sloop carries such a contract too, drawn from her own lines and
rig (DESIGN.md, "Trim feedback"): a "Mast and sail" filed as
`sailing/rig@2` on the stock hull sails her separate main and jib. A scene
made before keeps its `rig@1` and sails as it always did, and the stock rig
on any other hull (camber's) is the plain one: its contract describes the
stock hull only.

## Controls

Click the view (or press Enter) to come aboard; Esc goes back to the view
off her quarter. Where pointer lock is refused, drag to look.

| Where | Keys |
|---|---|
| On deck | WASD walk · Shift run · Space jump · mouse look · F use what you look at |
| At the wheel (F) | A / D steer · Q / E haul in / ease out the sheet · hold R raise or lower the sail · B back the jib to windward (head to wind: opposite the wheel, so her bow goes the way it's over; furled, it unrolls backed) / let it fly · F leave |
| At the mainsheet, aft in the cockpit just forward of the wheel (F) | Q / E haul in / ease out · hold R raise or lower the sail · F leave |
| At the mast (F) | hold R raise or lower the sail · F leave |
| At a jib winch, either side of the cockpit's forward end (F) | Q / E haul in / ease out the jib sheet (from the winch on the jib's side; the other is the lazy sheet) · B make the jib fast on this side / let it fly · hold R furl or unfurl the jib · F leave |
| Looking at a jib winch | hold Q haul in · hold E ease out (the working winch only) |
| Looking at the mainsheet | hold Q haul in · hold E ease out |
| Looking at the mast or the boom | hold R raise or lower the sail |
| At the windlass | hold F raise the anchor (it says how much chain is out) · F drop it |
| In the water | WASD swim · F at the ladder to climb aboard |

The sheet and the halyard are led aft: the wheel and the mainsheet work
both, so a helmsman can sail her alone. The mast is no place to trim from:
only a ship with neither a wheel nor a mainsheet trims there (and from the
boom). Within reach means within 2.5 m of the point you look at, so the boom
over the cockpit is in reach though the mast isn't. A station further off
(up to 12 m) still answers, greyed, with where to go: *Sail · walk to the
cockpit*; or, standing in the cockpit already, which station to take: *Sail
· work it at the wheel or the mainsheet (F)*. Hold R raises the sail without
taking a station only at the mast (or looking at the boom); at the wheel and
the mainsheet, take the station with F first. Walking her deck, the hint line names her stations and what each
works; with her sail down and her anchor up, it says where to raise it.

The jib tends itself (it crosses when she tacks) until someone makes it
fast on one side (B): held on the windward side it is backed, and pushes
her bow away from the wind; tack with it held and it stays put, so she
heaves to. Two people can't trim one sheet: whoever's key is down on the
jib holds it, and someone else's key does nothing meanwhile.

The panel bottom left reads her speed over the ground, her heading, the
true wind (and on the dial, the apparent wind as an arrow and the true wind
as a hollow mark), her sails and the anchor. On the stock sloop (her rig
carries its contract) that is a row per sail, coloured by how it's
trimmed: *Main drawing · sheet 40%*, *Jib soft · sheet 60%*, *luffing*,
*stalled*, *eased out · stalled*, *backed · port*, *unrolling · backed
starboard*, *wing*, *reefed 30%*, *furled 40%*; a rig without a contract
shows one *Sail* row.

**Reading the sails.** Each sail is in one of four bands, the same on the
cloth, the telltales and the panel:

- *luffing* (amber): eased too far. The front of the sail bubbles back to
  windward, and the windward telltales on the jib's luff stand up and
  spin. Eased right past the wind, the whole sail flogs and its sheet hangs
  in a curve.
- *soft* (pale green): nearly there. The sail is full but the windward
  telltales are lifting. Trim in a little.
- *drawing* (green): right. Both of the jib's telltales stream straight
  aft, the main's leech telltales stream off its battens, and the sheets
  are straight lines.
- *stalled* (red): trimmed too hard. The leeward telltales curl forward,
  the main's leech ones curl round behind it, and the leech closes. Ease.
  *eased out · stalled* (plain) means the sheet is already all the way
  out: bear away or head up, the sheet can't help.

To trim, ease until the windward telltales lift, then trim in until they
stream. The masthead arrow shows the apparent wind; turn on the burgee
(`sailing.ship.burgee`) to see the true wind as well.

**Working the jib.** Walk to either jib winch at the forward end of the
cockpit and press F. You stand on the side deck across the well from it,
on the high side, looking up at the jib's luff, and you're locked in until F. Q trims the
sheet in, E eases it. Only the winch on the jib's side works the sheet; at
the other one the hint says where the jib is. B makes the jib fast on this
winch's side, which backs it if that's to windward, and B again lets it
fly. Hold R to furl or unfurl it. One person trims the jib at a time: while
someone holds it, your keys do nothing and the hint says so. At the wheel,
tacking takes the jib across with her unless it's made fast. B there backs
it to windward (unrolling it first if it's rolled up) to swing her bow off
the wind.

Leaving the anchor (or stopped head to wind, or in irons, going astern),
her rudder hardly bites. Do what a crew does: raise the main while she's
anchored (she lies head to wind), weigh, take the wheel and press B. The
jib (unrolled first, if it was rolled away at anchor) is backed to
windward and pushes her bow away from the wind, off in under ten seconds
in the anchorage's breeze; press B again to let it fly and sail off. Dead
ahead, where either side would do, turn the wheel the way you want her bow
to go first and B backs it on the other side. The hint names the way she'll
go (*B back jib, bow to port*). Left alone she drifts astern and falls off
by herself, in about a minute; turn the wheel against her sternway and
it's quicker. On a one-sail rig, lower the sail and let her fall off, then
raise it, which is slow. Drop the anchor only where you mean to stay.

## Working on it

```sh
pnpm install
pnpm test          # the fast tier (~6 s): the physics, the sea, her navmesh (C1–C9), the walker's cases, the stations, the parts on a fake stage
pnpm test:slow     # the slow tier (~5 s alone, longer beside other work): *.slow.test.js
pnpm test:all      # both
pnpm build
node probes/sailing-run.mjs   # two views crewing her in headless Chrome (build scene/ too)
node probes/camber-run.mjs    # a camber hull rigged from the parts bin and sailed (build ~/dev/camber/patchwork too)
node probes/aboard-run.mjs    # Lost Cities at a table in her cockpit, two players, at anchor and under way (build scene/, tabletop/, card-table/ too)
node probes/publish-aboard.mjs --dry-run   # make that scene with the tools and check it; without --dry-run, publish it
node probes/ship-shots.mjs <dir> "quarter?trim=luff"   # her parts rendered; ?trim= dresses the sails with looks.js (beat, luff, stall, backed, reef, run)
```

Tests come in two tiers. `pnpm test` runs every `src/**/*.test.js` except
`*.slow.test.js`, and should stay well under a minute: run it, or just the
files you touched (`npx vitest run src/stations.test.js`), while you work.
`pnpm test:slow` (vitest.slow.config.ts) runs only the `*.slow.test.js`
files: the long physics settles (the polar, 45 s on a seeded sea), the full
agreement sweep over the rig contract fixtures, the stage cases that sail her
for many simulated seconds, the two-crew aboard case and the walker's random
property test. Run it once before you finish a change to the physics, the
simulator or the walker. A new test that sails her for more than a second or
so of wall time belongs in a `.slow.test.js` file; its shared setup goes in
`src/test/` (sim-stage.js, sail-runs.js, frame-hulls.js).
