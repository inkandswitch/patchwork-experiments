import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import { VerifiedTodoDoc } from './verified/TodoDomain';

export const VerifiedTodoDatatype: DatatypeImplementation<VerifiedTodoDoc> = {
  init: (doc: VerifiedTodoDoc) => {
    doc.title = 'My Verified Todo List';
    doc.items = {};
  },
  getTitle(doc: VerifiedTodoDoc) {
    return doc.title || 'Verified Todo List';
  },
};
