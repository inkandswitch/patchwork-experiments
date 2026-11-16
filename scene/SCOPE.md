# Scope: whose a press is

The model in [STAGE.md](STAGE.md) ("Activation", "The input chain", "Views,
stages and links") told from one question: when someone points at
something, which extension is it for, and in whose frame? The answer is
two rules, **scope is where a trait sits** and **nearer goes first**, and
what follows from them. [COMPOSITION.md](COMPOSITION.md) holds the reasons
for how this crosses links, and [TOOLS.md](TOOLS.md) for bodies, the held
tool and attention.

The case that tests it: a card on the saloon table of a sloop sailing
through an arena level, its game a linked doc of its own.

```
card (tabletop.card) → table → [game root: seats]  ┊  link → saloon table → sole → hull (sailing.ship) → [groups] → scene (sailing.weather, arena.level)
```

## 1. Scope is where a trait sits

A trait key means the same thing on the scene or on any object. Where it
sits is its scope: an object's trait covers that object and what is
attached to it (and, on a group, what is filed in it); a scene trait covers
the doc. One extension may hold many places at once (two tables in one
room each carry their traits), with one instance per extension per stage:
an instance handles every holder, so a card carried from one table to
another stays one extension's business, and shared resources (a deck's
resolver) aren't duplicated.

An extension's reason to run gives its summary scope (`local.running`):

| Scope | Reason | Offered input at |
|---|---|---|
| `scene` | a scene trait | the chain's holders, at its nearest holder (the scene unless one of its objects is nearer) |
| `objects` | only object traits | the chain's holders, only when the hit chain reaches one of its objects |
| `general` | no traits at all | after every holder, in the focus stage only |

Input reads no label but `general`: the holders' order comes from where the
traits are.

## 2. Nearer goes first

The **hit chain** is the hit object, then what it is attached to (nearest
first), then its groups (nearest first), and last the doc's root. Each
extension is offered an event once, at its **holder**: the nearest member
of the chain carrying one of its traits (`ev.holder`, `null` for the
root). Holders go nearest first; running order breaks ties only between
extensions holding the same member. So the card goes to the tabletop, a
press on the tiller to sailing, a press on a bare wall to the arena, and
nobody has to know about anybody else. There is no priority to declare:
a global ranking would need every new package to fit into it.

`holdersFor` and `chainOrder` (`src/stage/chain.js`, pure) are the whole of
it. The tests check the order against the literal walk over every
placement of three extensions on chains of up to three objects plus the
scene, in every running order.

## 3. Two extensions on one holder

A crate on the foredeck with `arena.target` is the arena's (its own trait),
sailing's (through her hull) and the arena's again (the scene's level), and
the arena is offered it once, at the crate. Where two extensions hold the
same member, running order decides, and an extension claims only presses
it is sure of. Input is local, so two peers ordering the same pair
differently diverge in nothing that is written.

## 4. What lives on an object, and what on the scene

**Anything that belongs to a thing lives on that object, in its frame.**
Scene traits are for what is about the whole doc: rules of the world,
catalogues, scoreboards, a table's seats when the doc is the game.

| Trait | Where | Frame |
|---|---|---|
| `seats` | the game doc's scene trait: a doc seats one table; a second game is a second doc, linked | a seat's camera in the doc's root frame, or `in` one of its objects; aboard, the root is the table the game is linked onto |
| `tabletop.zone` | the object (a tray, a pile) | a box in its object's frame |
| face up | implied by a card's pose | +Y in the frame the card lies in (its parent's), so cards on a heeling boat don't flip |
| `arena.level` | the scene: a catalogue, not a place | |
| `walk.spawn`, `arena.target` | objects | attach them to the boat and they sail |
| `scene.carry` | each thing that can be picked up | carried in its doc parent's frame, as drawn |

There is no tool to default per scope or per view: the empty hand is the
default everywhere, and what a press does follows from the chain. A card
carries because it has `scene.carry`; a press on a station is sailing's; an
unclaimed click selects in Edit and does nothing in Look, walking or
seated. A doc's walls, a hull and her fittings lack `scene.carry`, so a
drag on them never carries them. `carryable(id)` is a veto for passing
states only (a die under a cup).

## 5. Scopes move

