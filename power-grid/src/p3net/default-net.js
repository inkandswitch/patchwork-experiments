import { defineNet } from '__LIB_URL__'
import { runLLMProcess } from '__LLM_PROCESS_URL__'

const markdownSkillUrl = '__MARKDOWN_SKILL_URL__'

// Export a factory function (handle, repo) => PetriNet.
// Using a closure lets guard + onConsumedTokens/onProducedToken capture 'repo' and 'handle'.
export default (handle, repo) => defineNet({

  places: ['prompts', 'solutions', 'running'],

  transitions: [
    {
      id: 'start_process',
      from: ['prompts', 'solutions'],
      to: ['running'],
      async onConsumedTokens({ prompts, solutions }, repo) {
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
          d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o', api: markdownSkillUrl }
          d.prompt = promptText
          d.docUrl = copyHandle.url
          d.output = []
          d.done = false
        })

        return {
          produce: [{ state: { type: 'llm-process', llmProcess: processHandle.url, prompt: prompts.state.prompt, done: false }, toPlace: 'running' }],
        }
      },

      async onProducedToken(token) {
        // The token is now guaranteed to be in the running place.
        // Launch the LLM and mark the token done when it finishes.
        const processUrl = token.state.llmProcess

        setTimeout(() => {
          processHandle.change(d => { d.done = true })
        }, 1000)
        const processHandle = await repo.find(processUrl)
        // runLLMProcess(repo, processUrl).then(() => {
        //   processHandle.change(d => { d.done = true })
        //   handle.change(d => {
        //     const tok = (d.tokens?.running ?? []).find(t => t.state.llmProcess === processUrl)
        //     if (tok) tok.state.done = true
        //   })
        // }).catch(err => {
        //   console.error('[p3net] runLLMProcess FAILED for', processUrl, err)
        // })
      },
    },

    {
      id: 'complete',
      from: ['running'],
      to: ['prompts', 'solutions'],
      async guard({ running }) {
        // Check the token's own done flag, which is set by onProducedToken
        // only after the token has landed in the running place.
        return running.state.done === true
      },
      async onConsumedTokens({ running }, repo) {
        const processHandle = await repo.find(running.state.llmProcess)
        const processDoc = processHandle?.doc()

        // Return the original prompt token unchanged; the edited copy becomes the new solution
        return {
          produce: [
            { state: { type: 'prompt', prompt: running.state.prompt }, toPlace: 'prompts' },
            { state: { type: 'solution', document: processDoc?.docUrl }, toPlace: 'solutions' },
          ],
        }
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
