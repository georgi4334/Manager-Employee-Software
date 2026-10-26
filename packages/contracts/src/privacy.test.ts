import { describe, expect, it } from 'vitest';
import { eraseEmployeeRequestSchema, personalDataExportSchema } from './privacy.js';

describe('erase request', () => {
  it('needs an explicit confirmation and nothing else', () => {
    expect(eraseEmployeeRequestSchema.safeParse({ confirm: true }).success).toBe(true);
    for (const body of [{}, { confirm: false }, { confirm: 'true' }, { confirm: true, id: 'x' }]) {
      expect(eraseEmployeeRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('export document', () => {
  const minimal = {
    schemaVersion: 1,
    generatedAt: '2026-10-25T08:00:00.000Z',
    account: null,
    employee: {
      firstName: 'A',
      lastName: 'B',
      employeeNo: null,
      jobTitle: null,
      location: null,
      employmentType: 'full_time',
      seniority: null,
      hireDate: null,
      terminationDate: null,
      birthDate: null,
      phone: null,
      country: null,
      status: 'active',
      department: null,
      manager: null,
      teams: [],
    },
    leave: { requests: [], balances: [] },
    projects: { assignments: [], led: [] },
    tasks: [],
    time: { entries: [], timesheets: [] },
    goals: { personal: [], checkIns: [] },
    oneOnOnes: [],
    feedback: { given: [], received: [] },
    skills: [],
    reviews: [],
    attendance: [],
    calendarEvents: [],
    notifications: [],
    notificationPreferences: [],
    auditEntries: [],
  };
  it('accepts a complete document and refuses another version or a missing part', () => {
    expect(personalDataExportSchema.safeParse(minimal).success).toBe(true);
    expect(personalDataExportSchema.safeParse({ ...minimal, schemaVersion: 2 }).success).toBe(
      false,
    );
    const { attendance: _omit, ...partial } = minimal;
    expect(personalDataExportSchema.safeParse(partial).success).toBe(false);
  });
});
