---
name: p3net
description: Domain-specific API for creating and configuring an llm-petrinet — set system prompts, add optimizers/evaluators/problems, and read back the current configuration.
---

# p3net Skill

API for creating, configuring, and inspecting an LLM Petri Net. A Petri net runs parallel LLM optimizers against a problem document, then has an evaluator pick the best solution for the next iteration.

## How the system works

1. A **problem** token holds a document URL — this is what needs to be solved or improved.
2. Multiple **optimizer** tokens each hold a prompt describing an approach to the problem.
3. When the net fires, each optimizer gets a *copy* of the problem document and an LLM process runs with its prompt. The results land in the **solutions** place.
4. An **evaluator** reads all solutions and picks the best one. That winner becomes the new problem for the next round.

## Key constraint — you are writing prompts for other LLMs

The LLMs that execute optimizer and evaluator steps **do not have access to skills**. They can only run JavaScript via `<script>` tags with `repo` available as a global.

This means the system prompt templates you write must be completely self-contained:

- Include exact `<script>` blocks the child LLM should execute.
- Hardcode any URLs directly into the prompt text. Use `getSkillURL('name')` (a global runtime function) to get a skill's import URL for embedding.
- Give the child LLM the raw Automerge API calls it needs — do not tell it to "load" or "find" a skill.

### Do not embed document values in prompts

Optimizer and evaluator prompts should describe **how** to read and write the document, not repeat specific content from it. The child LLM receives the actual document at runtime and can inspect its current value itself. Hardcoding values into the prompt is brittle (the document changes every iteration) and wastes context. Stick to instructions and `<script>` blocks that show the child LLM the API calls for reading/writing — let it decide what to do based on what it finds.

## Template variables

The system prompt templates support these placeholders (substituted at runtime):

| Variable | Available in | Replaced with |
|---|---|---|
| `$PROMPT` | optimizer, evaluator | The content of the optimizer/evaluator token's document |
| `$DOC_URL` | optimizer | The URL of the document copy to work on |
| `$SOLUTION_URLS` | evaluator | A JSON array of solution document URLs |

## API

### Create

#### `createNet(repo)` → `string`

Creates a new LLM Petri Net document with empty token arrays. Returns the net's URL.

### Writers

#### `setOptimizerSystemPrompt(repo, netUrl, promptText)` → `string`

Sets the optimizer system prompt template. Creates a new document with `promptText` and wires it into the net. Returns the new document's URL.

#### `setEvaluatorSystemPrompt(repo, netUrl, promptText)` → `string`

Sets the evaluator system prompt template. Same behavior as above.

#### `addOptimizer(repo, netUrl, promptText)` → `string`

Adds an optimizer token to the net. Creates a new document with `promptText` (this becomes `$PROMPT` at runtime). Returns the prompt document's URL.

#### `addEvaluator(repo, netUrl, criteriaText)` → `string`

Adds an evaluator token to the net. Creates a new document with `criteriaText` (this becomes `$PROMPT` at runtime). Returns the prompt document's URL.

#### `addProblem(repo, netUrl, docUrl)` → `void`

Adds an existing document as a problem token. Pass the URL of the document you want the optimizers to work on.

### Readers

#### `getOptimizerSystemPrompt(repo, netUrl)` → `string`

Returns the current optimizer system prompt template text.

#### `getEvaluatorSystemPrompt(repo, netUrl)` → `string`

Returns the current evaluator system prompt template text.

#### `getOptimizers(repo, netUrl)` → `Array<{ id, prompt }>`

Returns all optimizer tokens with their resolved prompt text.

#### `getEvaluators(repo, netUrl)` → `Array<{ id, prompt }>`

Returns all evaluator tokens with their resolved prompt text.

#### `getProblems(repo, netUrl)` → `Array<{ id, docUrl }>`

Returns all problem tokens with their document URLs.

### Global runtime functions

