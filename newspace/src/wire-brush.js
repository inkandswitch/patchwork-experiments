// The WIRE tool as a built-in brush — the last tool out of the host's gesture switch.
//
// It's NOT a stroke brush: it grabs a PORT in the capture phase (the host does that, before
// an embedded tool can swallow the press, then hands the brush a gesture with that port and
// a started draft). So the brush owns only the small DRAG STATE MACHINE:
//
//   move → drag the wire's loose end to the pointer
//   up   → a CLICK (no real drag) on a port inspects its schema; a real DRAG resolves the
//          drop (schema-matched: rewire an inlet, or place + wire a new node)
//
// The heavy, canvas-coupled drop logic (schema matching, placing/wiring nodes, the port
// inspector) stays a HOST capability on the ctx — the brush just sequences it. This keeps
// the wiring system (which much of the tool depends on) untouched while the gesture itself
// becomes a small, testable module like the other brushes.

export const WireBrush = {
  id: "wire",
  use() {
    return {
      down() { /* the host already grabbed the port + started the draft on capture */ },
      move(ctx) { ctx.updateWire(); },
      up(ctx) { if (ctx.isClick) ctx.inspectPort(); else ctx.drop(); },
    };
  },
};

export const wireHandlers = WireBrush.use();
