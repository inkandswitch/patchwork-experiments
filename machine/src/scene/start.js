// Starting a machine object on one view, patiently. Two things can keep it
// from starting at once, and neither may strand it:
//
// - Its session isn't made yet. The view holding the object's
//   `machine.session` claim makes it and writes it on the trait; every other
//   view waits. But the holder can fail (what the machine runs hasn't synced
//   yet, a fetch fails), or leave before it writes (its claim then lapses:
//   scene/STAGE.md, "Native services"). So a view that didn't make it asks again a
//   while later, and takes the claim if it's free by then.
// - What it needs isn't here yet: the machine doc's content, the engine.
//
// Each attempt either gets somewhere for good (the machine runs, or the
// session is written, after which the trait names it and a new entry opens
// it), or says why not and is tried again `every` ms later on the stage's
// time, which never pauses. Nothing here knows the stage: extension.js gives
// it the claim, the repo's reads and the trait.

/**
 * Runs `attempt` until it returns true, again `every` ms after each try that
 * returned false or threw (`failed` hears the error). Returns a cancel.
 * @param o.attempt  async () => boolean: done for good?
 * @param o.after    (ms, fn) => cancel: the stage's time (api.after)
 */
export function retrying({ attempt, after, every = 2000, failed = () => {} }) {
  let cancel = null;
  let done = false;
  const run = async () => {
    cancel = null;
    if (done) return;
    let ok = false;
    try {
      ok = (await attempt()) === true;
    } catch (err) {
      if (!done) failed(err);
    }
    if (ok) done = true;
    else if (!done) cancel = after(every, run);
  };
  run();
  return () => {
    done = true;
    cancel?.();
    cancel = null;
  };
}

/**
 * One attempt at a machine object's session: true once it's on the trait
 * (written here or by anyone), false when another view holds the claim (it
 * may yet fail or leave: ask again). Throws when this view holds the claim
 * and can't make it yet; the claim is let go either way.
 * @param o.claim    () => release | null: the object's `machine.session` claim
 * @param o.has      () => boolean: the trait names a session
 * @param o.content  async () => Uint8Array | null: what the machine runs, if it's all here
 * @param o.create   async (content) => url: a new session, stopped at tick 0
 * @param o.write    (url) => void: writes it on the trait, if the trait has none yet
 */
export async function makeSession({ claim, has, content, create, write }) {
  if (has()) return true;
  const release = claim();
  if (!release) return false;
  try {
    const bytes = await content();
    if (!bytes?.length) throw new Error("what it runs isn't here yet");
    const url = await create(bytes);
    if (!has()) write(url);
    return true;
  } finally {
    release();
  }
}
