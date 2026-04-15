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
Sarah Chen,AMU,7,Ward Manager,acute_assessment,Supernumerary and not available for direct-care coverage
James Okafor,AMU,6,Senior Staff Nurse,acute_assessment,May act as nurse in charge
Fiona Grant,AMU,6,Senior Staff Nurse,acute_assessment,May act as nurse in charge
Priya Sharma,AMU,5,Staff Nurse,acute_assessment,
Emily Davies,AMU,5,Staff Nurse,acute_assessment,
Nia Ford,AMU,5,Staff Nurse,acute_assessment,
Ben Walker,AMU,5,Staff Nurse,acute_assessment,
Grace Hall,AMU,5,Staff Nurse,acute_assessment,
Luke Evans,AMU,3,Senior HCA,,
Mike Thompson,AMU,3,Senior HCA,,
Olivia Barnes,AMU,2,HCA,,
Rachel Green,Ward 6,6,Senior Staff Nurse,,May act as nurse in charge
Sam Patel,Ward 6,6,Senior Staff Nurse,,May act as nurse in charge
Tom Williams,Ward 6,5,Staff Nurse,,
Aisha Begum,Ward 6,5,Staff Nurse,,
Helen Morris,Ward 6,5,Staff Nurse,,
Noor Khan,Ward 6,5,Staff Nurse,,
Jade Turner,Ward 6,5,Staff Nurse,,
Chris Adams,Ward 6,5,Staff Nurse,,
Dan Murphy,Ward 6,3,Senior HCA,,
Lisa Brown,Ward 6,2,HCA,,
Kevin Wright,Ward 6,2,HCA,,`,
  );

  const wardInfoUrl = createCsvDoc(
    repo,
    'Ward Information',
    `Ward,Beds,Type,Day RN Minimum,HCA Minimum,Special Notes
AMU,20,Acute Medical,2,1,Night shifts require a Band 6+ nurse in charge and AMU RNs need acute assessment competency
Ward 6,28,General Medicine,2,1,Any shift above 16 patients must roster 3 RNs`,
  );

  const shiftDefsUrl = createCsvDoc(
    repo,
    'Shift Definitions',
    `Shift Type,Start,End,Hours,Notes
Long Day,07:30,20:00,12,Default direct-care shift
Long Night,19:30,08:00,12,Default direct-care shift`,
  );

  const staffAvailabilityUrl = createCsvDoc(
    repo,
    'Staff Availability',
    `Name,Day Off
James Okafor,Tuesday
Fiona Grant,Wednesday
Priya Sharma,Wednesday
Emily Davies,Monday
Ben Walker,Tuesday
Grace Hall,Monday
Luke Evans,Wednesday
Olivia Barnes,Tuesday
Rachel Green,Wednesday
Sam Patel,Monday
Tom Williams,Wednesday
Aisha Begum,Tuesday
Jade Turner,Monday
Chris Adams,Tuesday
Dan Murphy,Wednesday
Kevin Wright,Monday`,
  );

  const rotaGuidanceUrl = createMarkdownDoc(
    repo,
    'Default Rota Guidance',
    `# Default rota assumptions for this example

- This default workspace models a **three-day sample rota** covering Monday to Wednesday for AMU and Ward 6.
- Each employee has a hard cap of **48 rostered hours** in the sample week.
- AMU and Ward 6 both require **at least 2 direct-care registered nurses** and **at least 1 direct-care HCA** on every shift.
- **Supernumerary staff do not count toward coverage** and should not be placed into direct-care assignments.
- AMU night shifts must explicitly name a **Band 6+ registered nurse in charge**.
- AMU registered nurses must hold the **acute assessment** competency.
- Ward 6 uses a high-census rule: any shift with **more than 16 patients** must roster **3 registered nurses**.
- Assignments must stay within each employee's **home ward** in the default scenario.
- Assigning the same person to more than one slot on the same shift is invalid, even if the shift hours match.
- Each staff member has **one designated day off** during the Mon–Wed rota period. Staff must **not be assigned on their day off**.
- When a nurse-in-charge is unavailable due to a day off, another Band 6+ registered nurse from the same ward must cover (e.g. Fiona Grant covers AMU nights when James Okafor is off on Tuesday; Sam Patel covers Ward 6 when Rachel Green is off on Wednesday).`,
  );

  const folderHandle = repo.create<FolderDoc>();
  folderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'Reference Docs';
    d.docs = [
      { type: 'markdown', name: 'Default Rota Guidance', url: rotaGuidanceUrl },
      { type: 'csv', name: 'Staff Roster', url: staffRosterUrl },
      { type: 'csv', name: 'Staff Availability', url: staffAvailabilityUrl },
      { type: 'csv', name: 'Ward Information', url: wardInfoUrl },
      { type: 'csv', name: 'Shift Definitions', url: shiftDefsUrl },
    ];
  });

  const elicitationHandle = repo.create<ElicitationDoc>();
  elicitationHandle.change((d) => {
    d['@patchwork'] = { type: 'elicitation' };
    d.prompt =
      'Create a three-day sample rota (Monday–Wednesday) for AMU and Ward 6 at St Mary\'s Hospital NHS Trust. Respect the 48-hour weekly limit, keep staff on their home ward, ensure every shift has 2 registered nurses and 1 HCA, keep supernumerary staff out of direct-care coverage, require a Band 6+ nurse in charge on AMU nights, require acute assessment competency for AMU registered nurses, roster 3 registered nurses on Ward 6 shifts above 16 patients, and ensure no staff member is assigned on their designated day off. Each ward has two Band 6+ nurses who can act as nurse in charge, so NIC duties can be covered when one is off.';
    d.referenceDocsFolderUrl = folderHandle.url;
  });

  return { elicitationDocUrl: elicitationHandle.url };
}
