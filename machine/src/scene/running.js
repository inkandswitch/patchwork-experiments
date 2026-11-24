// A machine in a scene, on one view: its session's host, stepped to the
// scene's world time (worldClock), and the two things that time asks of it.
//
// - The stage's world time passes only while some view computes it, and a
//   view computes only for a process (scene/NATIVE.md, "Native services"). So
//   while the machine runs this view registers a replicated process; while
//   it's stopped, none, so a machine nobody plays keeps no world going. The
//   process's step does nothing: the host is pulled, not stepped. It reads
//   its tick from t() on every frame, running or not (a view that went past
//   a stop rewinds to it, late inputs re-simulate, checkpoints settle while
//   it's stopped too), at its own rate (35 Hz, 60.1 Hz) and with rollback,
//   which a forward-only step on the stage's 1/60 s grid can't say. What the
//   machine needs from the process is only that world time passes
//   (HOST.md, Phase 2b, Decisions 13).
// - Nobody holds a port: the machine stops where the last player left it
//   (quiet.js), in world time. Every view writes the same stop.
//
// Nothing here knows the engine, the scene's objects or how the picture is
// drawn: extension.js gives it the stage, and takes pictures from `host`.
import { Host } from "../host/host.js";
import { worldClock } from "../host/clock.js";
import { seating } from "../host/session.js";
import { quietClock } from "../patchwork/quiet.js";

/**
 * Opens a machine's session on this view.
 * @param o.repo, o.url        the repo, and the session's url
 * @param o.wasm, o.content    the engine and what it boots (checked against the session)
 * @param o.ports              how many ports people play (load.js portsOf)
 * @param o.world              the scene's clock: { t(), running(), process(spec) → remove }
 * @param o.now                () => ms, the stage's time (liveness: reaping, chunks, messages)
 * @param o.writable           () => may this view write (a pin or a mirror never does)
 * @param o.by, o.input        who sits, as seats record it; this view's pad, sampled per tick
 * @param o.open               Host.open, or a RemoteHost's (a host in a worker)
 */
export async function runMachine(o) {
  const session = await o.repo.find(o.url);
  const [num, den] = session.doc().engine.hz;
  const hz = num / den;
  const clock = worldClock(session, o.world);
  const host = await (o.open ?? Host.open.bind(Host))(o.repo, o.url, {
    wasm: o.wasm,
    content: o.content,
    clock,
    now: o.now,
    by: o.by ?? null,
    input: o.input,
  });

  let closed = false;
  let removeProcess = null;
  const quiet = () => {
    if (closed || !o.writable()) return;
    const stop = quietClock(session.doc(), o.ports, hz, o.world.t() * 1000);
    if (stop) session.change((d) => void (d.clock = stop));
  };
  // A microtask after each change to the session, so standing up and sitting
  // elsewhere in one act never stops the machine in between.
  let queued = false;
  const onSession = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      quiet();
    });
  };
  session.on("change", onSession);
  quiet();

  /** Who holds each port now: [{ id, by } | null], by port. */
  const holders = () => {
    const s = session.doc();
    return seating(s.seats, o.ports).map((p) => {
      const last = p.at(-1);
      return last && last.until === Infinity ? { id: last.id, by: s.seats[last.id]?.by ?? null } : null;
    });
  };

  return {
    host,
    clock,
    holders,
    /** Every frame: steps the host towards t, and keeps the process while the machine runs. */
    frame() {
      if (closed) return;
      host.frame();
      const runs = clock.running();
      if (runs && !removeProcess) removeProcess = o.world.process({ replicated: true, step() {} }); // the host is pulled, not stepped (above)
      else if (!runs && removeProcess) {
        removeProcess();
        removeProcess = null;
      }
    },
    /**
     * Takes `port` and starts the machine: the port, or null if someone
     * holds it, or holds it a little longer (Host.sit refuses: a seat ending
     * ahead of now, its holder just stood up). Already holding a port, that one.
     */
    play(port) {
      if (host.seat) return host.seat.port;
      try {
        host.sit(port); // seated first, then the clock: the port is held when it starts
      } catch {
        return null;
      }
      if (!clock.running()) host.resume();
      return port;
    },
    /** Gives the port back; the last to leave stops the machine (quiet). */
    leave() {
      if (host.seat) host.stand();
    },
    close() {
      if (closed) return;
      if (host.seat) host.stand();
      quiet();
      closed = true;
      session.off("change", onSession);
      removeProcess?.();
      removeProcess = null;
      return host.close();
    },
  };
}
