import { Plugin } from '@inkandswitch/patchwork-plugins';

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'todo',
    name: 'Todo List',
    icon: 'ListTodo',
    supportedDatatypes: ['todo'],
    async load() {
      const { renderTodoEditor } = await import('./Todo');
      return renderTodoEditor;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'todo',
    name: 'Todo List',
    icon: 'ListTodo',
    async load() {
      const { TodoDatatype } = await import('./datatype');
      return TodoDatatype;
    },
  },
  {
    type: 'patchwork:skill',
    id: 'todo',
    name: 'Todo List',
    description:
      'Creates and manages todo list documents with items that can be added, toggled, and removed. Use when the user asks to create a task list, checklist, shopping list, or track items to complete.',
    async load() {
      return {
        documentation: (await import('./SKILL.md?raw')).default,
        api: (await import('./skill-api')).default,
      };
    },
  },
];
