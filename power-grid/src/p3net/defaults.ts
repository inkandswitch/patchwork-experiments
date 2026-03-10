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
      onTokens({ prompts, solutions }, produce, repo) {
        // Read the prompt text from the linked markdown document
        const promptHandle = repo.find(prompts.state.prompt)
        const promptText = promptHandle.doc()?.content ?? ''

        // Create a copy of the solution document (copyOf links back to the original)
        const solutionHandle = repo.find(solutions.state.document)
        const copyHandle = repo.create()
        copyHandle.change(d => {
          d['@patchwork'] = { type: 'essay', copyOf: solutions.state.document }
          d.content = solutionHandle.doc()?.content ?? ''
        })

        // Create the LLM process document
        const processHandle = repo.create()
        processHandle.change(d => {
          d.config = { apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }
          d.prompt = promptText
          d.docUrl = copyHandle.url
          d.output = []
          d.done = false
        })

        // Start the process; mark done when it resolves
        runLLMProcess(repo, processHandle.url).then(() => {
          processHandle.change(d => { d.done = true })
        })

        produce({ type: 'llm-process', llmProcess: processHandle.url }, 'running')
      },
    },

    {
      id: 'complete',
      from: ['running'],
      to: ['prompts', 'solutions'],
      guard({ running }) {
        // repo is captured from the outer (handle, repo) closure
        const processHandle = repo.find(running.state.llmProcess)
        return processHandle?.doc()?.done === true
      },
      onTokens({ running }, produce, repo) {
        const processHandle = repo.find(running.state.llmProcess)
        const processDoc = processHandle?.doc()

        // The edited solution document (the copy that was worked on) becomes the new solution
        // Create a new empty prompt document for the next iteration
        const newPromptHandle = repo.create()
        newPromptHandle.change(d => {
          d['@patchwork'] = { type: 'essay' }
          d.content = '# Next prompt\\n\\nDescribe the next task here.'
        })

        produce({ type: 'prompt', prompt: newPromptHandle.url }, 'prompts')
        produce({ type: 'solution', document: processDoc?.docUrl }, 'solutions')
      },
    },
  ],

  tokenTypes: [
    {
      id: 'prompt',
      label: 'Prompt',
      color: '#7c3aed',
      initialState() {
        return { type: 'prompt', prompt: null }
      },
    },
    {
      id: 'solution',
      label: 'Solution',
      color: '#0891b2',
      initialState() {
        return { type: 'solution', document: null }
      },
    },
    {
      id: 'llm-process',
      label: 'LLM Process',
      color: '#d97706',
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
