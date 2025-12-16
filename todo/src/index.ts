import { Plugin } from '@inkandswitch/patchwork-plugins';
import { actions } from './actions';

console.log('todo', 2);

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
  ...actions,
];