These are available on `globalThis` during script evaluation (not part of this skill's exports):

#### `getSkillURL(name)` → `string`

Returns the import URL for a skill's API module (already encoded). Use this to hardcode skill URLs into prompts you write for child LLMs.

## Full example — setting up a product-description optimizer

This example creates a new Petri Net and configures it end-to-end.

### Step 1 — import the skill and create a net

```javascript
const p3net = await importSkillApi("p3net")
const netUrl = p3net.createNet(repo)
```

### Step 2 — get the skill URL for embedding in child LLM prompts

Child LLMs cannot call `importSkillApi`. To let them use a skill's helpers, hardcode the URL into their prompts:

```javascript
const skillUrl = getSkillURL("p3net")
```

### Step 3 — set the optimizer system prompt

This template is given to every optimizer child LLM. It uses `$PROMPT` (the optimizer's angle) and `$DOC_URL` (the copy of the problem document). The child LLM has no skills — give it raw Automerge API calls in `<script>` blocks:

```javascript
await p3net.setOptimizerSystemPrompt(repo, netUrl, `You are a copywriter improving a product description.

Your angle: $PROMPT

Document: $DOC_URL

Step 1 — read the current document:
<script data-description="Read document">
const handle = await repo.find("$DOC_URL")
const doc = await handle.doc()
return doc.content
</script>

Step 2 — rewrite the document with your improvements. Replace the entire content:
<script data-description="Write improved version">
const { updateText } = await import("@automerge/automerge-repo")
const handle = await repo.find("$DOC_URL")
const doc = await handle.doc()
const improved = \`your improved markdown here\`
handle.change(d => updateText(d, ["content"], improved))
</script>

Write the full improved document in the second script. Do not explain — just write.`)
```

### Step 4 — set the evaluator system prompt

This template is given to the evaluator child LLM. It uses `$PROMPT` (the judging criteria) and `$SOLUTION_URLS` (a JSON array of solution document URLs):

```javascript
await p3net.setEvaluatorSystemPrompt(repo, netUrl, `You are an editor choosing the best version of a product description.

Criteria: $PROMPT

Step 1 — read all candidate versions:
<script data-description="Read all solutions">
const urls = $SOLUTION_URLS
const results = await Promise.all(urls.map(async url => {
  const handle = await repo.find(url)
  const doc = await handle.doc()
  return { url, content: doc?.content ?? "" }
}))
return results.map(r => \`--- \${r.url} ---\\n\${r.content}\`).join("\\n\\n")
</script>

Step 2 — pick the best version.
Consider the criteria above. Respond with ONLY the URL of the winning document — a single line, nothing else.`)
```

### Step 5 — add optimizers with different angles

Each optimizer gets a different approach. The text you pass becomes `$PROMPT` in the system template:

```javascript
await p3net.addOptimizer(repo, netUrl,
  "Focus on emotional appeal and storytelling. Make the reader feel something.")

await p3net.addOptimizer(repo, netUrl,
  "Focus on clarity, conciseness, and scannability. Cut every unnecessary word.")

await p3net.addOptimizer(repo, netUrl,
  "Focus on technical credibility and specific claims. Add concrete details.")
```

### Step 6 — add an evaluator

The evaluator's text becomes `$PROMPT` in the evaluator system template:

```javascript
await p3net.addEvaluator(repo, netUrl,
  "Choose the version that best balances emotional appeal with concrete details. It should be scannable, under 200 words, and make someone want to buy the product.")
```

### Step 7 — add the problem document

Point the net at an existing document to optimize:

```javascript
await p3net.addProblem(repo, netUrl, problemDocUrl)
```

### What happens at runtime

1. The net fires the **optimizing** transition. Each optimizer gets a copy of the problem document. Three child LLMs run in parallel, each rewriting the copy from their angle.
2. Three solution documents land in the **solutions** place.
3. The net fires the **evaluating** transition. The evaluator LLM reads all three solutions, picks the best URL, and that becomes the new problem.
4. The cycle repeats — the optimizers now improve the winning version further.

## Notes

- Child LLMs execute code inside `<script>` tags and have `repo` available as a global.
- Always hardcode URLs in child LLM prompts — they cannot discover or resolve URLs at runtime. Use `getSkillURL('name')` to obtain the URL.
- The system prompt templates use backtick-delimited code blocks in the examples above, but at runtime the child LLM sees them as plain `<script>` instructions.
