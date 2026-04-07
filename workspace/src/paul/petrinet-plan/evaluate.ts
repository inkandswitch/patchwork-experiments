import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import {
  evaluateWithProvenance,
  checkConstraints,
  factKey,
} from '../../../../datalog/src/datalog';
import type {
  ConstraintViolation,
  StoredFact,
  StoredRule,
  StoredConstraint,
} from '../../../../datalog/src/datalog';

type Spec = {
  goal: string;
  verificationUrls: AutomergeUrl[];
  subSpecUrls?: AutomergeUrl[];
  filesFolderUrl?: AutomergeUrl;
};

type SpecDoc = {
  spec: Spec;
};

type DatalogDoc = {
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
};

export type EvalResult = {
  valid: boolean;
  violations: ConstraintViolation[];
};

export type PerVerificationResult = {
  verificationUrl: string;
  valid: boolean;
  violations: ConstraintViolation[];
};

export async function evaluateSolutionPerVerification(
  repo: Repo,
  subSpecUrl: string,
  solutionDocUrl: string,
): Promise<PerVerificationResult[]> {
  const specHandle = await repo.find<SpecDoc>(subSpecUrl as AutomergeUrl);
  const specDoc = await specHandle.doc();
  const verificationUrls = specDoc?.spec?.verificationUrls ?? [];
  if (verificationUrls.length === 0) return [];

  const solutionFacts = await collectDatalogFacts(repo, [solutionDocUrl]);

  const results: PerVerificationResult[] = [];
  for (const vUrl of verificationUrls) {
    const violations = await checkVerificationDoc(repo, vUrl, solutionFacts);
    results.push({
      verificationUrl: vUrl as string,
      valid: violations.length === 0,
      violations,
    });
  }
  return results;
}

export async function evaluateSolution(
  repo: Repo,
  subSpecUrl: string,
  solutionDocUrl: string,
): Promise<EvalResult> {
  const specHandle = await repo.find<SpecDoc>(subSpecUrl as AutomergeUrl);
  const specDoc = await specHandle.doc();
  const verificationUrls = specDoc?.spec?.verificationUrls ?? [];
  if (verificationUrls.length === 0) return { valid: true, violations: [] };

  const solutionFacts = await collectDatalogFacts(repo, [solutionDocUrl]);

  const allViolations: ConstraintViolation[] = [];
  for (const vUrl of verificationUrls) {
    const violations = await checkVerificationDoc(repo, vUrl, solutionFacts);
    allViolations.push(...violations);
  }

  return { valid: allViolations.length === 0, violations: allViolations };
}

async function collectDatalogFacts(repo: Repo, docUrls: string[]): Promise<StoredFact[]> {
  const facts: StoredFact[] = [];
  for (const url of docUrls) {
    if (!url) continue;
    const handle = await repo.find<Partial<DatalogDoc>>(url as AutomergeUrl);
    const doc = await handle.doc();
    if (doc?.facts && Array.isArray(doc.facts)) {
      facts.push(...doc.facts);
    }
  }
  return facts;
}

async function checkVerificationDoc(
  repo: Repo,
  verificationUrl: AutomergeUrl,
  candidateFacts: StoredFact[],
): Promise<ConstraintViolation[]> {
  const handle = await repo.find<Partial<DatalogDoc>>(verificationUrl);
  const doc = await handle.doc();
  if (!doc) return [];

  const vFacts = doc.facts ?? [];
  const vRules = doc.rules ?? [];
  const vConstraints = doc.constraints ?? [];
  if (vConstraints.length === 0) return [];

  const mergedFacts = [...candidateFacts, ...vFacts];
  const baseFacts = new Set(mergedFacts.map(factKey));
  const { db, provenance } = evaluateWithProvenance(mergedFacts, vRules);
  return checkConstraints(db, vConstraints, provenance, baseFacts);
}
