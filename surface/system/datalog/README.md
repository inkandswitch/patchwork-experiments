# Datalog

A Datalog tool for the surface system: a split-pane editor/viewer that parses, evaluates, and checks constraints on a Datalog program stored in the document.

## Files

| File           | Role                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `shape.js`     | Renders the Datalog viewer/editor as a canvas shape.                 |
| `button.js`    | Toolbar button for placing a new Datalog shape on the paper canvas.  |
| `datalog.js`   | Core engine: ohm.js grammar, parser, fixed-point evaluator, provenance tracking, constraint checker. |
| `defaults.js`  | Default program (power-grid example) with facts, rules, and constraints. |

## Data shape

The shape stores the following fields alongside the standard `x`, `y`, `toolUrl`, `width`, `height`:

```
{
  facts:       [{ pred: string, args: (string|number)[], comment?: string }],
  rules:       [{ head: { pred, args }, body: [{ pred, args }], comment?: string }],
  constraints: [{ body: [{ pred, args }], comment?: string }],
  draftText:   string   // serialized program text for the editor
}
```

## Evaluation

The evaluator runs a fixed-point loop over the rules, extending the fact database until no new facts are derived. It supports:

- Basic facts and rules with variables (uppercase) and wildcards (`_`)
- Built-in predicates: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`
- Arithmetic: `add`, `sub`, `mul`, `div` (3-arg, output in third position)
- Aggregation: `sum(AggVar, Pattern, OutVar)` groups by non-aggregate variables
- Constraint checking with witness traces showing how each violation arises

## Dependencies

Loaded at runtime from `esm.sh` (no build step):

- `ohm-js@17` — PEG parser generator for the Datalog grammar
- `solid-js@1.9` — UI rendering (via `../solid.js` shared helpers)
