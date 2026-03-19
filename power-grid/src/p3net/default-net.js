// Export a factory (repo, api) => NetDef. The runtime wraps this with defineNet automatically.
// api provides: datatypes, createDocOfDatatype2, runLLMProcess — no imports needed.

export default (repo, api) => ({

  places: ['prompts', 'solutions', 'running'],

  transitions: [
    {
      id: 'start_process',
      from: ['prompts', 'solutions'],
      to: ['running'],
      async onConsumedTokens({ prompts, solutions }, repo) {
        const markdown = await api.datatypes.load('markdown')

        const solutionHandle = await repo.find(solutions.state.documentUrl)
        const copyHandle = await api.createDocOfDatatype2(markdown, repo, d => {
          d.content = solutionHandle.doc()?.content ?? ''
        })

        const promptHandle = await repo.find(prompts.state.documentUrl)
        const characterCard = promptHandle.doc()?.content ?? ''

        const workspaceHandle = repo.create()
        workspaceHandle.change(d => {
          d['@patchwork'] = { type: 'llm-workspace' }
          d.title = 'net process'
          d.urls = [copyHandle.url, prompts.state.documentUrl]
        })

        const instruction = [
          'You are editing a collaborative story document.',
          '',
          'Your character instructions are:',
          characterCard,
          '',
          'The repo variable is already available as a global — do not import it.',
          '',
          'Story document URL: ' + copyHandle.url,
          'Character card URL: ' + prompts.state.documentUrl,
          '',
          'Step 1: Read the story document:',
          '  const handle = await repo.find(storyUrl)',
          '  const content = handle.doc().content',
          '  return content',
          '',
          'Step 2: Think about the story and what your character would say next.',
          'Then append a single new line of dialog using updateText:',
          '  const { updateText } = await import("@automerge/automerge-repo")',
          '  handle.change(d => updateText(d, ["content"], d.content + "\\nCharacterName: dialog here"))',
          '',
          'Write only the dialog line, no stage directions. Do not overwrite existing content.',
        ].join('\n')

        const processHandle = repo.create()
        processHandle.change(d => {
          d['@patchwork'] = { type: 'llm' }
          d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' }
          d.workspaceUrl = workspaceHandle.url
          d.prompt = instruction
          d.output = []
        })

        return {
          produce: [{ state: { type: 'llm-process', documentUrl: processHandle.url }, toPlace: 'running' }],
        }
      },

      async onProducedToken(token, handle, repo) {
        api.runLLMProcess(repo, token.state.documentUrl)
      },
    },

    {
      id: 'complete',
      from: ['running'],
      to: ['prompts', 'solutions'],
      async guard({ running }, repo) {
        const h = await repo.find(running.state.documentUrl)
        return h.doc()?.done === true
      },
      async onConsumedTokens({ running }, repo) {
        const processHandle = await repo.find(running.state.documentUrl)
        const processDoc = processHandle.doc()
        const wsHandle = await repo.find(processDoc.workspaceUrl)
        const wsDoc = wsHandle.doc()

        return {
          produce: [
            { state: { type: 'prompt', documentUrl: wsDoc.urls[1] }, toPlace: 'prompts' },
            { state: { type: 'solution', documentUrl: wsDoc.urls[0] }, toPlace: 'solutions' },
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
      async create() {
        const markdown = await api.datatypes.load('markdown')
        const h = await api.createDocOfDatatype2(markdown, repo)
        return { type: 'prompt', documentUrl: h.url }
      },
    },
    {
      id: 'solution',
      label: 'Solution',
      color: '#0891b2',
      async create() {
        const markdown = await api.datatypes.load('markdown')
        const h = await api.createDocOfDatatype2(markdown, repo)
        return { type: 'solution', documentUrl: h.url }
      },
    },
    {
      id: 'llm-process',
      label: 'LLM Process',
      color: '#d97706',
      create() { return { type: 'llm-process', documentUrl: '' } },
    },
  ],

  getColor(state) {
    if (state.type === 'prompt') return '#7c3aed'
    if (state.type === 'solution') return '#0891b2'
    if (state.type === 'llm-process') return '#d97706'
    return '#6b7280'
  },

})
