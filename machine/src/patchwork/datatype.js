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
