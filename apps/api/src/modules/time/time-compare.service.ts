import { Injectable } from '@nestjs/common';
import {
  addDays,
  compareDay,
  weekDays,
  weekStartOf,
  type Compare,
  type CompareQuery,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { dateIn, dateOut, notFound } from '../projects/projects.shared.js';

/**
 * Presence next to logged time for one week (docs/adr/0017-integrations.md): a mirror for the person and for the
 * people who review their week. No list across people, nothing stored.
 */
@Injectable()
export class TimeCompareService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
  ) {}

  week(actor: RequestAuth, query: CompareQuery): Promise<Compare> {
    return this.db.tx(async (tx) => {
      const today = await workspaceToday(tx, this.context);
      const weekStart = weekStartOf(query.weekStart ?? today);
      const me = await tx.employee.findFirst({
        where: { userId: actor.userId, status: 'active' },
        select: { id: true },
      });
      const targetId = query.employeeId ?? me?.id;
      if (!targetId) throw notFound('Employee');
      if (targetId === me?.id) {
        // Your own week: you need to see your attendance and your time.
        if (
          !actor.permissions['attendance.view'] ||
          !(actor.permissions['time.log'] || actor.permissions['time.view'])
        ) {
          throw notFound('Employee');
        }
      } else {
        const [attendance, time] = await Promise.all([
          this.authz.allowedEmployees(actor, 'attendance.view', [targetId]),
          this.authz.allowedEmployees(actor, 'time.view', [targetId]),
        ]);
        if (!attendance.has(targetId) || !time.has(targetId)) throw notFound('Employee');
      }
      if (!(await tx.employee.findUnique({ where: { id: targetId }, select: { id: true } }))) {
        throw notFound('Employee');
      }

      const range = { gte: dateIn(weekStart), lte: dateIn(addDays(weekStart, 6)) };
      const [records, entries, leave] = await Promise.all([
        tx.attendanceRecord.findMany({
          where: { employeeId: targetId, workDate: range },
          select: { workDate: true, checkInAt: true, checkOutAt: true },
        }),
        tx.timeEntry.findMany({
          where: { employeeId: targetId, workDate: range, minutes: { not: null } },
          select: { workDate: true, minutes: true },
        }),
        tx.leaveRequestDay.findMany({
          where: { day: range, request: { employeeId: targetId, status: 'approved' } },
          select: { day: true },
        }),
      ]);
      const onLeave = new Set(leave.map((l) => dateOut(l.day)));

      return {
        weekStart,
        days: weekDays(weekStart).map((date) => {
          const of = records.filter((r) => dateOut(r.workDate) === date);
          const attendanceMinutes = of
            .filter((r) => r.checkOutAt !== null)
            .reduce(
              (sum, r) =>
                sum + Math.round((r.checkOutAt!.getTime() - r.checkInAt.getTime()) / 60_000),
              0,
            );
          const loggedMinutes = entries
            .filter((e) => dateOut(e.workDate) === date)
            .reduce((sum, e) => sum + (e.minutes ?? 0), 0);
          const day = {
            date,
            attendanceMinutes,
            loggedMinutes,
            onLeave: onLeave.has(date),
            openRecord: of.some((r) => r.checkOutAt === null),
          };
          return { ...day, flag: compareDay(day) };
        }),
      };
    });
  }
}
