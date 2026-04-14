---
name: environment
description: Explore the ref-view tree — find parent elements, read their data, and discover available schemas.
---

# Exploring the environment

The `element` binding is a `ref-view` node in a tree. You can navigate this tree using schemas and the ref-view API — no raw DOM queries needed.

## Importing a schema

Navigation methods require a schema object. Import one from a tool folder:

```js
const { default: surfaceSchema } = await filesystem.import('surface/schema.js');
```

## Walking up the tree

`findParent(schema)` returns the nearest **ancestor** ref-view that matches the schema (skips self). `findClosest(schema)` is the same but includes self.

```js
const { default: surfaceSchema } = await filesystem.import('surface/schema.js');
const surface = element.findParent(surfaceSchema);
if (surface) {
  console.log('Surface data:', JSON.stringify(surface.ref.value(), null, 2));
} else {
  console.log('No surface ancestor found');
}
```

## Checking and reading data

`has(schema)` checks whether an element owns data for a schema. `ref.value()` returns a snapshot.

```js
const { default: surfaceSchema } = await filesystem.import('surface/schema.js');
if (element.has(surfaceSchema)) {
  const doc = element.ref.value();
  console.log('Shapes:', Object.keys(doc.shapes || {}));
}
```

## Finding all matching elements

`findAll(schema)` returns every ref-view in the tree that matches a schema.

```js
const { default: surfaceSchema } = await filesystem.import('surface/schema.js');
const surfaces = element.findAll(surfaceSchema);
console.log(`Found ${surfaces.length} surface(s)`);
for (const s of surfaces) {
  const doc = s.ref.value();
  console.log('  shapes:', Object.keys(doc.shapes || {}));
}
```

## Discovering available tool schemas

List tool folders and import their schemas to see what types of data exist in the tree:

```js
const entries = await filesystem.listEntries('');
const folders = entries.filter(e => e.type === 'folder').map(e => e.name);
console.log('Tool folders:', folders);
```
