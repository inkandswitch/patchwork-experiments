import { type Plugin } from '@inkandswitch/patchwork-plugins';
import { type DocHandle } from '@automerge/automerge-repo';
import { z } from 'zod';
import { VerifiedTodoDoc, visibleItems } from './bridge';
import {
  addTodo,
  deleteTodo,
  midpointPosition,
  moveTodo,
  setTitle as bridgeSetTitle,
  toggleTodo,
} from './bridge';

const DT = 'verified-todo-list';

// Add a new todo item. The bridge mints a globally unique id via
// crypto.randomUUID(), satisfying the Dafny precondition that the id is
// fresh (iid !in d.items).
export const addTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-add',
  name: 'Add Todo',
  icon: 'Plus',
  supportedDatatypes: [DT],
  module: {
    argsSchema: () =>
      z.object({
        text: z.string().describe('Text of the todo item'),
      }),
    default: (
      handle: DocHandle<VerifiedTodoDoc>,
      _repo: any,
      args: { text: string },
    ) => {
      const id = addTodo(handle, args.text);
      return { id };
    },
  },
};

export const toggleTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-toggle',
  name: 'Toggle Todo',
  icon: 'CheckSquare',
  supportedDatatypes: [DT],
  module: {
    argsSchema: (doc: VerifiedTodoDoc) => {
      const options = Object.keys(doc.items ?? {});
      return z.object({
        todoId: (options.length > 0
          ? z.enum(options as [string, ...string[]])
          : z.string()
        ).describe('ID of the todo item to toggle'),
      });
    },
    isApplicable: (doc: VerifiedTodoDoc) => Object.keys(doc.items ?? {}).length > 0,
    default: (
      handle: DocHandle<VerifiedTodoDoc>,
      _repo: any,
      args: { todoId: string },
    ) => {
      const current = handle.doc()?.items?.[args.todoId];
      if (!current) return;
      toggleTodo(handle, args.todoId, !current.done);
    },
  },
};

export const markTodoDoneAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-complete',
  name: 'Mark Todo Done',
  icon: 'CheckSquare2',
  supportedDatatypes: [DT],
  module: {
    argsSchema: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      const options = Object.keys(items).filter((k) => !items[k].done && !items[k].deleted);
      return z.object({
        todoId: (options.length > 0
          ? z.enum(options as [string, ...string[]])
          : z.string()
        ).describe('ID of the todo item to mark done'),
      });
    },
    isApplicable: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      return Object.keys(items).some((k) => !items[k].done && !items[k].deleted);
    },
    default: (
      handle: DocHandle<VerifiedTodoDoc>,
      _repo: any,
      args: { todoId: string },
    ) => {
      toggleTodo(handle, args.todoId, true);
    },
  },
};

export const deleteTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-delete',
  name: 'Delete Todo',
  icon: 'Trash2',
  supportedDatatypes: [DT],
  module: {
    argsSchema: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      const options = Object.keys(items).filter((k) => !items[k].deleted);
      return z.object({
        todoId: (options.length > 0
          ? z.enum(options as [string, ...string[]])
          : z.string()
        ).describe('ID of the todo item to delete (soft delete)'),
      });
    },
    isApplicable: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      return Object.keys(items).some((k) => !items[k].deleted);
    },
    default: (
      handle: DocHandle<VerifiedTodoDoc>,
      _repo: any,
      args: { todoId: string },
    ) => {
      deleteTodo(handle, args.todoId);
    },
  },
};

// Move a todo to a specific 0-based position in the visible list. This is
// the action whose non-duplication behavior is the focus of the Dafny
// proof: it performs an LWW update to the `position` field rather than a
// delete+insert.
export const moveTodoAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-move',
  name: 'Reorder Todo',
  icon: 'ArrowUpDown',
  supportedDatatypes: [DT],
  module: {
    argsSchema: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      const options = Object.keys(items).filter((k) => !items[k].deleted);
      const visibleCount = options.length;
      return z.object({
        todoId: (options.length > 0
          ? z.enum(options as [string, ...string[]])
          : z.string()
        ).describe('ID of the todo item to move'),
        toIndex: z
          .number()
          .int()
          .min(0)
          .max(Math.max(0, visibleCount - 1))
          .describe(
            '0-based index in the visible list where the item should end up',
          ),
      });
    },
    isApplicable: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      return Object.keys(items).some((k) => !items[k].deleted);
    },
    default: (
      handle: DocHandle<VerifiedTodoDoc>,
      _repo: any,
      args: { todoId: string; toIndex: number },
    ) => {
      const current = handle.doc();
      if (!current) return;
      const visible = visibleItems(current);
      const fromIdx = visible.findIndex((v) => v.key === args.todoId);
      if (fromIdx === -1) return;
      const reordered = [...visible];
      const [moved] = reordered.splice(fromIdx, 1);
      const clampedTo = Math.max(0, Math.min(args.toIndex, reordered.length));
      reordered.splice(clampedTo, 0, moved);
      const before = reordered[clampedTo - 1]?.item.position;
      const after = reordered[clampedTo + 1]?.item.position;
      const newPos = midpointPosition(before, after);
      moveTodo(handle, args.todoId, newPos);
    },
  },
};

export const listTodosAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-list',
  name: 'List Todo Items',
  icon: 'List',
  supportedDatatypes: [DT],
  module: {
    isApplicable: () => true,
    default: (handle: DocHandle<VerifiedTodoDoc>) => {
      const d = handle.doc();
      if (!d) return [];
      return visibleItems(d).map((v) => ({
        id: v.key,
        text: v.item.text,
        done: v.item.done,
        position: v.item.position,
      }));
    },
  },
};

export const setTitleAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-set-title',
  name: 'Set Title',
  icon: 'Edit',
  supportedDatatypes: [DT],
  module: {
    argsSchema: () =>
      z.object({
        title: z.string().describe('The new title for the todo list'),
      }),
    default: (
      handle: DocHandle<VerifiedTodoDoc>,
      _repo: any,
      args: { title: string },
    ) => {
      bridgeSetTitle(handle, args.title);
    },
  },
};

export const clearCompletedTodosAction: Plugin<any> = {
  type: 'patchwork:action',
  id: 'verified-todo-clear-completed',
  name: 'Clear Completed Todos',
  icon: 'Eraser',
  supportedDatatypes: [DT],
  module: {
    isApplicable: (doc: VerifiedTodoDoc) => {
      const items = doc.items ?? {};
      return Object.keys(items).some((k) => items[k].done && !items[k].deleted);
    },
    default: (handle: DocHandle<VerifiedTodoDoc>) => {
      const d = handle.doc();
      if (!d) return;
      const toDelete = Object.keys(d.items ?? {}).filter(
        (k) => d.items[k].done && !d.items[k].deleted,
      );
      for (const k of toDelete) deleteTodo(handle, k);
    },
  },
};

export const actions: Plugin<any>[] = [
  addTodoAction,
  toggleTodoAction,
  markTodoDoneAction,
  deleteTodoAction,
  moveTodoAction,
  listTodosAction,
  setTitleAction,
  clearCompletedTodosAction,
];
