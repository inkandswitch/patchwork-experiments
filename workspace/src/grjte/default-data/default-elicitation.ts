import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { ElicitationDoc } from '../../types';

type CsvDoc = {
  '@patchwork': { type: 'csv' };
  title?: string;
  content: string;
};

type MarkdownDoc = {
  '@patchwork': { type: 'markdown' };
  title?: string;
  content: string;
};

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

function createCsvDoc(repo: Repo, title: string, content: string): AutomergeUrl {
  const handle = repo.create<CsvDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'csv' };
    d.title = title;
    d.content = content;
  });
  return handle.url;
}

function createMarkdownDoc(repo: Repo, title: string, content: string): AutomergeUrl {
  const handle = repo.create<MarkdownDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'markdown' };
    d.title = title;
    d.content = content;
  });
  return handle.url;
}

export function createDefaultElicitation(repo: Repo): { elicitationDocUrl: AutomergeUrl } {
  const staffRosterUrl = createCsvDoc(
    repo,
    'Staff Roster',
    `Name,Ward,Band,Role,Competencies,Notes
Sarah Chen,AMU,7,Ward Manager,acute_assessment,Supernumerary
James Okafor,AMU,6,Senior Staff Nurse,acute_assessment,
Priya Sharma,AMU,5,Staff Nurse,acute_assessment,
Emily Davies,AMU,5,Staff Nurse,acute_assessment,
Mike Thompson,AMU,3,Senior HCA,,
Rachel Green,Ward 6,6,Senior Staff Nurse,,
Tom Williams,Ward 6,5,Staff Nurse,,
Aisha Begum,Ward 6,5,Staff Nurse,,
Dan Murphy,Ward 6,3,Senior HCA,,
Lisa Brown,Ward 6,2,HCA,,`,
  );

  const wardInfoUrl = createCsvDoc(
    repo,
    'Ward Information',
    `Ward,Beds,Type
AMU,20,Acute Medical
Ward 6,28,General Medicine`,
  );

  const shiftDefsUrl = createCsvDoc(
    repo,
    'Shift Definitions',
    `Shift Type,Start,End,Hours
Long Day,07:30,20:00,12
Long Night,19:30,08:00,12`,
  );

  const wtdUrl = createMarkdownDoc(
    repo,
    'Working Time Directive — Key Provisions',
    `# Working Time Directive (WTD) — Key Provisions for NHS Rota Planning

## Maximum Weekly Hours
- Average **48 hours per week** maximum, calculated over a **17-week reference period**
- Individual staff may voluntarily opt out in writing; opt-out is revocable at any time

## Rest Between Shifts
- Minimum **11 consecutive hours** rest in each 24-hour period

## Weekly Rest
- Minimum **24 hours** uninterrupted rest per 7-day period
- Or **48 hours** uninterrupted rest per 14-day period

## Shift Length
- Maximum **13 hours** per shift

## Breaks During Shifts
- Minimum **20-minute** break when a shift exceeds 6 hours

## Night Workers
- Maximum **8 hours** average work per 24-hour period
- Entitled to free health assessment before and during night work assignment`,
  );

  const niceUrl = createMarkdownDoc(
    repo,
    'NICE Safe Staffing Guidance — Key Recommendations',
    `# NICE Safe Staffing Guidance — Key Recommendations

Based on NICE guideline SG1 (2014) and related NHS England guidance.

## Registered Nurse-to-Patient Ratios
- Daytime RN-to-patient ratio must not exceed **1:8** — this is a **red flag** trigger requiring immediate escalation
- Aim for better ratios where patient acuity demands it

## Supervisory Roles
- Ward sister / charge nurse (typically Band 7) should be **supernumerary** and not counted in direct care numbers

## Nursing Care Hours Per Patient Day (NCHPPD)
- Use NCHPPD as a benchmark for staffing levels
- Typical range: **6–8 NCHPPD** for general medical wards; higher for acute/specialist wards

## Skill Mix
- Minimum approximately **65% registered nurses** in the nursing workforce on each ward
- Remaining staff may be healthcare assistants (HCAs)

## Headroom / Uplift
- Apply an uplift factor of **22–25%** above baseline establishment to cover annual leave, sickness, mandatory training, and other absences

## Ward-Specific Factors
- Staffing levels must account for **ward specialty**, **patient acuity**, and **dependency levels**
- Acute and specialist wards (e.g. AMU) require higher baseline staffing

## Night Staffing
- At least **2 registered nurses** on every ward at all times during night shifts`,
  );

  // Create reference docs folder
  const folderHandle = repo.create<FolderDoc>();
  folderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'Reference Docs';
    d.docs = [
      { type: 'markdown', name: 'Working Time Directive', url: wtdUrl },
      { type: 'markdown', name: 'NICE Safe Staffing Guidance', url: niceUrl },
      { type: 'csv', name: 'Staff Roster', url: staffRosterUrl },
      { type: 'csv', name: 'Ward Information', url: wardInfoUrl },
      { type: 'csv', name: 'Shift Definitions', url: shiftDefsUrl },
    ];
  });

  // Create elicitation doc with prompt and reference folder
  const elicitationHandle = repo.create<ElicitationDoc>();
  elicitationHandle.change((d) => {
    d['@patchwork'] = { type: 'elicitation' };
    d.prompt =
      "Create a weekly rota for the AMU and Ward 6 at St Mary's Hospital NHS Trust, satisfying Working Time Directive rules, NICE safe staffing guidance, and ward-specific competency requirements.";
    d.referenceDocsFolderUrl = folderHandle.url;
  });

  return { elicitationDocUrl: elicitationHandle.url };
}
