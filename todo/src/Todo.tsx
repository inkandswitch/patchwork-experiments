import { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocHandle, useDocument } from '@automerge/automerge-repo-react-hooks';
import { AnnotationSet } from '@inkandswitch/annotations';
import { CommentThread, createComment } from '@inkandswitch/annotations-comments';
import { annotations } from '@inkandswitch/annotations-context';
import { Diff } from '@inkandswitch/annotations-diff';
import { IsSelected, isSelected } from '@inkandswitch/annotations-selection';
import { ref, Ref, RefOfType } from '@inkandswitch/patchwork-refs';
import { useSubscribe } from '@inkandswitch/subscribables-react';
import { MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import './styles.css';

type Todo = {
  id: string;
  description: string;
  done: boolean;
};

export type TodoDoc = {
  '@patchwork': { type: 'todo' };
  title: string;
  todos: Todo[];
};

export const TodoEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc, changeDoc] = useDocument<TodoDoc>(docUrl, { suspense: true });
  const docHandle = useDocHandle<TodoDoc>(docUrl, { suspense: true });
  const [text, setText] = useState('');

  // Shared selection annotations for all todo items
  const selectionAnnotations = useMemo(() => new AnnotationSet(), []);

  useEffect(() => {
    annotations.add(selectionAnnotations);
    return () => {
      annotations.remove(selectionAnnotations);
    };
  }, [selectionAnnotations]);

  const addTodo = () => {
    if (text.trim() === '') return;
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      description: text,
      done: false,
    };
    changeDoc((doc) => {
      doc.todos.push(newTodo);
    });
    setText('');
  };

  const setTitle = (title: string) => {
    changeDoc((doc) => {
      doc.title = title;
    });
  };

  return (
    <div className="todo">
      <div className="sheet">
        <div className="title">
          <input
            type="text"
            value={doc.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
          />
        </div>
        <div className="compose">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a new todo"
          />
          <button onClick={addTodo}>Add</button>
        </div>
        {doc.todos.map((todo, index) => (
          <TodoItem
            key={todo.id}
            todoRef={ref(docHandle, 'todos', index) as RefOfType<Todo>}
            selectionAnnotations={selectionAnnotations}
          />
        ))}
      </div>
    </div>
  );
};

type TodoItemProps = {
  todoRef: RefOfType<Todo>;
  selectionAnnotations: AnnotationSet;
};

const TodoItem = ({ todoRef, selectionAnnotations }: TodoItemProps) => {
  const todo = todoRef.value();

  const onToggle = () => {
    todoRef.change((t) => {
      t.done = !t.done;
    });
  };

  const onChangeDescription = (description: string) => {
    todoRef.change((t) => {
      t.description = description;
    });
  };

  // Query annotations reactively
  const todoAnnotations = useSubscribe(annotations.onRef(todoRef as Ref));

  const diffType = todoAnnotations?.lookup(Diff)?.type;

  // Get all CommentThread annotations on this todo
  const commentThreadRefs = useMemo(() => {
    if (!todoAnnotations) return [];
    return todoAnnotations.lookupAll(CommentThread);
  }, [todoAnnotations]);

  // Count actual comments across all threads
  const commentCount = useMemo(() => {
    return commentThreadRefs.reduce((total, threadRef) => {
      const thread = threadRef.value();
      return total + (thread?.comments?.length ?? 0);
    }, 0);
  }, [commentThreadRefs]);
  const hasComments = commentCount > 0;

  // Check if this todo is selected
  const isThisSelected = useSubscribe(useMemo(() => isSelected(todoRef as Ref), [todoRef]));

  const handleCommentClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (hasComments) {
      // If there are existing comments, select the ref to show them
      selectionAnnotations.clear();
      selectionAnnotations.add(todoRef as Ref, IsSelected(true));
    } else {
      // Create a new comment thread on this todo item
      const accountDoc = (window as any).accountDocHandle?.doc?.();
      const contactUrl = accountDoc?.contactUrl;
      if (!contactUrl) {
        console.warn('Cannot create comment: no contactUrl available');
        return;
      }
      createComment({
        refs: [todoRef as Ref],
        content: '',
        contactUrl,
      });
      // Select the ref to open the comment panel
      selectionAnnotations.clear();
      selectionAnnotations.add(todoRef as Ref, IsSelected(true));
    }
  };

  if (!todo) return null;

  return (
    <div
      className="item"
      data-diff={diffType}
      data-done={todo.done || undefined}
      data-selected={isThisSelected || undefined}
    >
      <input type="checkbox" checked={todo.done} onChange={onToggle} />
      <input
        type="text"
        value={todo.description}
        onChange={(e) => onChangeDescription(e.target.value)}
      />
      <button
        className="comment-button"
        data-has-comments={hasComments || undefined}
        onClick={handleCommentClick}
        title={
          hasComments ? `${commentCount} comment${commentCount > 1 ? 's' : ''}` : 'Add comment'
        }
      >
        <MessageCircle size={16} />
        {hasComments && <span className="comment-count">{commentCount}</span>}
      </button>
    </div>
  );
};

export function renderTodoEditor(
  handle: { url: AutomergeUrl },
  element: ToolElement
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <TodoEditor docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
