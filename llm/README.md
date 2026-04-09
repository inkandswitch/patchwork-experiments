# LLM Module

## Structure

```
llm/src/
├── index.ts           # Root - exports plugins = [...llmProcessPlugins, ...chatPlugins]
├── types.ts           # Shared types
├── workspace.ts       # Workspace API implementation
├── llm-process/       # LLM Process datatype & tool
│   ├── index.ts       # Exports llmProcessPlugins
│   ├── datatype.ts
│   ├── view.tsx
│   ├── view.css
│   ├── run.ts         # runLLMProcess
│   └── parser.ts      # parseScriptBlocks
└── chat/              # LLM Chat datatype & tool
    ├── index.ts       # Exports chatPlugins
    ├── datatype.ts
    ├── view.tsx
    └── view.css
```

# LLM Process

## Types

```ts
type LLMProcessDoc = {
  title: string;
  model: string;
  systemPrompt: string;  // Base prompt (dynamic parts added automatically)
  docFolderUrl: AutomergeUrl;
  skills: string[];      // Plugin IDs of skills to use
  messages: Message[];   // User prompt + assistant response
  done: boolean;
};

type LLMChatDoc = {
  title: string;
  model: string;
  systemPrompt: string;
  docFolderUrl: AutomergeUrl;
  skills: string[];
  runs: AutomergeUrl[];  // Ordered list of LLMProcess URLs
};

type ScriptBlock = { type: "script"; code: string; description?: string; output?: string; error?: string };
type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; url: string };

type ContentBlock = TextBlock | ImageBlock | ScriptBlock;

type Message = {
  role: "system" | "user" | "assistant";
  content: string | ContentBlock[];
};
```

## Skills as Plugins

Skills are registered as plugins, so any module can provide skills for the LLM.

```ts
// In any module's index.ts (e.g. @patchwork/todo)
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "todo",
    // ...
  },
  {
    type: "patchwork:tool", 
    id: "todo",
    // ...
  },
  // Skill plugin - teaches LLM how to work with this datatype
  {
    type: "patchwork:skill",
    id: "todo",
    name: "Todo List",
    description: "Creates and manages todo list documents with items that can be added, toggled, and removed. Use when the user asks to create a task list, checklist, shopping list, or track items to complete.",
    async load() {
      return {
        documentation: (await import("./SKILL.md?raw")).default,
        api: (await import("./skill-api")).default,
      };
    },
  },
];
```

### Skill Description Guidelines

The `description` field is critical for skill discovery. The LLM sees descriptions at startup to decide which skills to use. Write descriptions that:

- **Use third person**: "Creates and manages..." not "I can help you..."
- **Describe what AND when**: Include both capability and usage triggers
- **Be specific**: Include key terms users might mention
- **Stay concise**: Max 1024 characters

Good example:
```
"Creates and manages todo list documents with items that can be added, toggled, and removed. Use when the user asks to create a task list, checklist, shopping list, or track items to complete."
```

Bad examples:
```
"Helps with tasks"  // Too vague
"I can help you manage todos"  // Wrong point of view
"Todo management"  // Missing when to use
```

### Skill Implementation

Skills export a **default function** that receives the workspace and returns the API:

```ts
// todo/src/skill-api.ts
import type { Workspace } from "@patchwork/llm";

export default function(workspace: Workspace) {
  const { repo } = workspace;
  
  return {
    createTodo(title: string) {
      const handle = repo.create<TodoDoc>();
      handle.change(doc => {
        doc.title = title;
        doc.todos = [];
      });
      return { handle, url: handle.url };
    },
    
    async getTodo(url: AutomergeUrl) {
      const handle = repo.find<TodoDoc>(url);
      await handle.whenReady();
      return {
        addItem(description: string) { ... },
        toggleItem(id: string) { ... },
        getItems() { ... },
      };
    },
  };
}
```

Benefits:
- Skills can live in **any module**, not just llm
- Discovered through the existing plugin registry
- Modules can expose datatype + tool + skill together
- Skills receive workspace, no global state needed

## Workspace API

The `workspace` object is available in all LLM scripts (injected as a local variable, not on globalThis):

```ts
interface Workspace {
  repo: Repo;
  docFolderUrl: AutomergeUrl;
  
  // Skills
  loadSkill(skillId: string): Promise<SkillAPI>;  // Load and instantiate
  getSkillDocumentation(skillId: string): Promise<string>;  // Get SKILL.md content
  
  // Documents
  find(url: AutomergeUrl): DocHandle;
  create<T>(): DocHandle<T>;
  listDocuments(): { name: string; type: string; url: AutomergeUrl }[];
}
```

### Using Skills in LLM Scripts

The LLM sees skill **descriptions** at startup but not the full documentation. To learn a skill's API, the LLM should first fetch the documentation:

```js
// First, read the skill documentation to learn the API
const docs = await workspace.getSkillDocumentation("todo");
console.log(docs);
```

Then load and use the skill:

```js
// Load skill - workspace.loadSkill calls the skill's default export with workspace
const todo = await workspace.loadSkill("todo");

// Use the skill API
const { url } = todo.createTodo("Shopping List");
const list = await todo.getTodo(url);
list.addItem("Buy milk");
list.addItem("Buy eggs");

console.log(list.getItems());
```

This pattern follows progressive disclosure: descriptions enable discovery, documentation provides full details only when needed.

## Chat Pattern

A chat is a sequence of LLMProcess documents. Each turn creates a new LLMProcess with the full message history.

## runLLMProcess

```ts
import { runLLMProcess } from "@patchwork/llm";

// Create doc directly
const handle = repo.create<LLMProcessDoc>();
handle.change((doc) => {
  doc.title = "Grocery List";
  doc.model = "anthropic/claude-sonnet-4";
  doc.systemPrompt = "You are a helpful assistant.";
  doc.docFolderUrl = folderUrl;
  doc.skills = ["todo"];
  doc.messages = [
    { role: "user", content: "Create a todo list for my grocery shopping." },
  ];
});

// Run it - workspace is injected into script eval scope
await runLLMProcess(repo, handle);

// Doc is mutated with assistant response
console.log(handle.docSync().messages);
```

### Script Execution

Scripts are executed with `workspace` injected as a local variable (not on globalThis):

```ts
async function evalScript(code: string, workspace: Workspace) {
  const capturedConsole = createCapturedConsole();
  
  // Create function with workspace and console as parameters
  const fn = new Function('workspace', 'console', `
    return (async () => {
      ${code}
    })();
  `);
  
  const result = await fn(workspace, capturedConsole);
  return { output: capturedConsole.flush() };
}
```

### Chat Example

```ts
async function sendMessage(chat: LLMChatDoc, userMessage: string) {
  // Get previous messages
  const previous = chat.runs.length > 0
    ? repo.find<LLMProcessDoc>(chat.runs.at(-1)!).docSync()?.messages ?? []
    : [];

  // Create new process doc
  const handle = repo.create<LLMProcessDoc>();
  handle.change((doc) => {
    doc.title = userMessage.slice(0, 50);
    doc.model = chat.model;
    doc.systemPrompt = chat.systemPrompt;
    doc.docFolderUrl = chat.docFolderUrl;
    doc.skills = chat.skills;
    doc.messages = [...previous, { role: "user", content: userMessage }];
  });

  // Run and add to chat
  await runLLMProcess(repo, handle);
  chat.runs.push(handle.url);

  return handle;
}
```
