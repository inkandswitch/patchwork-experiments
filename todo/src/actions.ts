import { type Plugin } from '@inkandswitch/patchwork-plugins';
import { type DocHandle } from '@automerge/automerge-repo';
import { z } from 'zod';
import { TodoDoc } from './Todo';

export type MarkdownDoc = {
  content: string;
};

export type FileDoc = {
  content: string;
};

type Todo = {
  id: string;
  description: string;
  done: boolean;
};

// Add a new todo item
export const addTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-add',
  name: 'Add Todo',
  icon: 'Plus',
  supportedDataTypes: ['todo'],
  module: {
    argsSchema: () => {
      return z.object({
        description: z.string().describe('Description of the todo item'),
        done: z
          .boolean()
          .optional()
          .default(false)
          .describe('Whether the todo is already completed'),
      });
    },
    default: (
      handle: DocHandle<TodoDoc>,
      _repo: any,
      args: { description: string; done?: boolean }
    ) => {
      const id = crypto.randomUUID();

      handle.change((doc) => {
        const newTodo: Todo = {
          id,
          description: args.description,
          done: args.done || false,
        };
        if (!doc.todos) {
          doc.todos = [];
        }
        doc.todos.push(newTodo);
      });

      return { id };
    },
  },
};

// Mark a todo item as completed (done)
export const markTodoDoneAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-complete',
  name: 'Mark Todo Done',
  icon: 'CheckSquare2',
  supportedDataTypes: ['todo'],
  module: {
    argsSchema: (doc: TodoDoc) => {
      const todoOptions = (doc.todos || []).filter((todo) => !todo.done).map((todo) => todo.id);

      // Must have at least one uncompleted todo to allow enum
      if (todoOptions.length === 0) {
        // fallback to a generic string - will validate at runtime, but should not be shown in UI
        return z.object({
          todoId: z.string().describe('ID of the todo item to mark done'),
        });
      }

      return z.object({
        todoId: z
          .enum(todoOptions as [string, ...string[]])
          .describe('ID of the todo item to mark done'),
      });
    },
    isApplicable: (doc: TodoDoc) => {
      return (doc.todos || []).some((todo) => !todo.done);
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any, args: { todoId: string }) => {
      handle.change((doc) => {
        const todo = doc.todos.find((t) => t.id === args.todoId);
        if (todo) {
          todo.done = true;
        }
      });
    },
  },
};

// Mark a todo item as completed (done)
export const listTodoItemsAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-complete',
  name: 'List Todo Items',
  icon: 'CheckSquare2',
  supportedDataTypes: ['todo'],
  module: {
    isApplicable: () => true,
    default: (handle: DocHandle<TodoDoc>, _repo: any) => {
      return handle.doc().todos;
    },
  },
};

// Toggle a todo item's completion status
export const toggleTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-toggle',
  name: 'Toggle Todo',
  icon: 'CheckSquare',
  supportedDataTypes: ['todo'],
  module: {
    argsSchema: (doc: TodoDoc) => {
      // Get list of todo IDs for the enum
      const todoOptions = (doc.todos || []).map((todo) => todo.id);

      return z.object({
        todoId: z
          .enum(todoOptions as [string, ...string[]])
          .describe('ID of the todo item to toggle'),
      });
    },
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.length > 0;
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any, args: { todoId: string }) => {
      handle.change((doc) => {
        const todo = doc.todos.find((t) => t.id === args.todoId);
        if (todo) {
          todo.done = !todo.done;
        }
      });
    },
  },
};

// Delete a todo item
export const deleteTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-delete',
  name: 'Delete Todo',
  icon: 'Trash2',
  supportedDataTypes: ['todo'],
  module: {
    argsSchema: (doc: TodoDoc) => {
      // Get list of todo IDs for the enum
      const todoOptions = (doc.todos || []).map((todo) => todo.id);

      return z.object({
        todoId: z
          .enum(todoOptions as [string, ...string[]])
          .describe('ID of the todo item to delete'),
      });
    },
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.length > 0;
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any, args: { todoId: string }) => {
      handle.change((doc) => {
        const index = doc.todos.findIndex((t) => t.id === args.todoId);
        if (index !== -1) {
          doc.todos.splice(index, 1);
        }
      });
    },
  },
};

