// @ts-nocheck
// Illustration: deriving a PlanDoc from the hospital scheduling specs
//
// Architecture:
//   SpecCollectionDoc (same hospital scenario as spec-example)
//     ├── ER Department Spec      requiredDocs: ['schedule']
//     ├── ICU Department Spec     requiredDocs: ['schedule']
//     └── Global Hospital Spec    requiredDocs: []
//
//   PlanDoc
//     ├── ER Task ──────────────► produces ER schedule artifact
//     ├── ICU Task ─────────────► produces ICU schedule artifact
//     └── Global Task ──────────► validates cross-department constraints
//           dependsOn: [erTask, icuTask]
//
// Each task maps 1:1 to a spec. A task's artifacts correspond to its
// spec's requiredDocs — the documents the task is responsible for producing.
// The global task has no artifacts of its own; it depends on the department
// tasks completing first, then validates aggregate constraints across their
// outputs.

import type { SpecDoc, SpecCollectionDoc, PlanDoc, TaskDoc } from './types';

const { createDatalog } = await workspace.import('skills/datalog/index.js');
const { createPlan, getPlan } = await workspace.import('skills/plan/index.js');

// ════════════════════════════════════════════════════════════════════
// SHARED DATA — hospital staff roster and shift structure
// ════════════════════════════════════════════════════════════════════

const hospitalStaff = createDatalog(workspace, 'Hospital Staff');

hospitalStaff.assertFact('staff', ['dr_chen', 'doctor', 'attending']);
hospitalStaff.assertFact('staff', ['dr_patel', 'doctor', 'attending']);
hospitalStaff.assertFact('staff', ['nurse_kim', 'nurse', 'senior']);
hospitalStaff.assertFact('staff', ['nurse_garcia', 'nurse', 'senior']);
hospitalStaff.assertFact('staff', ['nurse_thompson', 'nurse', 'mid']);
hospitalStaff.assertFact('staff', ['nurse_reeves', 'nurse', 'mid']);
hospitalStaff.assertFact('staff', ['nurse_okafor', 'nurse', 'junior']);
hospitalStaff.assertFact('staff', ['nurse_adams', 'nurse', 'trainee']);

const shiftConfig = createDatalog(workspace, 'Shift Config');

shiftConfig.assertFact('shift', ['morning']);
shiftConfig.assertFact('shift', ['afternoon']);
shiftConfig.assertFact('shift', ['night']);

// ════════════════════════════════════════════════════════════════════
// ER DEPARTMENT — rules, constraints, and empty schedule
// ════════════════════════════════════════════════════════════════════

const erSpec = createDatalog(workspace, 'ER Spec');

erSpec.assertFact('dept_shift_hours', ['er', 'morning', 8]);
erSpec.assertFact('dept_shift_hours', ['er', 'afternoon', 8]);
erSpec.assertFact('dept_shift_hours', ['er', 'night', 8]);

erSpec.assertConstraint('er_no_junior_night', {
  body: [
    { pred: 'assigned', args: ['P', 'er', 'night'] },
    { pred: 'staff', args: ['P', '_', 'junior'] },
  ],
});

erSpec.assertConstraint('er_min_staff_per_shift', {
  body: [
    { pred: 'shift', args: ['S'] },
    { pred: 'sum', args: ['_', 'assigned(_, er, S)', 'Count'] },
    { pred: 'lt', args: ['Count', '2'] },
  ],
});

const erSchedule = createDatalog(workspace, 'ER Schedule');

// ════════════════════════════════════════════════════════════════════
// ICU DEPARTMENT — rules, constraints, and empty schedule
// ════════════════════════════════════════════════════════════════════

const icuSpec = createDatalog(workspace, 'ICU Spec');

icuSpec.assertFact('dept_shift_hours', ['icu', 'morning', 12]);
icuSpec.assertFact('dept_shift_hours', ['icu', 'afternoon', 12]);
icuSpec.assertFact('dept_shift_hours', ['icu', 'night', 12]);

icuSpec.assertConstraint('icu_no_trainee', {
  body: [
    { pred: 'assigned', args: ['P', 'icu', 'S'] },
    { pred: 'staff', args: ['P', '_', 'trainee'] },
  ],
});

icuSpec.assertConstraint('icu_min_staff_per_shift', {
  body: [
    { pred: 'shift', args: ['S'] },
    { pred: 'sum', args: ['_', 'assigned(_, icu, S)', 'Count'] },
    { pred: 'lt', args: ['Count', '2'] },
  ],
});

const icuSchedule = createDatalog(workspace, 'ICU Schedule');

// ════════════════════════════════════════════════════════════════════
// GLOBAL SPEC — cross-department aggregate constraints
// ════════════════════════════════════════════════════════════════════

const globalSpec = createDatalog(workspace, 'Global Spec');

globalSpec.assertRule({
  head: { pred: 'assignment_hours', args: ['Person', 'Dept', 'Shift', 'Hours'] },
  body: [
    { pred: 'assigned', args: ['Person', 'Dept', 'Shift'] },
    { pred: 'dept_shift_hours', args: ['Dept', 'Shift', 'Hours'] },
  ],
});

globalSpec.assertConstraint('max_hours_per_person', {
  body: [
    { pred: 'staff', args: ['Person', '_', '_'] },
    { pred: 'sum', args: ['Hours', 'assignment_hours(Person, _, _, Hours)', 'Total'] },
    { pred: 'gt', args: ['Total', '20'] },
  ],
});

