# LLM Module

## Structure

```
llm/src/
├── index.ts           # Root - exports plugins = [...llmProcessPlugins, ...chatPlugins]
├── types.ts           # Shared types
├── workspace.ts       # Workspace API implementation
├── INSTRUCTIONS.md    # System prompt instructions for LLM scripting
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
  "@patchwork": { type: "llm-process" };
  title: string;
  model: string;
  systemPrompt: string;
  docFolderUrl: AutomergeUrl;
  skills?: string[];
  messages: Message[];
  running?: boolean;
};

type LLMChatDoc = {
  "@patchwork": { type: "llm-chat" };
  title: string;
  model: string;
  docFolderUrl: AutomergeUrl;
  skills?: string[];
  processUrl: AutomergeUrl;
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
  return {
    async createTodo(title: string) {
      const handle = await workspace.create<TodoDoc>({ name: title, type: "todo" });
      handle.change(doc => {
        doc["@patchwork"] = { type: "todo" };
        doc.title = title;
        doc.todos = [];
      });
      return { handle, url: handle.url };
    },
    
    async getTodo(url: AutomergeUrl) {
      const handle = await workspace.find<TodoDoc>(url);
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
  loadSkill(skillId: string): Promise<SkillAPI>;
  getSkillDocumentation(skillId: string): Promise<string>;
  
  // Documents
  find<T>(url: AutomergeUrl): Promise<DocHandle<T>>;
  create<T>(options?: { name?: string; type?: string }): Promise<DocHandle<T>>;
  listDocuments(): Promise<{ name: string; type: string; url: AutomergeUrl }[]>;
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
const { url } = await todo.createTodo("Shopping List");
const list = await todo.getTodo(url);
list.addItem("Buy milk");
list.addItem("Buy eggs");

console.log(list.getItems());
```

This pattern follows progressive disclosure: descriptions enable discovery, documentation provides full details only when needed.

## Chat

A chat document wraps a single LLM process document. The chat view provides the input UI and embeds the process view (via `<patchwork-view>`) for message rendering.

When the user sends a message, the chat appends it to the process doc's messages and calls `runLLMProcess`. The `running` field on the process doc tracks whether the LLM is actively generating.

## runLLMProcess

```ts
import { runLLMProcess } from "@patchwork/llm";

const handle = repo.create<LLMProcessDoc>();
handle.change((doc) => {
  doc["@patchwork"] = { type: "llm-process" };
  doc.title = "Grocery List";
  doc.model = "anthropic/claude-sonnet-4.6";
  doc.systemPrompt = "You are a helpful assistant.";
  doc.docFolderUrl = folderUrl;
  doc.skills = ["todo"];
  doc.messages = [
    { role: "user", content: "Create a todo list for my grocery shopping." },
  ];
});

// Run it - supports optional AbortSignal for cancellation
await runLLMProcess(repo, handle);

// Doc is mutated with assistant response
console.log(handle.docSync().messages);
```

### Script Execution

Scripts are executed with `workspace` injected as a local variable (not on globalThis):

```ts
async function evalScript(code: string, workspace: Workspace) {
  const capturedConsole = createCapturedConsole();
  
  const fn = new Function('workspace', 'console', `
    return (async () => {
      ${code}
    })();
  `);
  
  const result = await fn(workspace, capturedConsole);
  return { output: capturedConsole.flush() };
}
```