// Update todo description
export const updateTodoDescriptionAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-update-description',
  name: 'Update Todo Description',
  icon: 'Edit',
  supportedDataTypes: ['todo'],
  module: {
    argsSchema: (doc: TodoDoc) => {
      const todoOptions = (doc.todos || []).map((todo) => todo.id);

      return z.object({
        todoId: z
          .enum(todoOptions as [string, ...string[]])
          .describe('ID of the todo item to update'),
        description: z.string().describe('New description for the todo item'),
      });
    },
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.length > 0;
    },
    default: (
      handle: DocHandle<TodoDoc>,
      _repo: any,
      args: { todoId: string; description: string }
    ) => {
      handle.change((doc) => {
        const todo = doc.todos.find((t) => t.id === args.todoId);
        if (todo) {
          todo.description = args.description;
        }
      });
    },
  },
};

// Clear all completed todos
export const clearCompletedTodosAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-clear-completed',
  name: 'Clear Completed Todos',
  icon: 'Eraser',
  supportedDataTypes: ['todo'],
  module: {
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.some((todo) => todo.done);
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any) => {
      handle.change((doc) => {
        doc.todos = doc.todos.filter((todo) => !todo.done);
      });
    },
  },
};

// Mark all todos as complete
export const markAllCompleteAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-mark-all-complete',
  name: 'Mark All Complete',
  icon: 'CheckCheck',
  supportedDataTypes: ['todo'],
  module: {
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.some((todo) => !todo.done);
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any) => {
      handle.change((doc) => {
        doc.todos.forEach((todo) => {
          todo.done = true;
        });
      });
    },
  },
};

// Mark all todos as incomplete
export const markAllIncompleteAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-mark-all-incomplete',
  name: 'Mark All Incomplete',
  icon: 'Square',
  supportedDataTypes: ['todo'],
  module: {
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.some((todo) => todo.done);
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any) => {
      handle.change((doc) => {
        doc.todos.forEach((todo) => {
          todo.done = false;
        });
      });
    },
  },
};

export const completeTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'todo-complete',
  name: 'Complete Todo',
  icon: 'Check',
  supportedDataTypes: ['todo'],
  module: {
    argsSchema: () => ({
      todoId: {
        type: 'string',
        description: 'The id of the todo to mark as complete',
      },
    }),
    isApplicable: (doc: TodoDoc) => {
      return doc.todos && doc.todos.some((todo) => !todo.done);
    },
    default: (handle: DocHandle<TodoDoc>, _repo: any, args: { todoId: string }) => {
      handle.change((doc) => {
        const todo = doc.todos.find((t) => t.id === args.todoId);
        if (todo) {
          todo.done = true;
        }
      });
    },
  },
};

// Update markdown document content
export const updateMarkdownContentAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'markdown-update-content',
  name: 'Update Markdown Content',
  icon: 'FileText',
  supportedDataTypes: ['markdown'],
  module: {
    argsSchema: () => {
      return z.object({
        content: z.string().describe('The new markdown content'),
      });
    },
    isApplicable: () => true,
    default: (handle: DocHandle<MarkdownDoc>, _repo: any, args: { content: string }) => {
      handle.change((doc) => {
        doc.content = args.content;
      });
    },
  },
};

export const actions: Plugin<any>[] = [
  addTodoAction,
  markTodoDoneAction,
  listTodoItemsAction,
  toggleTodoAction,
  deleteTodoAction,
  updateTodoDescriptionAction,
  clearCompletedTodosAction,
  markAllCompleteAction,
  markAllIncompleteAction,
];

export const markdownActions: Plugin<any>[] = [updateMarkdownContentAction];

// View file content
export const viewFileAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'file-view',
  name: 'View File',
  icon: 'Eye',
  supportedDataTypes: ['file'],
  module: {
    isApplicable: () => true,
    default: (handle: DocHandle<FileDoc>) => {
      return handle.doc().content;
    },
  },
};

// Replace file content
export const replaceFileContentAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'file-replace-content',
  name: 'Replace File Content',
  icon: 'FileEdit',
  supportedDataTypes: ['file'],
  module: {
    argsSchema: () => {
      return z.object({
        content: z.string().describe('The new content to replace the entire file'),
      });
    },
    isApplicable: () => true,
    default: (handle: DocHandle<FileDoc>, _repo: any, args: { content: string }) => {
      handle.change((doc) => {
        doc.content = args.content;
      });
    },
  },
};

export const fileActions: Plugin<any>[] = [viewFileAction, replaceFileContentAction];
