# scene: the idea

An overview for someone new. [STAGE.md](STAGE.md) is the exact contract;
[README.md](README.md) is the tool for a person using it.

## A stage, a view, and extensions

A scene is an Automerge document of objects, their transforms and
attachments, and **traits**: small records on an object or on the scene that
say what it is or does (`tabletop.card`, `sailing.ship`, `scene.carry`).

The core has two parts. A **stage** belongs to a doc, one per open doc. It
derives a snapshot, loads and builds each object's content, runs the
extensions the doc calls for, keeps presence and claims on the doc's
channel, and keeps the doc's clock. The **view** belongs to the viewer, one
per mounted tool. It renders, picks, routes input, holds the body stack and
the held tool, the selection and the focus, and the drawer. Neither has UI:
no toolbar, no sidebar, no modes, no verbs.

## Traits activate code

What runs is a function of the registry and the doc. An extension runs where
the doc has one of its traits, on an object or the scene; one with no traits
is general. Nothing a viewer holds or does changes what runs, so a sailing
sim doesn't stop because someone is editing her.

## Contributions and surfaces

Everything else is a **contribution** from an extension any package may
register: verbs on a target, input, bodies, tools, widgets drawn in the
stage's layers, lenses (how something looks to this viewer), policies (who
may see what it is), and processes (what moves in world time).

A **surface** presents other extensions' contributions. The toolbar, the
menu, the use prompt, the inspector and the key map are surfaces. The
extension that owns a verb doesn't know which surfaces exist.

**What isn't contributed doesn't exist.** A card table has no outline because
nothing there contributes one. It isn't hidden.

**Docs carry no code.** They name traits and providers, and list the
packages those come from. A viewer who lacks one is offered it on a click.

**Nothing in the stage knows a domain**: not a card, a ship or a door.
Packages meet through conventions (`roster`, `keeper`), never imports.

## Scenes made of scenes

A scene doc is a world. A **link** places one world inside another: an
ordinary object whose content is a scene doc. To the host it is content with
a box, surfaces and a frame. To itself it is a whole world with its own
stage, drawn in the link's frame. A game on a ship's table never knows it is
on a ship, and the ship never reads into the game.

An extension sees one doc, its stage's. Docs compose through space and
frames only (rays, hits, rides, the input path), never by reference.

A link is live, a **pin** (a doc at fixed heads, with everything it
reaches), or closed (a cycle, the same live doc placed again in one view, or
a doc that can't open). Pins can't write any doc. **Enter** moves the viewer's focus into a link to edit it in place, the
world around still live; **Leave** comes back out. **Extract** and
**Bundle** are one copy rule in two directions: a selection out into its own
linked doc, or a linked doc back in.

## Whose input is it: nearness

Two rules decide whose a press is. **Scope is where a trait sits:** an
object's trait covers that object and what is attached to it or filed in it;
a scene trait covers the doc. **Nearer goes first:** the hit chain is the hit
object, what it is attached to, its groups, then the doc's root. Each
extension is offered the event once, at its nearest holder.

So a card on a table aboard a boat goes to the tabletop, then the boat's
sailing, then the scene. A hit inside a linked doc walks the linked doc's
chain first, then the host's from the link outward. There is no priority to
declare: a global ranking would need every new package to fit into it.

The whole chain: the held tool, the widget under the pointer, the holders,
the general extensions, the top body, and last an unclaimed drag orbits.
(Edit takes a plain click ahead of the holders, to select.) Keys have no
position: the open gesture, the held tool and the body take theirs first,
then the key map over **attention**, the selection or else what you look
at. A key a surface shows is resolved by the function that runs it.

## Bodies and the held tool

A **body** is where a viewer is and how they move and look. The stage owns
Look and Edit, both the orbit camera. Packages add the rest: walk, a seat,
a ship's station. Bodies stack: sitting down from walking pushes a seat. The
top body's eye and reach measure every verb ("too far" is computed once).

**Editing is a body.** In Edit a click selects, and the halo, inspector,
grid and editor commands appear; in any other body none of it shows.
Entering another body leaves Edit.

The **held tool** is one slot per view: empty, or one tool that takes every
press first (measure, a gun, a piece drawn from a bag). Playing is the empty
hand. Carrying needs no tool and no body: it is a trait.

## Three places for state

- **The doc:** shared and kept. Objects, traits, claims (who has the helm).
- **Presence:** shared and passing. Selections, carries, avatars, a moving
  ship's pose. The doc is written where things come to rest.
- **Local:** this view only. The selection, the held tool, prefs, the camera.

## Time

Each doc has a **clock**: world time. One view holds the doc's clock claim
and steps every registered process; the others follow, and take over if it
goes. Anyone who may write can pause it. Nobody present, no time passes.
Acts like a die's tumble finish during a pause. A linked doc has its own.

## The test

The model is general only if each example is built purely from
contributions, none of them the default: card games, a sloop under sail, a
Doom level, arcade machines, CAD assemblies. Each is its own package; the
stage knows none of them.
