import { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocHandle, useDocument } from '@automerge/automerge-repo-react-hooks';
import { annotations } from '@inkandswitch/annotations-context';
import { Diff } from '@inkandswitch/annotations-diff';
import { ref, Ref, RefOfType } from '@inkandswitch/patchwork-refs';
import { useSubscribe } from '@inkandswitch/subscribables-react';
import { useEffect, useState } from 'react';
import { toolify } from './react-util';
import './styles.css';

type Todo = {
  id: string;
  description: string;
  done: boolean;
};

export type TodoDoc = {
  title: string;
  todos: Todo[];
};

export const TodoEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc, changeDoc] = useDocument<TodoDoc>(docUrl, { suspense: true });
  const docHandle = useDocHandle<TodoDoc>(docUrl, { suspense: true });
  const [text, setText] = useState('');

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
    <div className="p-4  h-full">
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
          <TodoItem key={todo.id} todoRef={ref(docHandle, 'todos', index) as RefOfType<Todo>} />
        ))}
      </div>
    </div>
  );
};

type TodoItemProps = {
  todoRef: RefOfType<Todo>;
};

const TodoItem = ({ todoRef }: TodoItemProps) => {
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

  // Query diff annotations reactively
  const todoAnnotations = useSubscribe(annotations.onRef(todoRef as Ref));

  useEffect(() => {
    console.log('todoAnnotations', todoAnnotations);
  }, [todoAnnotations]);

  const diffType = todoAnnotations?.lookup(Diff)?.type;

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
        `flex gap-2 items-center px-2 py-1 ${diffClass}` + (todo.done ? ' line-through' : '')
      }
    >
      <input type="checkbox" checked={todo.done} onChange={onToggle} />
      <input
        className="flex-1"
        value={todo.description}
        onChange={(e) => onChangeDescription(e.target.value)}
      />
    </div>
  );
};

export const renderTodoEditor = toolify(TodoEditor);
