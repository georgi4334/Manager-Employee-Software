import { z } from 'zod';

export const PRIVACY_EXPORT_VERSION = 1;

const dateTime = z.string();
const date = z.string();

/** Everything the system holds about one person, in a form they can read and move elsewhere (GDPR Art. 15/20). */
export const personalDataExportSchema = z.object({
  schemaVersion: z.literal(PRIVACY_EXPORT_VERSION),
  generatedAt: dateTime,
  account: z
    .object({
      email: z.string(),
      status: z.string(),
      locale: z.string().nullable(),
      timezone: z.string().nullable(),
      emailVerifiedAt: dateTime.nullable(),
      lastLoginAt: dateTime.nullable(),
      createdAt: dateTime,
      roles: z.array(z.string()),
    })
    .nullable(),
  /** null for an account without an employee record (e.g. a first administrator). */
  employee: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      employeeNo: z.string().nullable(),
      jobTitle: z.string().nullable(),
      location: z.string().nullable(),
      employmentType: z.string(),
      seniority: z.string().nullable(),
      hireDate: date.nullable(),
      terminationDate: date.nullable(),
      birthDate: date.nullable(),
      phone: z.string().nullable(),
      country: z.string().nullable(),
      status: z.string(),
      department: z.string().nullable(),
      manager: z.string().nullable(),
      teams: z.array(z.string()),
    })
    .nullable(),
  leave: z.object({
    requests: z.array(
      z.object({
        type: z.string(),
        startDate: date,
        endDate: date,
        halfDayStart: z.boolean(),
        halfDayEnd: z.boolean(),
        days: z.number(),
        status: z.string(),
        reason: z.string().nullable(),
        decisionComments: z.array(z.string()),
        createdAt: dateTime,
      }),
    ),
    balances: z.array(
      z.object({
        type: z.string(),
        year: z.number().int(),
        entitled: z.number(),
        carriedOver: z.number(),
        adjustment: z.number(),
      }),
    ),
  }),
  /** Projects they are staffed on or lead (names and codes, role, planned allocation and period). */
  projects: z.object({
    assignments: z.array(
      z.object({
        project: z.string(),
        code: z.string(),
        role: z.string().nullable(),
        allocationPct: z.number().int(),
        fromDate: date,
        toDate: date.nullable(),
      }),
    ),
    led: z.array(z.string()),
  }),
  /** Tasks assigned to them (reference, title, status, estimate, due date). */
  tasks: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      status: z.string(),
      estimateHours: z.number().nullable(),
      dueDate: date.nullable(),
    }),
  ),
  /** Their personal goals with key results, and the check-ins they wrote (ADR 0019). */
  goals: z.object({
    personal: z.array(
      z.object({
        title: z.string(),
        description: z.string().nullable(),
        status: z.string(),
        dueDate: date.nullable(),
        progressPct: z.number().int(),
        keyResults: z.array(
          z.object({
            title: z.string(),
            unit: z.string().nullable(),
            startValue: z.number(),
            targetValue: z.number(),
            currentValue: z.number(),
          }),
        ),
      }),
    ),
    checkIns: z.array(
      z.object({
        goal: z.string(),
        progressPct: z.number().int(),
        comment: z.string().nullable(),
        createdAt: dateTime,
      }),
    ),
  }),
  /** Feedback they gave and received, with the other person's name (ADR 0021). */
  feedback: z.object({
    given: z.array(
      z.object({
        to: z.string(),
        kind: z.string(),
        visibility: z.string(),
        body: z.string(),
        createdAt: dateTime,
      }),
    ),
    received: z.array(
      z.object({
        from: z.string(),
        kind: z.string(),
        visibility: z.string(),
        body: z.string(),
        createdAt: dateTime,
      }),
    ),
  }),
  /** Their 1:1 meetings: agenda, shared notes, their own private notes and action items (ADR 0020). */
  oneOnOnes: z.array(
    z.object({
      scheduledAt: dateTime,
      status: z.string(),
      role: z.enum(['manager', 'employee']),
      agenda: z.string().nullable(),
      sharedNotes: z.string().nullable(),
      privateNotes: z.string().nullable(),
      actionItems: z.array(
        z.object({ title: z.string(), dueDate: date.nullable(), done: z.boolean() }),
      ),
    }),
  ),
  /** Logged time and weekly timesheets (ADR 0015). */
  time: z.object({
    entries: z.array(
      z.object({
        workDate: date,
        minutes: z.number().int().nullable(),
        project: z.string(),
        task: z.string().nullable(),
        isBillable: z.boolean(),
        note: z.string().nullable(),
        source: z.string(),
      }),
    ),
    timesheets: z.array(z.object({ weekStart: date, status: z.string() })),
  }),
  attendance: z.array(
    z.object({
      date,
      checkInAt: dateTime,
      checkOutAt: dateTime.nullable(),
      mode: z.string(),
      note: z.string().nullable(),
      source: z.string(),
    }),
  ),
  calendarEvents: z.array(
    z.object({
      scope: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      location: z.string().nullable(),
      allDay: z.boolean(),
      startDate: date,
      endDate: date,
      startsAt: dateTime.nullable(),
      endsAt: dateTime.nullable(),
    }),
  ),
  notifications: z.array(
    z.object({
      type: z.string(),
      createdAt: dateTime,
      readAt: dateTime.nullable(),
    }),
  ),
  notificationPreferences: z.array(
    z.object({ type: z.string(), channel: z.string(), enabled: z.boolean() }),
  ),
  /** What this person did that was recorded in the audit log (action, entity, time). */
  auditEntries: z.array(z.object({ action: z.string(), entity: z.string(), at: dateTime })),
});
export type PersonalDataExport = z.infer<typeof personalDataExportSchema>;

/** Erasure is irreversible, so the request must say so explicitly. */
export const eraseEmployeeRequestSchema = z.object({ confirm: z.literal(true) }).strict();
export type EraseEmployeeRequest = z.infer<typeof eraseEmployeeRequestSchema>;
