import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  Datalog,
  serializeConstraint,
  serializeFact,
  serializeRule,
  type ConstraintViolation,
} from "../datalog-runtime";
import type {
  VerificationDoc,
  DatalogDoc,
  StoredConstraint,
} from "../spec/types";

export type VerificationArtifactInput = {
  url: AutomergeUrl;
  name: string;
  doc?: DatalogDoc;
  specDocUrls?: AutomergeUrl[];
};

export type VerificationDataInput = {
  url: AutomergeUrl;
  name: string;
  doc?: DatalogDoc;
};

export type VerificationConstraintResult = {
  constraint: StoredConstraint;
  passed: boolean;
  violations: ConstraintViolation[];
  label: string;
};

export type VerificationEvaluation = {
  title: string;
  description: string;
  targetKind: "global" | "scoped";
  targetLabel: string;
  passed: boolean;
  constraints: VerificationConstraintResult[];
  violations: ConstraintViolation[];
  combinedSource: string;
};

export function getVerificationTitle(
  verification: Pick<VerificationDoc, "title">,
  verificationDoc?: DatalogDoc,
): string {
  return (
    verification.title || verificationDoc?.title || "Untitled verification"
  );
}

export function getVerificationDescription(
  verification: Pick<VerificationDoc, "title" | "description">,
  verificationDoc?: DatalogDoc,
): string {
  if (verification.description) return verification.description;
  const firstComment = verificationDoc?.constraints?.find(
    (constraint) => constraint.comment,
  )?.comment;
  return firstComment || getVerificationTitle(verification, verificationDoc);
}

export function evaluateVerification(
  verification: Pick<VerificationDoc, "title" | "description">,
  verificationDoc: DatalogDoc | undefined,
  dataDocs: VerificationDataInput[],
  artifacts: VerificationArtifactInput[],
  target: {
    kind: "global" | "scoped";
    label: string;
  },
): VerificationEvaluation | null {
  if (!verificationDoc) return null;

  const facts = [
    ...(verificationDoc.facts ?? []),
    ...dataDocs.flatMap((dataDoc) => dataDoc.doc?.facts ?? []),
    ...artifacts.flatMap((artifact) => artifact.doc?.facts ?? []),
  ];
  const datalog = new Datalog(
    facts,
    verificationDoc.rules ?? [],
    verificationDoc.constraints ?? [],
  );
  const violations = datalog.checkConflicts();
  const constraints = (verificationDoc.constraints ?? []).map((constraint) => {
    const constraintViolations = violations.filter(
      (violation) => violation.constraint === constraint,
    );
    return {
      constraint,
      passed: constraintViolations.length === 0,
      violations: constraintViolations,
      label: constraint.comment || serializeConstraint(constraint),
    };
  });

  return {
    title: getVerificationTitle(verification, verificationDoc),
    description: getVerificationDescription(verification, verificationDoc),
    targetKind: target.kind,
    targetLabel: target.label,
    passed: violations.length === 0,
    constraints,
    violations,
    combinedSource: buildCombinedSource(verificationDoc, dataDocs, artifacts),
  };
}

export function buildCombinedSource(
  verificationDoc: DatalogDoc,
  dataDocs: VerificationDataInput[],
  artifacts: VerificationArtifactInput[],
): string {
  const sections = [
    ["Verification", buildDatalogSource(verificationDoc)],
    ...dataDocs.map(
      (dataDoc) =>
        [
          `Spec Data: ${dataDoc.name}`,
          buildDatalogSource(dataDoc.doc, dataDoc.name),
        ] as const,
    ),
    ...artifacts.map(
      (artifact) =>
        [
          `Artifact: ${artifact.name}`,
          buildDatalogSource(artifact.doc, artifact.name),
        ] as const,
    ),
  ];

  return sections
    .map(([label, content]) => `% ${label}\n${content}`)
    .filter((section) => !section.endsWith("\n"))
    .join("\n\n");
}

export function buildDatalogSource(
  doc: DatalogDoc | undefined,
  fallbackTitle?: string,
): string {
  if (!doc) return `% ${fallbackTitle || "Document unavailable"}\n`;
  if (doc.draftText?.trim()) return doc.draftText.trim();

  const lines: string[] = [];
  if (doc.title || fallbackTitle) {
    lines.push(`% ${doc.title || fallbackTitle}`);
  }
  for (const fact of doc.facts ?? []) {
    lines.push(serializeFact(fact));
  }
  for (const rule of doc.rules ?? []) {
    lines.push(serializeRule(rule));
  }
  for (const constraint of doc.constraints ?? []) {
    lines.push(serializeConstraint(constraint));
  }
  return lines.join("\n");
}
