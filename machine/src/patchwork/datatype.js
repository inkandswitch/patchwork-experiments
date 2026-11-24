/**
 * A machine: an existing game run as a deterministic engine that everyone
 * present steps from a shared input log.
 *
 * @typedef {{
 *   title: string,
 *   kind?: "doom" | "snes",   // which engine
 *   content?: string,          // url of a doc { title, bytes }: what the engine boots (an IWAD with its start arguments, a ROM)
 *   session?: string,          // url of the host's session doc (machine/HOST.md)
 * }} MachineDoc
 */
/**
 * Seconds between a new session's checkpoints, by kind. Every checkpoint
 * document stays in its writer's memory (host.js #write says why), a Doom one
 * about 7.5 MB held, so they should be few. Doom steps in microseconds, so a
 * joiner replaying ten minutes from a checkpoint is done in about a second;
 * an emulated SNES takes 1.4 ms a tick, so its checkpoints stay a minute
 * apart (a minute's replay is about five seconds).
 */
export const CHECKPOINT_SECONDS = { doom: 600, snes: 60 };

export const MachineDatatype = {
  init(doc) {
    doc.title = "Machine";
  },
  getTitle(doc) {
    return doc.title || "Machine";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
