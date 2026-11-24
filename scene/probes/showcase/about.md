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

Drag any object from the outline onto another document's body or import slot
to use its geometry there.
