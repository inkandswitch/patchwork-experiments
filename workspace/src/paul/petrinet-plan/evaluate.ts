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

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
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
  documentsFolderUrl: string,
): Promise<PerVerificationResult[]> {
  const specHandle = await repo.find<SpecDoc>(subSpecUrl as AutomergeUrl);
  const specDoc = await specHandle.doc();
  const verificationUrls = specDoc?.spec?.verificationUrls ?? [];
  if (verificationUrls.length === 0) return [];

  const docUrls = await getDocUrlsFromFolder(repo, documentsFolderUrl);
  const solutionFacts = await collectDatalogFacts(repo, docUrls);

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
  documentsFolderUrl: string,
): Promise<EvalResult> {
  const specHandle = await repo.find<SpecDoc>(subSpecUrl as AutomergeUrl);
  const specDoc = await specHandle.doc();
  const verificationUrls = specDoc?.spec?.verificationUrls ?? [];
  if (verificationUrls.length === 0) return { valid: true, violations: [] };

  const docUrls = await getDocUrlsFromFolder(repo, documentsFolderUrl);
  const solutionFacts = await collectDatalogFacts(repo, docUrls);

  const allViolations: ConstraintViolation[] = [];
  for (const vUrl of verificationUrls) {
    const violations = await checkVerificationDoc(repo, vUrl, solutionFacts);
    allViolations.push(...violations);
  }

  return { valid: allViolations.length === 0, violations: allViolations };
}

export async function evaluateVerificationsAgainstFolders(
  repo: Repo,
  verificationUrls: string[],
  folderUrls: string[],
): Promise<PerVerificationResult[]> {
  if (verificationUrls.length === 0) return [];

  const allDocUrls: string[] = [];
  for (const folderUrl of folderUrls) {
    const docUrls = await getDocUrlsFromFolder(repo, folderUrl);
    allDocUrls.push(...docUrls);
  }

  const solutionFacts = await collectDatalogFacts(repo, allDocUrls);

  const results: PerVerificationResult[] = [];
  for (const vUrl of verificationUrls) {
    const violations = await checkVerificationDoc(repo, vUrl as AutomergeUrl, solutionFacts);
    results.push({
      verificationUrl: vUrl,
      valid: violations.length === 0,
      violations,
    });
  }
  return results;
}

async function getDocUrlsFromFolder(repo: Repo, folderUrl: string): Promise<string[]> {
  if (!folderUrl) return [];
  const handle = await repo.find<FolderDoc>(folderUrl as AutomergeUrl);
  const doc = await handle.doc();
  if (!doc?.docs) return [];
  return doc.docs.map((d) => d.url as string);
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

async function resolveDatalogDoc(
  repo: Repo,
  verificationUrl: AutomergeUrl,
): Promise<Partial<DatalogDoc> | null> {
  const handle = await repo.find<Partial<DatalogDoc> & { docUrl?: AutomergeUrl }>(verificationUrl);
  const doc = await handle.doc();
  if (!doc) return null;

  if (doc.docUrl) {
    const datalogHandle = await repo.find<Partial<DatalogDoc>>(doc.docUrl);
    return await datalogHandle.doc();
  }

  if (doc.constraints || doc.facts) return doc;
  return null;
}

async function checkVerificationDoc(
  repo: Repo,
  verificationUrl: AutomergeUrl,
  candidateFacts: StoredFact[],
): Promise<ConstraintViolation[]> {
  const doc = await resolveDatalogDoc(repo, verificationUrl);
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
