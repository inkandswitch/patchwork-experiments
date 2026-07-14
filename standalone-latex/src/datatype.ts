import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { updateText } from "@automerge/automerge";

export type LaTeXDoc = {
  content: string;
  /**
   * Output wiring. The EdgeHandle doc referenced here holds the persistent
   * source/target map; the LaTeX doc only remembers which edge is "its"
   * output edge so every device that opens this doc finds the same wiring.
   * V2 is PDF-only, so only `pdfEdgeUrl` is used; `edgeUrl` is kept for
   * back-compat with V1 docs that wired an HTML edge.
   */
  output?: {
    edgeUrl?: AutomergeUrl;
    pdfEdgeUrl?: AutomergeUrl;
  };
};

const DEFAULT_CONTENT = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{tikz}
\\usetikzlibrary{arrows.meta, positioning}

\\title{Diagrams and Identities}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{A Universal Property}

The product $A \\times B$ is determined, up to unique isomorphism, by a
universal property: for every object $Z$ with morphisms $f : Z \\to A$ and
$g : Z \\to B$, there is a \\emph{unique} mediating morphism
$\\langle f, g \\rangle$ making the diagram commute.

\\begin{center}
\\begin{tikzpicture}[>=Stealth, node distance=2.4cm,
                    every node/.style={font=\\small}]
  \\node (Z) {$Z$};
  \\node (P) [below=of Z] {$A \\times B$};
  \\node (A) [left=of P]  {$A$};
  \\node (B) [right=of P] {$B$};
  \\draw[->] (P) -- node[below] {$\\pi_A$} (A);
  \\draw[->] (P) -- node[below] {$\\pi_B$} (B);
  \\draw[->] (Z) -- node[above left]  {$f$} (A);
  \\draw[->] (Z) -- node[above right] {$g$} (B);
  \\draw[->, dashed] (Z) -- node[fill=white]
        {$\\exists!\\,\\langle f, g \\rangle$} (P);
\\end{tikzpicture}
\\end{center}

\\section{A Small Graph}

The complete graph $K_4$ has $\\binom{4}{2} = 6$ edges and is planar:

\\begin{center}
\\begin{tikzpicture}[every node/.style={circle, draw, minimum size=7mm,
                    font=\\small}, node distance=2cm]
  \\node (1) {$1$};
  \\node (2) [right=of 1] {$2$};
  \\node (3) [below=of 1] {$3$};
  \\node (4) [below=of 2] {$4$};
  \\draw (1) -- (2) -- (4) -- (3) -- (1);
  \\draw (1) -- (4);
  \\draw (2) -- (3);
\\end{tikzpicture}
\\end{center}

\\section{Identities}

For good measure, Euler's identity binds five constants in one stroke,
\\[
  e^{i\\pi} + 1 = 0,
\\]
and the Basel problem resolves just as tidily:
\\[
  \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}.
\\]

\\section{Notes}

\\begin{itemize}
  \\item This compiles with real TeX Live, so \\texttt{tikz},
        \\texttt{amsmath}, \\texttt{biblatex} and friends all work.
  \\item Edit the source and the PDF re-compiles as you type.
  \\item Press \\texttt{Cmd-J} to jump from the cursor to the PDF;
        click anywhere in the PDF to jump back to the source.
  \\item Open \\emph{Outputs} to publish the PDF to a live document you
        can drag into the sidebar.
\\end{itemize}

\\end{document}`;

export function getDocTitle(content: string): string {
  const match = content.match(/\\title\{([^}]*)\}/);
  const title = match?.[1]?.trim();
  return title || "Untitled";
}

export const LaTeXDatatype: DatatypeImplementation<LaTeXDoc> = {
  init(doc: LaTeXDoc) {
    doc.content = DEFAULT_CONTENT;
  },

  getTitle(doc: LaTeXDoc) {
    return getDocTitle(doc.content);
  },

  setTitle(doc: LaTeXDoc, title: string) {
    const hasTitle = doc.content.match(/\\title\{[^}]*\}/);
    if (hasTitle) {
      updateText(
        doc,
        ["content"],
        doc.content.replace(/\\title\{[^}]*\}/, `\\title{${title}}`)
      );
    }
  },
};