The boat moves as one, and everything aboard moves with her because it is
attached: world = parent's world · local. Seats, zones, stations and spawns
are in their object's frame, so they come along. Groups give scope but not
motion (a group has no transform). **Being aboard means being attached,
directly or not**, or being in a doc linked onto something attached.

- **Motion is a pose, not doc writes.** The view computing the doc's clock
  holds the hull's pose and streams it; the doc keeps where she is and is
  written at checkpoints.
- **Readers see what is drawn.** `worldOf` and rays are the displayed pose,
  so the carry and the halo work in the frame of the object's doc parent as
  drawn this frame, and a card on a sailing hull doesn't jump.
- **The camera rides.** A base ride (`camera.ride`: a ship keeping herself
  in view) or the top body's own ride, which wins; a ride may `tilt`, so a
  seat at a table aboard rolls with the table.
- **People stand on things.** The walk body rides what it stands on;
  sailing's aboard body walks her deck on a navmesh in her frame.
- **Landing doesn't attach.** A carried thing keeps its doc parent, and a
  piece set down outside its doc stays in its doc.

## 6. Keys, attention, menus, hover

Keys have no hit, so scope doesn't pick who gets them. One key order: a
focused field, the open gesture's declared keys (a carry's Q/E/F), the held
tool's, the top body's, then the key map over **attention** (the selection
if any, else the look: the pointer's hit, or the eye ray under pointer
lock), walking attention's chain nearest first and then the scene. A key a
surface shows is resolved by the same function that runs it.

- **Menus** show every command that applies to what was right-clicked, a
  section per doc on its path, innermost first.
- **Hover** is one path, each stage seeing its element.
- **Where a person is**, as opposed to where the pointer is, is the body.
  Standing at the tiller pushes sailing's station body over aboard; getting
  up pops it. The top body is offered presses after the chain, so a
  station's holder gets a press before a walker would.

## 7. Across links

Each stage is its own scope, and nothing is taught across a link.

- **A segment per doc.** A hit inside a linked doc goes through the linked
  doc's holders out to its root, then the host's from the link out to its
  root, and on to the outermost. The card above goes to the tabletop, the
  game's seats, then sailing (at the link's chain: sole, hull) and the
  host's scene traits.
- **General parts are the focus stage's**, offered after every segment
  wherever the hit is. What draws a doc's people (walk's avatars, others'
  selection boxes) is no general part's: it is a part of every doc
  (`traits: ["*"]`), which runs in every stage as that doc's own, held by
  its scene, in that stage's frame (COMPOSITION.md §3, "Presence where it
  is"). The key map, the use prompt and the menu walk the
  input path a doc at a time, each doc's commands in its own context.
- **Drawn stages have no segment.** A press on a mirrored card or a pinned
  fit-out reaches the host as the link.
- **Frames go through one choke point** (`src/stage/scope.js`): everything
  spatial an extension sees is in its stage's root frame.

## 8. Local interaction

Walking up to something on a moving ship and using it, with everyone aboard
seeing it, is built from general pieces, none of them a ship feature:

- **Stations are objects with traits** (`sailing.helm`, `sailing.winch`),
  so their extensions hear events aimed at them; in first person the event's
  ray is the crosshair.
- **Taking a station pushes a body** that takes its keys (the helm's
  steering) and perhaps the camera; Escape doesn't pop it, Leave does.
- **Claims, in the doc.** One player at the helm, one view computing the
  clock: a claim is a field on the claimed object, settled by Automerge when
  two take it at once, counting only while its holder is present
  (STAGE.md, "Claims"). Motion stays in presence.
- **The use prompt** (`scene.use`) shows attention's keyed verbs, with
  `reach` measured from the body's eye against its reach on every surface.
  **Held verbs** (winding a winch, say) last while the key is down, and pin
  attention to their target.

## 9. Not built

- `api.holders()` and `api.holderOf(id)`: a command that needs to know which
  of its holders a target is under walks the snapshot itself.
- Menu sections by holder within one doc (they are by doc).
- One shared part drawing people from presence: the walk package and
  sailing each draw their own.
- Ephemeral effects as sends simulated locally (cannonballs, spray), and
  positional sound. (Water height crosses docs now, as the world's ambient
  water: water/WATER.md.)
