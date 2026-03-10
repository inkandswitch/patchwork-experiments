// ─── Default Petri net program ────────────────────────────────────────────────
// A traffic light that cycles: red → green → yellow → red

export const DEFAULT_PETRINET_TEXT = `\
place(red).
place(green).
place(yellow).

transition(go).
transition(slow).
transition(stop).

arc(red, go).
arc(go, green).
arc(green, slow).
arc(slow, yellow).
arc(yellow, stop).
arc(stop, red).
`;