globalSpec.assertConstraint('max_total_staff_hours', {
  body: [
    { pred: 'sum', args: ['Hours', 'assignment_hours(_, _, _, Hours)', 'Total'] },
    { pred: 'gt', args: ['Total', '140'] },
  ],
});

// ════════════════════════════════════════════════════════════════════
// SPEC DOCUMENTS — with requiredDocs indicating what must be produced
// ════════════════════════════════════════════════════════════════════

const erSpecDoc: SpecDoc = {
  goal: 'ER staffing rules are satisfied for all shifts',
  docs: {
    spec: erSpec.url,
    schedule: erSchedule.url,
    staff: hospitalStaff.url,
    shifts: shiftConfig.url,
  },
  requiredDocs: ['schedule'],
  verifications: [
    {
      name: 'no junior night shifts',
      documentUrls: {
        spec: erSpec.url, schedule: erSchedule.url, staff: hospitalStaff.url,
      },
      script: `
        const { mergeDatalog } = await workspace.import('skills/datalog/index.js')
        const merged = await mergeDatalog(workspace, [spec, schedule, staff])
        return merged.checkConflicts('er_no_junior_night').length === 0
      `,
    },
    {
      name: 'minimum 2 staff per shift',
      documentUrls: {
        spec: erSpec.url, schedule: erSchedule.url, shifts: shiftConfig.url,
      },
      script: `
        const { mergeDatalog } = await workspace.import('skills/datalog/index.js')
        const merged = await mergeDatalog(workspace, [spec, schedule, shifts])
        return merged.checkConflicts('er_min_staff_per_shift').length === 0
      `,
    },
  ],
};

const icuSpecDoc: SpecDoc = {
  goal: 'ICU staffing rules are satisfied for all shifts',
  docs: {
    spec: icuSpec.url,
    schedule: icuSchedule.url,
    staff: hospitalStaff.url,
    shifts: shiftConfig.url,
  },
  requiredDocs: ['schedule'],
  verifications: [
    {
      name: 'no trainees in ICU',
      documentUrls: {
        spec: icuSpec.url, schedule: icuSchedule.url, staff: hospitalStaff.url,
      },
      script: `
        const { mergeDatalog } = await workspace.import('skills/datalog/index.js')
        const merged = await mergeDatalog(workspace, [spec, schedule, staff])
        return merged.checkConflicts('icu_no_trainee').length === 0
      `,
    },
    {
      name: 'minimum 2 staff per shift',
      documentUrls: {
        spec: icuSpec.url, schedule: icuSchedule.url, shifts: shiftConfig.url,
      },
      script: `
        const { mergeDatalog } = await workspace.import('skills/datalog/index.js')
        const merged = await mergeDatalog(workspace, [spec, schedule, shifts])
        return merged.checkConflicts('icu_min_staff_per_shift').length === 0
      `,
    },
  ],
};

const globalSpecDoc: SpecDoc = {
  goal: 'cross-department aggregate constraints hold across the hospital',
  docs: {
    global: globalSpec.url,
    erSpec: erSpec.url,
    erSchedule: erSchedule.url,
    icuSpec: icuSpec.url,
    icuSchedule: icuSchedule.url,
    staff: hospitalStaff.url,
  },
  requiredDocs: [],
  verifications: [
    {
      name: 'no person exceeds 20 hours',
      documentUrls: {
        global: globalSpec.url,
        erSpec: erSpec.url, erSchedule: erSchedule.url,
        icuSpec: icuSpec.url, icuSchedule: icuSchedule.url,
        staff: hospitalStaff.url,
      },
      script: `
        const { mergeDatalog } = await workspace.import('skills/datalog/index.js')
        const merged = await mergeDatalog(workspace, [global, erSpec, erSchedule, icuSpec, icuSchedule, staff])
        return merged.checkConflicts('max_hours_per_person').length === 0
      `,
    },
    {
      name: 'total staff-hours under 140',
      documentUrls: {
        global: globalSpec.url,
        erSpec: erSpec.url, erSchedule: erSchedule.url,
        icuSpec: icuSpec.url, icuSchedule: icuSchedule.url,
      },
      script: `
        const { mergeDatalog } = await workspace.import('skills/datalog/index.js')
        const merged = await mergeDatalog(workspace, [global, erSpec, erSchedule, icuSpec, icuSchedule])
        return merged.checkConflicts('max_total_staff_hours').length === 0
      `,
    },
  ],
};

const hospitalSpecs: SpecCollectionDoc = {
  specs: [erSpecDoc, icuSpecDoc, globalSpecDoc],
};

// ════════════════════════════════════════════════════════════════════
// TASK DOCUMENTS — one task per spec, wired with dependencies
// ════════════════════════════════════════════════════════════════════
//
// Dependency graph:
//
//   erTask ─────┐
//               ├──► globalTask
//   icuTask ────┘
//
// Department tasks run independently. The global task waits for both
// department schedules to be produced before validating aggregate
// constraints.

const { url: planUrl } = createPlan(workspace);
const plan = await getPlan(workspace, planUrl);

const erTask = plan.addTask('Generate ER department schedule', erSpecDoc.url);
erTask.setArtifact('schedule', erSchedule.url);

const icuTask = plan.addTask('Generate ICU department schedule', icuSpecDoc.url);
icuTask.setArtifact('schedule', icuSchedule.url);

const globalTask = plan.addTask('Validate cross-department constraints', globalSpecDoc.url);
globalTask.addDependency(erTask.url);
globalTask.addDependency(icuTask.url);
