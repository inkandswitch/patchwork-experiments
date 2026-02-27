import "./App.css";
import { useState } from "react";
import { SchemaEditor } from "./SchemaEditor";
import { DatabaseView } from "./DatabaseView";

const DEFAULT_SCHEMA = `theory WeightedGraph {
  Vertex : Sort;
  Edge : [src: Vertex, tgt: Vertex, weight: Int] -> Prop;
  
  ax/unique_weight : forall v1 : Vertex, v2 : Vertex.
    [src: v1, tgt: v2, weight: n1] Edge /\\ [src: v1, tgt: v2, weight: n2] Edge
    |- n1 = n2;
}`;

type AppMode =
  | { type: "authoring" }
  | { type: "editing"; schema: string };

function App() {
  const [mode, setMode] = useState<AppMode>({ type: "authoring" });

  if (mode.type === "authoring") {
    return (
      <div className="app">
        <header>
          <h1>Geolog + Automerge Demo</h1>
        </header>
        <SchemaEditor
          defaultValue={DEFAULT_SCHEMA}
          onCreateDatabase={(schema) => setMode({ type: "editing", schema })}
        />
      </div>
    );
  }

  return (
    <DatabaseView
      schema={mode.schema}
      onEditSchema={() => setMode({ type: "authoring" })}
    />
  );
}

export default App;
