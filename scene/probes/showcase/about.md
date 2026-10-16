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

Drag any object from the outline onto a slicer or a flow field's body slot to
use its geometry there.
