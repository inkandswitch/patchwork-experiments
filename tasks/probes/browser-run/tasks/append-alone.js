// probes/append-task.js, unchanged, run where it needs no sync server: on a
// document its run worker makes in its own Repo, rather than one the page
// made (which reaches a run worker only by way of the sync server). It
// imports Automerge by bare name all the same, through the page's import map.
// Returns how many pieces it appended and the text as its Repo has it.
//
// input: { pieces: string[], everyMs: number }
import append from '../../append-task.js';

export default async function appendAlone({ pieces, everyMs }, ctx) {
  const handle = ctx.repo.create({ text: '' });
  const appended = await append({ doc: handle.url, pieces, everyMs }, ctx);
  return { appended, text: handle.doc().text };
}
