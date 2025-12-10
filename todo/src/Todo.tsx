import { AutomergeUrl } from '@automerge/automerge-repo';
import './styles.css';
import { useDocHandle, useDocument } from '@automerge/automerge-repo-react-hooks';
import { useState } from 'react';
import { toolify } from './react-util';

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
  const [doc, changeDoc] = useDocument<TodoDoc>(docUrl);
  const docHandle = useDocHandle<TodoDoc>(docUrl);
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

  const toggleTodo = (index: number) => {
    changeDoc((doc) => {
      doc.todos[index].done = !doc.todos[index].done;
    });
  };

  const updateDescription = (index: number, description: string) => {
    changeDoc((doc) => {
      doc.todos[index].description = description;
    });
  };

  // hack: ignore
  if (
    !docHandle ||
    !docHandle.doc() ||
    !docHandle.doc().todos ||
    !doc ||
    !doc.todos ||
    docHandle.doc().todos.length !== doc.todos.length
  ) {
    return null;
  }

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
          <TodoItem
            key={todo.id}
            todo={todo}
            onToggle={() => toggleTodo(index)}
            onChangeDescription={(description) => updateDescription(index, description)}
          />
        ))}
      </div>
    </div>
  );
};

type TodoItemProps = {
  todo: Todo;
  onToggle: () => void;
  onChangeDescription: (description: string) => void;
};

const TodoItem = ({ todo, onToggle, onChangeDescription }: TodoItemProps) => {
  return (
    <div className={'flex gap-2 items-center px-2 py-1' + (todo.done ? ' line-through' : '')}>
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
