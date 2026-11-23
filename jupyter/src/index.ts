export const plugins = [
  {
    type: "patchwork:datatype",
    id: "jupyter-notebook",
    name: "Jupyter Notebook",
    icon: "NotebookPen",
    async load() {
      return (await import("../shared/datatype")).JupyterNotebookDatatype
    },
  },
  // The datatype's own id, so Patchwork opens notebooks with it by default.
  {
    type: "patchwork:tool",
    id: "jupyter-notebook",
    name: "Jupyter Notebook",
    icon: "NotebookPen",
    supportedDatatypes: ["jupyter-notebook"],
    async load() {
      return (await import("../native/tool")).default
    },
  },
  {
    type: "patchwork:tool",
    id: "jupyter-notebook-lab",
    name: "Jupyter Notebook (JupyterLab)",
    icon: "NotebookPen",
    supportedDatatypes: ["jupyter-notebook"],
    async load() {
      return (await import("../lab/tool")).default
    },
  },
  {
    type: "patchwork:action",
    id: "jupyter-notebook-import",
    name: "Open as Jupyter Notebook",
    icon: "NotebookPen",
    supportedDatatypes: ["file"],
    async load() {
      return (await import("../shared/import")).importIpynb
    },
  },
]
