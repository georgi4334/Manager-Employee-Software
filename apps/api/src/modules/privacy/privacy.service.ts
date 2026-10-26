import { Injectable } from '@nestjs/common';
import { PRIVACY_EXPORT_VERSION, type PersonalDataExport } from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ErasureService } from './erasure.service.js';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const day = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const full = (e: { firstName: string; lastName: string } | null): string | null =>
  e ? `${e.firstName} ${e.lastName}` : null;

/** Export of everything held about one person, and their erasure (docs/adr/0011-gdpr-export-erasure.md). */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly erasure: ErasureService,
  ) {}

  /** The caller's own data, or (with `gdpr.export_employee`) that of an employee. */
  export(actor: RequestAuth, employeeId?: string): Promise<PersonalDataExport> {
    return this.db.tx(async (tx) => {
      if (employeeId) {
        await this.authz.assert(actor, 'gdpr.export_employee');
        const employee = await tx.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, userId: true },
        });
        if (!employee) throw new AppException('NOT_FOUND', { message: 'Employee not found' });
        const data = await this.collect(tx, employee.id, employee.userId);
        await this.audit.record(tx, {
          actorUserId: actor.userId,
          action: 'privacy.exported',
          entity: 'employee',
          entityId: employee.id,
        });
        return data;
      }
      await this.authz.assert(actor, 'gdpr.export_own');
      const own = await tx.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      return this.collect(tx, own?.id ?? null, actor.userId);
    });
  }

  async erase(actor: RequestAuth, employeeId: string): Promise<void> {
    await this.authz.assert(actor, 'gdpr.erase_employee');
    // Existence is checked through the tenant connection, so another workspace's id is simply unknown.
    const employee = await this.db.tx((tx) =>
      tx.employee.findUnique({ where: { id: employeeId }, select: { id: true } }),
    );
    if (!employee) throw new AppException('NOT_FOUND', { message: 'Employee not found' });
    await this.erasure.erase(this.context.requireTenantId(), actor.userId, employeeId);
  }

  private async collect(
    tx: TenantTx,
    employeeId: string | null,
    userId: string | null,
  ): Promise<PersonalDataExport> {
    const user = userId
      ? await tx.user.findUnique({
          where: { id: userId },
          select: {
            email: true,
            status: true,
            locale: true,
            timezone: true,
            emailVerifiedAt: true,
            lastLoginAt: true,
            createdAt: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        })
      : null;
    const employee = employeeId
      ? await tx.employee.findUnique({
          where: { id: employeeId },
          include: {
            department: { select: { name: true } },
            manager: { select: { firstName: true, lastName: true } },
            teamMemberships: { select: { team: { select: { name: true } } } },
          },
        })
      : null;

    const [
      requests,
      balances,
      attendance,
      events,
      assignments,
      led,
      tasks,
      timeEntries,
      timesheets,
      goals,
      checkIns,
      meetings,
      feedbackGiven,
      feedbackReceived,
    ] = employeeId
      ? await Promise.all([
          tx.leaveRequest.findMany({
            where: { employeeId },
            orderBy: { startDate: 'asc' },
            include: {
              leaveType: { select: { key: true, name: true } },
              approvals: { select: { comment: true }, orderBy: { decidedAt: 'asc' } },
            },
          }),
          tx.leaveBalance.findMany({
            where: { employeeId },
            orderBy: [{ year: 'asc' }],
            include: { leaveType: { select: { key: true, name: true } } },
          }),
          tx.attendanceRecord.findMany({ where: { employeeId }, orderBy: { checkInAt: 'asc' } }),
          tx.calendarEvent.findMany({
            where: { ownerEmployeeId: employeeId },
            orderBy: { startDate: 'asc' },
          }),
          tx.projectAssignment.findMany({
            where: { employeeId },
            orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
            include: { project: { select: { name: true, code: true } } },
          }),
          tx.project.findMany({
            where: { leadEmployeeId: employeeId },
            orderBy: { name: 'asc' },
            select: { name: true },
          }),
          tx.task.findMany({
            where: { assigneeEmployeeId: employeeId },
            orderBy: [{ project: { code: 'asc' } }, { number: 'asc' }],
            include: { project: { select: { code: true } } },
          }),
          tx.timeEntry.findMany({
            where: { employeeId },
            orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
            include: {
              project: { select: { code: true } },
              task: { select: { number: true } },
            },
          }),
          tx.timesheet.findMany({ where: { employeeId }, orderBy: { weekStart: 'asc' } }),
          tx.goal.findMany({
            where: { scope: 'personal', ownerEmployeeId: employeeId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { keyResults: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
          }),
          tx.goalUpdate.findMany({
            where: { authorEmployeeId: employeeId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { goal: { select: { title: true, scope: true } } },
          }),
          tx.oneOnOne.findMany({
            where: { OR: [{ managerEmployeeId: employeeId }, { employeeId }] },
            orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
            include: { actionItems: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
          }),
          tx.feedback.findMany({
            where: { fromEmployeeId: employeeId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { to: { select: { firstName: true, lastName: true } } },
          }),
          tx.feedback.findMany({
            where: { toEmployeeId: employeeId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: { from: { select: { firstName: true, lastName: true } } },
          }),
        ])
      : [[], [], [], [], [], [], [], [], [], [], [], [], [], []];
    const [notifications, preferences, auditEntries] = userId
      ? await Promise.all([
          tx.notification.findMany({
            where: { recipientUserId: userId },
            orderBy: { createdAt: 'asc' },
            select: { type: true, createdAt: true, readAt: true },
          }),
          tx.notificationPreference.findMany({
            where: { userId },
            orderBy: [{ type: 'asc' }, { channel: 'asc' }],
          }),
          tx.auditLog.findMany({
            where: { actorUserId: userId },
            orderBy: { createdAt: 'asc' },
            select: { action: true, entity: true, createdAt: true },
          }),
        ])
      : [[], [], []];

    const typeName = (t: { key: string | null; name: string | null }) => t.name ?? t.key ?? '';
    return {
      schemaVersion: PRIVACY_EXPORT_VERSION,
      generatedAt: new Date().toISOString(),
      account: user && {
        email: user.email,
        status: user.status,
        locale: user.locale,
        timezone: user.timezone,
        emailVerifiedAt: iso(user.emailVerifiedAt),
        lastLoginAt: iso(user.lastLoginAt),
        createdAt: user.createdAt.toISOString(),
        roles: user.roles.map((r) => r.role.name),
      },
      employee: employee && {
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeNo: employee.employeeNo,
        jobTitle: employee.jobTitle,
        location: employee.location,
        employmentType: employee.employmentType,
        seniority: employee.seniority,
        hireDate: day(employee.hireDate),
        terminationDate: day(employee.terminationDate),
        birthDate: day(employee.birthDate),
        phone: employee.phone,
        country: employee.country,
        status: employee.status,
        department: employee.department?.name ?? null,
        manager: full(employee.manager),
        teams: employee.teamMemberships.map((m) => m.team.name),
      },
      leave: {
        requests: requests.map((r) => ({
          type: typeName(r.leaveType),
          startDate: day(r.startDate)!,
          endDate: day(r.endDate)!,
          halfDayStart: r.halfDayStart,
          halfDayEnd: r.halfDayEnd,
          days: Number(r.days),
          status: r.status,
          reason: r.reason,
          decisionComments: r.approvals.flatMap((a) => (a.comment ? [a.comment] : [])),
          createdAt: r.createdAt.toISOString(),
        })),
        balances: balances.map((b) => ({
          type: typeName(b.leaveType),
          year: b.year,
          entitled: Number(b.entitled),
          carriedOver: Number(b.carriedOver),
          adjustment: Number(b.adjustment),
        })),
      },
      projects: {
        assignments: assignments.map((a) => ({
          project: a.project.name,
          code: a.project.code,
          role: a.role,
          allocationPct: a.allocationPct,
          fromDate: day(a.fromDate)!,
          toDate: iso(a.toDate)?.slice(0, 10) ?? null,
        })),
        led: led.map((p) => p.name),
      },
      tasks: tasks.map((t) => ({
        key: `${t.project.code}-${t.number}`,
        title: t.title,
        status: t.status,
        estimateHours: t.estimateHours === null ? null : Number(t.estimateHours),
        dueDate: iso(t.dueDate)?.slice(0, 10) ?? null,
      })),
      feedback: {
        given: feedbackGiven.map((f) => ({
          to: `${f.to.firstName} ${f.to.lastName}`,
          kind: f.kind,
          visibility: f.visibility,
          body: f.body,
          createdAt: f.createdAt.toISOString(),
        })),
        received: feedbackReceived.map((f) => ({
          from: `${f.from.firstName} ${f.from.lastName}`,
          kind: f.kind,
          visibility: f.visibility,
          body: f.body,
          createdAt: f.createdAt.toISOString(),
        })),
      },
      // Only the person's own private notes: the other participant's stay theirs (ADR 0020).
      oneOnOnes: meetings.map((m) => {
        const asManager = m.managerEmployeeId === employeeId;
        return {
          scheduledAt: m.scheduledAt.toISOString(),
          status: m.status,
          role: asManager ? ('manager' as const) : ('employee' as const),
          agenda: m.agenda,
          sharedNotes: m.sharedNotes,
          privateNotes: asManager ? m.privateNotesManager : m.privateNotesEmployee,
          actionItems: m.actionItems.map((i) => ({
            title: i.title,
            dueDate: i.dueDate ? day(i.dueDate)! : null,
            done: i.doneAt !== null,
          })),
        };
      }),
      goals: {
        personal: goals.map((g) => ({
          title: g.title,
          description: g.description,
          status: g.status,
          dueDate: g.dueDate ? day(g.dueDate)! : null,
          progressPct: g.progressPct,
          keyResults: g.keyResults.map((k) => ({
            title: k.title,
            unit: k.unit,
            startValue: Number(k.startValue),
            targetValue: Number(k.targetValue),
            currentValue: Number(k.currentValue),
          })),
        })),
        // Check-ins on team and company goals are named by scope, not by the title of somebody else's goal.
        checkIns: checkIns.map((c) => ({
          goal: c.goal.scope === 'personal' ? c.goal.title : c.goal.scope,
          progressPct: c.progressPct,
          comment: c.comment,
          createdAt: c.createdAt.toISOString(),
        })),
      },
      time: {
        entries: timeEntries.map((e) => ({
          workDate: day(e.workDate)!,
          minutes: e.minutes,
          project: e.project.code,
          task: e.task ? `${e.project.code}-${e.task.number}` : null,
          isBillable: e.isBillable,
          note: e.note,
          source: e.source,
        })),
        timesheets: timesheets.map((t) => ({ weekStart: day(t.weekStart)!, status: t.status })),
      },
      attendance: attendance.map((a) => ({
        date: day(a.workDate)!,
        checkInAt: a.checkInAt.toISOString(),
        checkOutAt: iso(a.checkOutAt),
        mode: a.mode,
        note: a.note,
        source: a.source,
      })),
      calendarEvents: events.map((e) => ({
        scope: e.scope,
        title: e.title,
        description: e.description,
        location: e.location,
        allDay: e.allDay,
        startDate: day(e.startDate)!,
        endDate: day(e.endDate)!,
        startsAt: iso(e.startsAt),
        endsAt: iso(e.endsAt),
      })),
      notifications: notifications.map((n) => ({
        type: n.type,
        createdAt: n.createdAt.toISOString(),
        readAt: iso(n.readAt),
      })),
      notificationPreferences: preferences.map((p) => ({
        type: p.type,
        channel: p.channel,
        enabled: p.enabled,
      })),
      auditEntries: auditEntries.map((a) => ({
        action: a.action,
        entity: a.entity,
        at: a.createdAt.toISOString(),
      })),
    };
  }
}
