import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { VerificationContextDoc } from '../../workflow/types';
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

export type VerificationTargetResult = {
  kind: 'system' | 'artifact';
  label: string;
  artifactUrl?: AutomergeUrl;
  passed: boolean;
  constraints: VerificationConstraintResult[];
  violations: ConstraintViolation[];
  combinedSource: string;
};

export type VerificationEvaluation = {
  mode: 'spec' | 'validation';
  scope: 'system' | 'artifacts';
  title: string;
  description: string;
  requiredArtifacts: VerificationArtifactInput[];
  targetSummary: string;
  targetResults: VerificationTargetResult[];
  passed: boolean;
  systemPassed: boolean;
  artifactTargetsPassing: number;
  artifactTargetsTotal: number;
};

export function getVerificationMode(doc: VerificationContextDoc): 'spec' | 'validation' {
  return doc.viewMode ?? ((doc.requiredArtifactUrls?.length ?? doc.artifactUrls?.length ?? 0) > 0
    ? 'validation'
    : 'spec');
}

export function getVerificationScope(doc: VerificationContextDoc): 'system' | 'artifacts' {
  return doc.scope ?? 'system';
}

export function getRequiredArtifactUrls(doc: VerificationContextDoc): AutomergeUrl[] {
  return doc.requiredArtifactUrls ?? doc.artifactUrls ?? [];
}

export function getVerificationTitle(doc: VerificationContextDoc, verificationDoc?: DatalogDoc): string {
  return doc.title || verificationDoc?.title || 'Untitled verification';
}

export function getVerificationDescription(
  doc: VerificationContextDoc,
  verificationDoc?: DatalogDoc,
): string {
  if (doc.description) return doc.description;
  const firstComment = verificationDoc?.constraints?.find((constraint) => constraint.comment)?.comment;
  return firstComment || getVerificationTitle(doc, verificationDoc);
}

export function evaluateVerificationContext(
  doc: VerificationContextDoc,
  verificationDoc: DatalogDoc | undefined,
  artifacts: VerificationArtifactInput[],
): VerificationEvaluation | null {
  if (!verificationDoc) return null;

  const mode = getVerificationMode(doc);
  const scope = getVerificationScope(doc);
  const title = getVerificationTitle(doc, verificationDoc);
  const description = getVerificationDescription(doc, verificationDoc);
  const requiredArtifactUrls = getRequiredArtifactUrls(doc);
  const requiredArtifacts = requiredArtifactUrls.length > 0
    ? artifacts.filter((artifact) => requiredArtifactUrls.includes(artifact.url))
    : artifacts;

  if (mode === 'spec') {
    return {
      mode,
      scope,
      title,
      description,
      requiredArtifacts,
      targetSummary: scope === 'system' ? 'System requirement' : 'Artifact requirement',
      targetResults: [],
      passed: true,
      systemPassed: true,
      artifactTargetsPassing: 0,
      artifactTargetsTotal: 0,
    };
  }

  const targetResults =
    scope === 'system'
      ? [evaluateTarget('system', 'Whole system', undefined, verificationDoc, requiredArtifacts)]
      : requiredArtifacts.map((artifact) =>
          evaluateTarget('artifact', artifact.name, artifact.url, verificationDoc, [artifact]),
        );

  const artifactTargetResults = targetResults.filter((target) => target.kind === 'artifact');
  const artifactTargetsPassing = artifactTargetResults.filter((target) => target.passed).length;
  const systemPassed = targetResults.every((target) => target.passed);

  return {
    mode,
    scope,
    title,
    description,
    requiredArtifacts,
    targetSummary:
      scope === 'system'
        ? `Applies to ${requiredArtifacts.length} artifact${requiredArtifacts.length === 1 ? '' : 's'}`
        : requiredArtifacts.map((artifact) => artifact.name).join(', '),
    targetResults,
    passed: systemPassed,
    systemPassed,
    artifactTargetsPassing,
    artifactTargetsTotal: artifactTargetResults.length,
  };
}

function evaluateTarget(
  kind: 'system' | 'artifact',
  label: string,
  artifactUrl: AutomergeUrl | undefined,
  verificationDoc: DatalogDoc,
  artifacts: VerificationArtifactInput[],
): VerificationTargetResult {
  const facts = [
    ...(verificationDoc.facts ?? []),
    ...artifacts.flatMap((artifact) => artifact.doc?.facts ?? []),
  ];
  const datalog = new Datalog(facts, verificationDoc.rules ?? [], verificationDoc.constraints ?? []);
  const violations = datalog.checkConflicts();
  const constraints = (verificationDoc.constraints ?? []).map((constraint) => {
    const constraintViolations = violations.filter((violation) => violation.constraint === constraint);
    return {
      constraint,
      passed: constraintViolations.length === 0,
      violations: constraintViolations,
      label: constraint.comment || serializeConstraint(constraint),
    };
  });

  return {
    kind,
    label,
    artifactUrl,
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
    ...artifacts.map((artifact) => [
      `Artifact: ${artifact.name}`,
      buildDatalogSource(artifact.doc, artifact.name),
    ] as const),
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
