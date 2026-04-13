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
import { toolify } from './react-util';
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
    <div className="p-4  h-full overflow-auto">
      <div className="max-w-[400px] mx-auto flex flex-col gap-2 dark:bg-base-300 bg-base-100 rounded-md p-4">
        <div className="text-2xl font-bold">
          <input
            type="text"
            value={doc.title}
            className="w-full"
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            className="border-2 border-gray-300 rounded-md p-2 flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a new todo"
          />
          <button className="bg-blue-500 text-white rounded-md p-2" onClick={addTodo}>
            Add
          </button>
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
  const [isHovered, setIsHovered] = useState(false);

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

  // Visual diff indicators
  const diffStyles: Record<string, string> = {
    added: 'bg-green-100 dark:bg-green-900/30 border-l-4 border-green-500',
    changed: 'bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500',
    deleted: 'bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500 line-through opacity-60',
  };

  const diffClass = diffType ? diffStyles[diffType] : '';

  if (!todo) return null;

  return (
    <div
      className={
        `group flex gap-2 items-center px-2 py-1 rounded ${diffClass}` +
        (todo.done ? ' line-through' : '') +
        (isThisSelected ? ' outline-2 outline-blue-500' : '')
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <input type="checkbox" checked={todo.done} onChange={onToggle} />
      <input
        className="flex-1"
        value={todo.description}
        onChange={(e) => onChangeDescription(e.target.value)}
      />
      <button
        onClick={handleCommentClick}
        className={`
          flex items-center gap-1 p-1 rounded transition-opacity duration-150
          hover:bg-gray-200 dark:hover:bg-gray-700
          ${hasComments ? 'opacity-100 text-blue-500' : isHovered ? 'opacity-60' : 'opacity-0'}
        `}
        title={
          hasComments ? `${commentCount} comment${commentCount > 1 ? 's' : ''}` : 'Add comment'
        }
      >
        <MessageCircle size={16} />
        {hasComments && <span className="text-xs font-medium">{commentCount}</span>}
      </button>
    </div>
  );
};

export const renderTodoEditor = toolify(TodoEditor);
