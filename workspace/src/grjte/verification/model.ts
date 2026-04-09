import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { VerificationDoc } from './types';
import {
  Datalog,
  type ConstraintViolation,
  type StoredConstraint,
  type StoredFact,
  type StoredRule,
} from './datalog-eval';

export type DatalogDoc = {
  title?: string;
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
  draftText?: string;
};

export type VerificationArtifactInput = {
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
  targetKind: 'global' | 'scoped';
  targetLabel: string;
  passed: boolean;
  constraints: VerificationConstraintResult[];
  violations: ConstraintViolation[];
  combinedSource: string;
};

export function getVerificationTitle(
  verification: Pick<VerificationDoc, 'title'>,
  verificationDoc?: DatalogDoc,
): string {
  return verification.title || verificationDoc?.title || 'Untitled verification';
}

export function getVerificationDescription(
  verification: Pick<VerificationDoc, 'title' | 'description'>,
  verificationDoc?: DatalogDoc,
): string {
  if (verification.description) return verification.description;
  const firstComment = verificationDoc?.constraints?.find(
    (constraint) => constraint.comment,
  )?.comment;
  return firstComment || getVerificationTitle(verification, verificationDoc);
}

export function evaluateVerification(
  verification: Pick<VerificationDoc, 'title' | 'description'>,
  verificationDoc: DatalogDoc | undefined,
  artifacts: VerificationArtifactInput[],
  target: {
    kind: 'global' | 'scoped';
    label: string;
  },
): VerificationEvaluation | null {
  if (!verificationDoc) return null;

  const facts = [
    ...(verificationDoc.facts ?? []),
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
    combinedSource: buildCombinedSource(verificationDoc, artifacts),
  };
}

export function buildCombinedSource(
  verificationDoc: DatalogDoc,
  artifacts: VerificationArtifactInput[],
): string {
  const sections = [
    ['Verification', buildDatalogSource(verificationDoc)],
    ...artifacts.map(
      (artifact) =>
        [`Artifact: ${artifact.name}`, buildDatalogSource(artifact.doc, artifact.name)] as const,
    ),
  ];

  return sections
    .map(([label, content]) => `% ${label}\n${content}`)
    .filter((section) => !section.endsWith('\n'))
    .join('\n\n');
}

export function buildDatalogSource(doc: DatalogDoc | undefined, fallbackTitle?: string): string {
  if (!doc) return `% ${fallbackTitle || 'Document unavailable'}\n`;
  if (doc.draftText?.trim()) return doc.draftText.trim();

  const lines: string[] = [];
  if (doc.title || fallbackTitle) {
    lines.push(`% ${doc.title || fallbackTitle}`);
  }
  for (const fact of doc.facts ?? []) {
    lines.push(`${serializeFact(fact)}.`);
  }
  for (const rule of doc.rules ?? []) {
    lines.push(serializeRule(rule));
  }
  for (const constraint of doc.constraints ?? []) {
    lines.push(serializeConstraint(constraint));
  }
  return lines.join('\n');
}

function serializeFact(fact: StoredFact): string {
  return `${fact.pred}(${fact.args.join(', ')})`;
}

function serializeRule(rule: StoredRule): string {
  return `${serializeAtom(rule.head)} :- ${rule.body.map(serializeAtom).join(', ')}.`;
}

export function serializeConstraint(constraint: StoredConstraint): string {
  return `:- ${constraint.body.map(serializeAtom).join(', ')}.`;
}

function serializeAtom(atom: { pred: string; args: string[] }): string {
  if (!atom.args || atom.args.length === 0) return atom.pred;
  return `${atom.pred}(${atom.args.join(', ')})`;
}
