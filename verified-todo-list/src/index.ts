import { Plugin } from '@inkandswitch/patchwork-plugins';
import { actions } from './actions';

console.log('verified-todo-list', 1);

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool',
    id: 'verified-todo-list',
    name: 'Verified Todo List',
    icon: 'ShieldCheck',
    supportedDatatypes: ['verified-todo-list'],
    async load() {
      const { renderVerifiedTodoListEditor } = await import('./VerifiedTodoList');
      return renderVerifiedTodoListEditor;
    },
  },
  {
    type: 'patchwork:datatype',
    id: 'verified-todo-list',
    name: 'Verified Todo List',
    icon: 'ShieldCheck',
    async load() {
      const { VerifiedTodoDatatype } = await import('./datatype');
      return VerifiedTodoDatatype;
    },
  },
  ...actions,
];
