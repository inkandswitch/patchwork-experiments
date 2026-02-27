# Geolog

## Quick Example

```
theory WeightedGraph {
    V : Sort;
    E : [src: V, tgt: V, weight: Int] -> Prop;
    
    // Each edge has at most one weight
    ax/unique_weight : forall v1 : V, v2 : V.
        [src: v1, tgt: v2, weight: n1] E /\ [src: v1, tgt: v2, weight: n2] E
        |- n1 = n2;
}
```

## Documentation

> [!NOTE] 
> All of the text in these documents was written by an LLM, don't take it 
> very seriously. Think of it more as a sort of exhaust produced by the 
> development process than as a carefully crafted technical document.

- [Schema Language](docs/schema_lang.md) - Syntax reference for the schema language
- [Database Evaluation](docs/evaluation.md) - How the database enforces axioms
- [Weighted Graph Example](docs/SIMPLE_GRAPH.md) - A worked example
- [RFC: Incremental Evaluation](rfcs/0001-incremental-evaluation.md) - Design for efficient axiom checking

## License

MIT
