# Embeddings Map — Setup

## Pipeline

```
Patchwork folder
  └─ recursive doc collection
       └─ text serialization  (JSONPath rule + fallback)
            └─ nomic-embed-text-v1.5
                 └─ PCA → 50 dims
                      └─ UMAP → 2D
                           └─ DBSCAN clustering
                                └─ c-TF-IDF + embedding similarity → cluster labels
```

## Model

**`nomic-ai/nomic-embed-text-v1.5`**

- Device: WebGPU (`fp32`) with fallback to WASM (`q8`)
- Context window: 8192 tokens (WebGPU) / 2048 tokens (WASM — docs are truncated with a warning)
- First load: ~550 MB (fp32/WebGPU) or ~137 MB (q8/WASM)
- Embeddings are cached in IndexedDB keyed by document URL + content hash

## Filtering

Type-based filtering with individual per-doc overrides. By default only `essay` type is included. Both type filters and individual overrides are persisted in `localStorage`.

## Extraction rules (UI)

In the table view, click **Extraction Rules** to set a JSONPath expression per doc type.  
Example: `$.content` for essay docs, `$.store.*.props.text` for tldraw.  
Rules are stored in `localStorage` and reused across sessions.  
If a rule fails or returns nothing, the tool falls back to extracting all string leaf values from the JSON.

## Interactive features

### Similar docs

Click a point to select it. The bottom panel shows the top 5 most similar documents (cosine similarity in 768-dim space). Highlighted docs get a colored halo ring on the map. Click any similar doc to jump to it, or use the Open button.

### Semantic search

Type a phrase in the search bar in the header. After a 500ms debounce, the query is embedded using the `search_query:` task prefix (cross-task compatible with the corpus's `clustering:` embeddings) and projected into 2D via the saved PCA + UMAP model. A yellow-bordered pin appears at the query's position, and the top 5 nearest corpus docs are listed in a panel.

### Watched docs

Select a doc and click "Watch" to add it to the watched set. Watched docs subscribe to Automerge handle change events. When content changes, the doc is re-serialized, re-embedded, and repositioned using `projector.transformPoint()` (same PCA + UMAP transform used by semantic search). The point animates smoothly to its new position via a requestAnimationFrame loop with cubic ease-out. Watched points have a green border.

Watched docs also dynamically reassign to the nearest cluster (by HD cosine similarity to cluster centroids). The point's color and cluster label in the selection panel update to reflect the new assignment.
