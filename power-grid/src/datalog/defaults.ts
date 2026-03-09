import type { StoredFact, StoredRule } from './datalog';

export const DEFAULT_FACTS: StoredFact[] = [
  // Topology
  { pred: 'node', args: ['north', 'generator'] },
  { pred: 'node', args: ['central', 'substation'] },
  { pred: 'node', args: ['south', 'load'] },
  // Geographic positions: geopos(node, lat, lng)
  { pred: 'geopos', args: ['north', 53.1, 13.4] },
  { pred: 'geopos', args: ['central', 52.5, 13.4] },
  { pred: 'geopos', args: ['south', 51.8, 13.4] },
  // Transmission lines: edge(from, to, capacity_mw)
  { pred: 'edge', args: ['north', 'central', 500] },
  { pred: 'edge', args: ['central', 'south', 300] },
  // Generation capacity
  { pred: 'generates', args: ['north', 800] },
  // Load demand
  { pred: 'consumes', args: ['central', 50] },
  { pred: 'consumes', args: ['south', 400] },
  // Proposed flows: north sends 400 MW to central,
  // central tries to forward 350 MW south (50 consumed locally + 350 onward = 400 in)
  // but central→south capacity is only 300 → overloaded
  { pred: 'flow', args: ['north', 'central', 400] },
  { pred: 'flow', args: ['central', 'south', 350] },
];

export const DEFAULT_RULES: StoredRule[] = [
  // Reachability
  {
    head: { pred: 'reachable', args: ['X', 'Y'] },
    body: [{ pred: 'edge', args: ['X', 'Y', '_'] }],
  },
  {
    head: { pred: 'reachable', args: ['X', 'Z'] },
    body: [
      { pred: 'reachable', args: ['X', 'Y'] },
      { pred: 'edge', args: ['Y', 'Z', '_'] },
    ],
  },
  // Flow within capacity → valid_flow certificate
  {
    head: { pred: 'valid_flow', args: ['X', 'Y'] },
    body: [
      { pred: 'edge', args: ['X', 'Y', 'C'] },
      { pred: 'flow', args: ['X', 'Y', 'F'] },
      { pred: 'lte', args: ['F', 'C'] },
    ],
  },
  // Flow exceeds capacity → overloaded
  {
    head: { pred: 'overloaded', args: ['X', 'Y'] },
    body: [
      { pred: 'edge', args: ['X', 'Y', 'C'] },
      { pred: 'flow', args: ['X', 'Y', 'F'] },
      { pred: 'gt', args: ['F', 'C'] },
    ],
  },
  // Net balance at a node: generation minus consumption
  {
    head: { pred: 'net_balance', args: ['N', 'B'] },
    body: [
      { pred: 'generates', args: ['N', 'G'] },
      { pred: 'consumes', args: ['N', 'C'] },
      { pred: 'sub', args: ['G', 'C', 'B'] },
    ],
  },
];
