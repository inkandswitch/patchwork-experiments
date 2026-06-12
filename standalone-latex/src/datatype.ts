import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { updateText } from "@automerge/automerge";

export type LaTeXDoc = {
  content: string;
  /**
   * Output wiring. The EdgeHandle docs referenced here hold the persistent
   * source/target maps; the LaTeX doc only remembers which edges are "its"
   * output edges so every device that opens this doc finds the same wiring.
   * HTML and PDF flow through separate edges since they carry different
   * values.
   */
  output?: {
    edgeUrl?: AutomergeUrl;
    pdfEdgeUrl?: AutomergeUrl;
  };
};

const DEFAULT_CONTENT = `\\documentclass{article}
\\title{A Field Guide to Plain \\TeX{}nique}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Identities}

The golden ratio $\\varphi = \\frac{1 + \\sqrt{5}}{2}$ is the unique
positive number satisfying $\\varphi^2 = \\varphi + 1$, while Euler's
identity binds five fundamental constants in one stroke:
\\[
  e^{i\\pi} + 1 = 0.
\\]
For $|x| < 1$ the geometric series collapses to a closed form,
\\[
  \\sum_{n=0}^{\\infty} x^n = \\frac{1}{1 - x},
\\]
and differentiating both sides is the classic trick for summing
$\\sum n x^n$.

\\section{Integrals}

The Gaussian integral has no elementary antiderivative, and yet
\\[
  \\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}.
\\]
Euler's solution to the Basel problem is just as tidy:
\\[
  \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}.
\\]

\\section{Structure}

A rotation of the plane by an angle $\\theta$ is the linear map
\\[
  \\left( \\begin{array}{cc}
    \\cos\\theta & -\\sin\\theta \\\\
    \\sin\\theta & \\cos\\theta
  \\end{array} \\right)
  \\left( \\begin{array}{c} x \\\\ y \\end{array} \\right),
\\]
which preserves length since
$\\cos^2\\theta + \\sin^2\\theta = 1$. Its eigenvalues
$e^{\\pm i\\theta}$ live on the unit circle --- rotation stretches
nothing.

\\section{Notes}

\\begin{itemize}
  \\item Everything here is plain \\LaTeX{} --- no packages required.
  \\item Edit the source and the preview re-renders as you type.
  \\item Open \\emph{Outputs} to publish the HTML or PDF to a live
        document you can drag into the sidebar.
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
