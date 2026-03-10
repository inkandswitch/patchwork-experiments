/**
 * Converts an automerge: URL to the HTTP path the service worker handles.
 * e.g. "automerge:abc123" → "/automerge%3Aabc123"
 */
function toSwPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', '/automerge%3A');
}

export function makeDefaultSource(): string {
  const libUrl = `${toSwPath(__ROOT_DIR_URL__)}/dist/p3net/index.js`;
  const llmProcessUrl = `${toSwPath(__ROOT_DIR_URL__)}/dist/petrinet-llm-process/index.js`;

  return `import { defineNet } from '${libUrl}'
import { runLLMProcess } from '${llmProcessUrl}'

// Export a factory function (handle, repo) => PetriNet.
// Using a closure lets guard + onTokens capture 'repo' for repo.find() / repo.create().
export default (handle, repo) => defineNet({

  places: ['prompts', 'solutions', 'running'],

  transitions: [
    {
      id: 'start_process',
      from: ['prompts', 'solutions'],
      to: ['running'],
      async onTokens({ prompts, solutions }, produce, repo) {
        // Read the prompt text from the linked markdown document
        const promptHandle = await repo.find(prompts.state.prompt)
        const promptText = promptHandle.doc()?.content ?? ''

        // Create a copy of the solution document for the LLM to edit
        const solutionHandle = await repo.find(solutions.state.document)
        const copyHandle = repo.create()
        copyHandle.change(d => {
          d['@patchwork'] = { type: 'markdown', copyOf: solutions.state.document }
          d.content = solutionHandle.doc()?.content ?? ''
        })

        // Create the LLM process document
        const processHandle = repo.create()
        processHandle.change(d => {
          d['@patchwork'] = { type: 'petrinet-llm-process' }
          d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' }
          d.prompt = promptText
          d.docUrl = copyHandle.url
          d.output = []
          d.done = false
        })

        // Start the process; mark done when it resolves
        runLLMProcess(repo, processHandle.url).then(() => {
          processHandle.change(d => { d.done = true })
        })

        produce({ type: 'llm-process', llmProcess: processHandle.url, prompt: prompts.state.prompt }, 'running')
      },
    },

    {
      id: 'complete',
      from: ['running'],
      to: ['prompts', 'solutions'],
      async guard({ running }) {
        const processHandle = await repo.find(running.state.llmProcess)
        return processHandle?.doc()?.done === true
      },
      async onTokens({ running }, produce, repo) {
        const processHandle = await repo.find(running.state.llmProcess)
        const processDoc = processHandle?.doc()

        // Return the original prompt token unchanged; the edited copy becomes the new solution
        produce({ type: 'prompt', prompt: running.state.prompt }, 'prompts')
        produce({ type: 'solution', document: processDoc?.docUrl }, 'solutions')
      },
    },
  ],

  tokenTypes: [
    {
      id: 'prompt',
      label: 'Prompt',
      color: '#7c3aed',
      create(repo) {
        const doc = repo.create()
        doc.change(d => {
          d['@patchwork'] = { type: 'markdown', suggestedImportUrl: 'automerge:dhkuYMpSttbRJPBJ7J5XST28bu7' }
          d.content = '# Untitled'
        })
        return { type: 'prompt', prompt: doc.url }
      },
    },
    {
      id: 'solution',
      label: 'Solution',
      color: '#0891b2',
      create(repo) {
        const doc = repo.create()
        doc.change(d => {
          d['@patchwork'] = { type: 'markdown', suggestedImportUrl: 'automerge:dhkuYMpSttbRJPBJ7J5XST28bu7' }
          d.content = '# Untitled'
        })
        return { type: 'solution', document: doc.url }
      },
    },
    {
      id: 'llm-process',
      label: 'LLM Process',
      color: '#d97706',
      create() {
        return { type: 'llm-process' }
      },
    },
  ],

  getColor(state) {
    if (state.type === 'prompt') return '#7c3aed'
    if (state.type === 'solution') return '#0891b2'
    if (state.type === 'llm-process') return '#d97706'
    return '#6b7280'
  },

})(handle, repo)
`;
}
