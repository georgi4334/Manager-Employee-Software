import { Injectable } from '@nestjs/common';
import {
  builtInHolidays,
  eachDay,
  yearOf,
  type CreateHolidayRequest,
  type DateString,
  type Holiday,
  type HolidayOnDate,
  type LeaveSettings,
  type UpdateLeaveSettingsRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import type { TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { conflict, dateIn, dateOut, notFound } from './leave.shared.js';

/** Workspace-wide leave settings and the holiday calendar (docs/adr/0008-leave.md). */
@Injectable()
export class LeaveSettingsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ----- settings ------------------------------------------------------------------------------

  get(): Promise<LeaveSettings> {
    return this.db.tx((tx) => this.settings(tx));
  }

  /** Used by other leave services inside their own transaction. */
  async settings(tx: TenantTx): Promise<LeaveSettings> {
    const row =
      (await tx.leaveSettings.findFirst()) ?? (await tx.leaveSettings.create({ data: {} }));
    return { hideSickTypeFromTeam: row.hideSickTypeFromTeam, defaultCountry: row.defaultCountry };
  }

  update(actor: RequestAuth, body: UpdateLeaveSettingsRequest): Promise<LeaveSettings> {
    return this.db.tx(async (tx) => {
      const current = await this.settings(tx);
      const tenant = await tx.leaveSettings.findFirstOrThrow({ select: { tenantId: true } });
      await tx.leaveSettings.update({ where: { tenantId: tenant.tenantId }, data: body });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.settings_updated',
        entity: 'leave_settings',
        before: current as unknown as Record<string, boolean | string | null>,
        after: body,
      });
      return this.settings(tx);
    });
  }

  // ----- holidays ------------------------------------------------------------------------------

  /** Built-in national days plus custom days for a country (custom days without country apply to everybody). */
  list(country: string | null, year: number): Promise<Holiday[]> {
    return this.db.tx((tx) => this.holidays(tx, country, year));
  }

  async holidays(tx: TenantTx, country: string | null, year: number): Promise<Holiday[]> {
    const custom = await tx.holiday.findMany({
      where: {
        date: { gte: dateIn(`${year}-01-01`), lte: dateIn(`${year}-12-31`) },
        OR: [{ country: null }, ...(country ? [{ country }] : [])],
      },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    });
    const list: Holiday[] = [
      ...builtInHolidays(country, year).map((h) => ({
        id: null,
        date: h.date,
        key: h.key,
        name: null,
        compensates: h.compensates ?? null,
        country,
        halfDay: false,
      })),
      ...custom.map((h) => ({
        id: h.id,
        date: dateOut(h.date),
        key: null,
        name: h.name,
        compensates: null,
        country: h.country,
        halfDay: h.isHalfDay,
      })),
    ];
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * The holidays that apply to one employee in a date range, ready for countLeaveDays. A day that is both a
   * full holiday and a half-day holiday counts as a full holiday.
   */
  async holidayMap(
    tx: TenantTx,
    country: string | null,
    start: DateString,
    end: DateString,
  ): Promise<Map<DateString, HolidayOnDate>> {
    const map = new Map<DateString, HolidayOnDate>();
    const range = new Set(eachDay(start, end));
    for (let year = yearOf(start); year <= yearOf(end); year++) {
      for (const holiday of await this.holidays(tx, country, year)) {
        if (!range.has(holiday.date)) continue;
        const existing = map.get(holiday.date);
        map.set(holiday.date, {
          halfDay: existing ? existing.halfDay && holiday.halfDay : holiday.halfDay,
        });
      }
    }
    return map;
  }

  create(actor: RequestAuth, body: CreateHolidayRequest): Promise<Holiday> {
    return this.db.tx(async (tx) => {
      const taken = await tx.holiday.findFirst({
        where: { date: dateIn(body.date), country: body.country },
        select: { id: true },
      });
      if (taken) throw conflict('date', 'A holiday exists on this date');
      const created = await tx.holiday.create({
        data: {
          date: dateIn(body.date),
          name: body.name,
          country: body.country,
          isHalfDay: body.halfDay,
        },
      });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.holiday_created',
        entity: 'holiday',
        entityId: created.id,
        after: { date: body.date, country: body.country, halfDay: body.halfDay },
      });
      return {
        id: created.id,
        date: body.date,
        key: null,
        name: created.name,
        compensates: null,
        country: created.country,
        halfDay: created.isHalfDay,
      };
    });
  }

  remove(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const current = await tx.holiday.findUnique({ where: { id } });
      if (!current) throw notFound('Holiday');
      await tx.holiday.delete({ where: { id } });
      await this.audit.record(tx, {
        actorUserId: actor.userId,
        action: 'leave.holiday_deleted',
        entity: 'holiday',
        entityId: id,
        before: { date: dateOut(current.date), country: current.country },
      });
    });
  }
}
