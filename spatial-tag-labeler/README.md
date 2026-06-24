# Spatial Tag Labeler

A tiny **demo embedded tool** for the [`spatial-patchwork-host`](../spatial-patchwork-host).
It knows nothing about cameras, projectors, or homographies — it subscribes to the
host's providers and drops an editable label on each detected AprilTag.

This is the worked example showing the spatial host replaces `apriltag-projector`'s
bespoke "use" mode: the host does all the spatial work; this tool only consumes
`spatial:apriltags`.

## How it works

- Inlines the small dependency-free `subscribe` helper from
  `@inkandswitch/patchwork-providers` (so it stays a bundleless single-file tool).
- `subscribe(element, { type: "spatial:apriltags" }, ({ tags }) => …)` — renders a
  label per tag at `left: nx*100%; top: ny*100%` (optionally rotated by `angle`).
  Positions are normalized 0..1 within the embedded box, so placement is pure CSS
  percentages — it doesn't even need the coordinate-system provider.
- `subscribe(element, { type: "spatial:coordinate-system" }, …)` — only used here
  to show the box size in a readout.
- Per-tag custom names persist in the doc's `labels` map (`{ "7": "Coffee" }`).

If opened outside a spatial host (no provider answers), the subscriptions simply
never fire and the tool shows nothing — it degrades cleanly.

## Usage

1. `pushwork sync` (bundleless — no build) and register the module.
2. In a **Spatial Host** doc, **Use** mode → **Add doc…** → `spatial-tag-labeler`.
3. Set it active and calibrate the host. Tags placed in the camera area get a
   projected label tracking each tag live.

## Data model

```js
{ title: "Spatial Tag Labeler", labels: { /* tagId -> custom name */ } }
```
