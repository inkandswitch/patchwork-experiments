// @ts-nocheck
// Illustration: hospital shift scheduling with department-local and global constraints
//
// Architecture:
//   SpecCollectionDoc
//     ├── ER Department Spec      (pattern + aggregate constraints)
//     ├── ICU Department Spec     (pattern + aggregate constraints)
//     └── Global Hospital Spec    (aggregate constraints over department data)
//
// Each department defines its staffing rules and constraints.
// The global spec aggregates hours across departments using derived
// predicates — it never inspects department-internal logic, only the
// shared assigned(Person, Dept, Shift) and dept_shift_hours(Dept, Shift, Hours)
// facts that each department exports.
//
// Schedule documents are created empty — assignments are populated
// later when a concrete schedule is proposed for verification.

import type { SpecDoc, SpecCollectionDoc } from './types';

const { createDatalog } = await workspace.import('skills/datalog/index.js');

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

// Derive per-assignment hours by joining assignments with department shift durations.
// This is the interface surface the global constraints operate on.
globalSpec.assertRule({
  head: { pred: 'assignment_hours', args: ['Person', 'Dept', 'Shift', 'Hours'] },
  body: [
    { pred: 'assigned', args: ['Person', 'Dept', 'Shift'] },
    { pred: 'dept_shift_hours', args: ['Dept', 'Shift', 'Hours'] },
  ],
});

// No individual may exceed 20 total hours across all departments.
globalSpec.assertConstraint('max_hours_per_person', {
  body: [
    { pred: 'staff', args: ['Person', '_', '_'] },
    { pred: 'sum', args: ['Hours', 'assignment_hours(Person, _, _, Hours)', 'Total'] },
    { pred: 'gt', args: ['Total', '20'] },
  ],
});

// Total hospital-wide staff-hours cannot exceed 140.
globalSpec.assertConstraint('max_total_staff_hours', {
  body: [
    { pred: 'sum', args: ['Hours', 'assignment_hours(_, _, _, Hours)', 'Total'] },
    { pred: 'gt', args: ['Total', '140'] },
  ],
});

// ════════════════════════════════════════════════════════════════════
// SPEC DOCUMENTS — verification structure
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

// ── Collection ──────────────────────────────────────────────────────

const hospitalSpecs: SpecCollectionDoc = {
  specs: [erSpecDoc, icuSpecDoc, globalSpecDoc],
};
