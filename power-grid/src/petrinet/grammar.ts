import * as ohm from 'ohm-js';
import type { PetriNet } from './net';

// ─── Grammar ──────────────────────────────────────────────────────────────────
// Three fact types only:
//   place(id).
//   transition(id).
//   arc(from, to).

const GRAMMAR_SRC = String.raw`
Petrinet {
  Program        = Fact*
  Fact           = PlaceFact | TransFact | ArcFact
  PlaceFact      = "place" "(" ident ")" "."
  TransFact      = "transition" "(" ident ")" "."
  ArcFact        = "arc" "(" ident "," ident ")" "."
  ident          = letter (alnum | "_")*
  comment        = ("//" | "%") (~"\n" any)* ("\n" | end)
  space         += comment
}
`;

const grammar = ohm.grammar(GRAMMAR_SRC);

// ─── Semantics ────────────────────────────────────────────────────────────────

type ParsedFact =
  | { kind: 'place'; id: string }
  | { kind: 'transition'; id: string }
  | { kind: 'arc'; from: string; to: string };

const semantics = grammar.createSemantics();

semantics.addOperation<any>('toAST', {
  Program(facts) {
    return facts.children.map((f: any) => f.toAST());
  },

  Fact(child) {
    return child.toAST();
  },

  PlaceFact(_kw, _lp, id, _rp, _dot) {
    return { kind: 'place', id: id.sourceString } as ParsedFact;
  },

  TransFact(_kw, _lp, id, _rp, _dot) {
    return { kind: 'transition', id: id.sourceString } as ParsedFact;
  },

  ArcFact(_kw, _lp, from, _comma, to, _rp, _dot) {
    return { kind: 'arc', from: from.sourceString, to: to.sourceString } as ParsedFact;
  },

  _iter(...children: any[]) {
    return children.map(c => c.toAST());
  },

  _terminal() {
    return this.sourceString;
  },
});

// ─── Public API ───────────────────────────────────────────────────────────────

export type ParseError = { message: string };

export function parsePetrinet(source: string): { net: PetriNet; errors: ParseError[] } {
  const matchResult = grammar.match(source);

  if (matchResult.failed()) {
    return {
      net: { places: [], transitions: [], arcs: [] },
      errors: [{ message: matchResult.message ?? 'Parse error' }],
    };
  }

  const facts: ParsedFact[] = semantics(matchResult).toAST();

  const placeIds = new Set<string>();
  const transitionIds = new Set<string>();
  const net: PetriNet = { places: [], transitions: [], arcs: [] };

  for (const fact of facts) {
    if (fact.kind === 'place' && !placeIds.has(fact.id)) {
      placeIds.add(fact.id);
      net.places.push({ id: fact.id });
    } else if (fact.kind === 'transition' && !transitionIds.has(fact.id)) {
      transitionIds.add(fact.id);
      net.transitions.push({ id: fact.id });
    }
  }

  for (const fact of facts) {
    if (fact.kind === 'arc') {
      // Direction is inferred: place → transition = input arc, transition → place = output arc
      const kind = placeIds.has(fact.from) ? 'in' : 'out';
      net.arcs.push({ from: fact.from, to: fact.to, kind });
    }
  }

  return { net, errors: [] };
}
