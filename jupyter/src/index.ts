export const plugins = [
  {
    type: "patchwork:datatype",
    id: "jupyter-notebook",
    name: "Jupyter Notebook",
    icon: "NotebookPen",
    async load() {
      return (await import("./datatype")).JupyterNotebookDatatype
    },
  },
  {
    type: "patchwork:tool",
    id: "jupyter-notebook",
    name: "Jupyter Notebook",
    icon: "NotebookPen",
    supportedDatatypes: ["jupyter-notebook"],
    async load() {
      return (await import("./tool")).default
    },
  },
  {
    type: "patchwork:action",
    id: "jupyter-notebook-import",
    name: "Open as Jupyter Notebook",
    icon: "NotebookPen",
    supportedDatatypes: ["file"],
    async load() {
      return (await import("./import")).importIpynb
    },
  },
]
