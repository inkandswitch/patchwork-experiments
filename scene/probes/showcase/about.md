# Geometry showcase

Every object here is a different kind of document, rendered into this scene by
the package that owns it. Nothing is a copy: edit a source and the scene
follows, and so does anything built from it.

**Twisted strands** — an *Implicit Surface*: a signed-distance program,
meshed with surface nets. Its render params (resolution, finish) are in the
inspector; finish and smoothing re-use the cached mesh.

**Plinth** — an *OpenSCAD* part that imports the sculpture document as data
and sizes itself from the sculpture's `bounds`. Open the sculpture, change its
bounds, and the plinth rebuilds to fit.

**Twisted tower** — another implicit surface: a rounded square, twisted and
shelled.

**Hull in a flow** — an implicit hull, and a *Flow field* whose body is the
hull's **render** in this scene: the flow slices the very mesh you see, so a
change to the hull rebuilds the hull, then the streamlines and the pressure
slice. Both are attached to the hull and move with it.

**Camber hull** — a *Camber* hull design (camber's own default boat, 5 m),
rendered at 1.6 m by its provider's "scale to length", with its stations and
design waterline drawn as lines. It has a flow field of its own, linked to its
render: the flow slices the scaled mesh you see, so it lines up at any scale.
Open the hull in Camber, change the sheer or the transom, and the hull, its
streamlines and its pressure slice all rebuild.

Drag any object from the outline onto a slicer or a flow field's body slot to
use its geometry there.
