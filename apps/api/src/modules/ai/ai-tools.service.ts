import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AI_LIMITS,
  addDays,
  dateOnlySchema,
  truncateToolResult,
  type AiToolName,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AppException } from '../../common/errors/app-exception.js';
import { TenantContext } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { CapacityService } from '../capacity/capacity.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { LeaveBalancesService } from '../leave/leave-balances.service.js';
import { LeaveRequestsService } from '../leave/leave-requests.service.js';
import { LeaveTypesService } from '../leave/leave-types.service.js';
import { ProjectAccess } from '../projects/project-access.service.js';
import { workspaceToday } from '../projects/projects.present.js';
import { TasksService } from '../projects/tasks.service.js';
import type { ProviderTool } from './ai-provider.client.js';

const TEXT_MAX = 80;
const clip = (text: string) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text);
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

const period = z.object({ from: dateOnlySchema.optional(), to: dateOnlySchema.optional() });
const noArgs = z.object({});

const SCHEMA_PERIOD = {
  type: 'object',
  properties: {
    from: { type: 'string', description: 'First day, YYYY-MM-DD (default: today)' },
    to: { type: 'string', description: 'Last day, YYYY-MM-DD' },
  },
} as const;
const SCHEMA_NONE = { type: 'object', properties: {} } as const;

export const AI_TOOL_DEFINITIONS: Record<AiToolName, ProviderTool> = {
  get_my_leave_balance: {
    name: 'get_my_leave_balance',
    description:
      'Leave days of the person asking: remaining, used and pending per leave type this year.',
    parameters: SCHEMA_NONE,
  },
  get_my_open_tasks: {
    name: 'get_my_open_tasks',
    description: 'Open tasks assigned to the person asking, with status and due date.',
    parameters: SCHEMA_NONE,
  },
  get_my_goals: {
    name: 'get_my_goals',
    description: 'Open personal goals of the person asking, with progress and due date.',
    parameters: SCHEMA_NONE,
  },
  who_is_off: {
    name: 'who_is_off',
    description:
      'People with approved leave in a period (only people the asker may see). At most 31 days.',
    parameters: SCHEMA_PERIOD,
  },
  find_available_people: {
    name: 'find_available_people',
    description:
      'People with free time in a period (available minus planned), most free first (only people the asker may see). At most 14 days.',
    parameters: SCHEMA_PERIOD,
  },
};

/**
 * The read-only tools of the assistant (docs/adr/0025-ai-assistant.md). Every tool runs an existing service as the
 * person asking, so scopes, masking and 404s hold; results are trimmed to the fields below and capped in size.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly access: ProjectAccess,
    private readonly balances: LeaveBalancesService,
    private readonly types: LeaveTypesService,
    private readonly requests: LeaveRequestsService,
    private readonly tasks: TasksService,
    private readonly goals: GoalsService,
    private readonly capacity: CapacityService,
  ) {}

  /** Runs a tool and returns JSON text for the model; failures become a short error, never details. */
  async run(actor: RequestAuth, name: AiToolName, rawArguments: string): Promise<string> {
    try {
      let args: unknown = {};
      try {
        args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
      } catch {
        return JSON.stringify({ error: 'invalid_arguments' });
      }
      const result = await this.execute(actor, name, args);
      return truncateToolResult(JSON.stringify(result), AI_LIMITS.toolResultMaxChars);
    } catch (error) {
      if (error instanceof AppException) {
        return JSON.stringify({ error: error.code.toLowerCase() });
      }
      return JSON.stringify({ error: 'failed' });
    }
  }

  private async execute(actor: RequestAuth, name: AiToolName, args: unknown): Promise<unknown> {
    switch (name) {
      case 'get_my_leave_balance': {
        noArgs.parse(args);
        const [balances, types] = await Promise.all([
          this.balances.list(actor, {}),
          this.types.list(actor),
        ]);
        const label = new Map(types.map((t) => [t.id, t.key ?? t.name ?? 'leave']));
        return {
          year: balances.year,
          balances: balances.balances.map((b) => ({
            type: label.get(b.leaveTypeId) ?? 'leave',
            remainingDays: b.remaining,
            usedDays: b.used,
            pendingDays: b.pending,
          })),
        };
      }
      case 'get_my_open_tasks': {
        noArgs.parse(args);
        const list = await this.tasks.list(actor, {
          assignee: 'me',
          status: 'open',
          type: 'all',
          page: 1,
          pageSize: 20,
        });
        return {
          total: list.total,
          tasks: list.items.map((t) => ({
            key: t.key,
            title: clip(t.title),
            status: t.status,
            dueDate: t.dueDate,
            overdue: t.overdue,
          })),
        };
      }
      case 'get_my_goals': {
        noArgs.parse(args);
        const ownId = await this.db.tx((tx) => this.access.ownEmployeeId(tx, actor));
        if (!ownId) return { goals: [] };
        const list = await this.goals.list(actor, {
          scope: 'personal',
          status: 'open',
          employeeId: ownId,
          page: 1,
          pageSize: 20,
        });
        return {
          goals: list.items.map((g) => ({
            title: clip(g.title),
            status: g.status,
            progressPercent: g.progressPct,
            dueDate: g.dueDate,
            overdue: g.overdue,
          })),
        };
      }
      case 'who_is_off': {
        const { from, to } = period.parse(args);
        const start = from ?? (await this.today());
        const end = to ?? addDays(start, 6);
        if (end < start || end > addDays(start, 30)) {
          throw new AppException('VALIDATION_FAILED', { message: 'period' });
        }
        const list = await this.requests.list(actor, {
          status: 'approved',
          from: start,
          to: end,
          page: 1,
          pageSize: 50,
        });
        return {
          from: start,
          to: end,
          people: list.items.map((r) => ({
            name: fullName(r.employee),
            from: r.startDate,
            to: r.endDate,
          })),
        };
      }
      case 'find_available_people': {
        const { from, to } = period.parse(args);
        const start = from ?? (await this.today());
        const end = to ?? addDays(start, 6);
        if (end < start || end > addDays(start, 13)) {
          throw new AppException('VALIDATION_FAILED', { message: 'period' });
        }
        const list = await this.capacity.overview(actor, {
          from: start,
          to: end,
          page: 1,
          pageSize: 100,
        });
        return {
          from: start,
          to: end,
          people: list.items
            .filter((p) => p.freeMinutes >= 60)
            .sort((a, b) => b.freeMinutes - a.freeMinutes)
            .slice(0, 15)
            .map((p) => ({
              name: fullName(p.employee),
              freeHours: Math.round((p.freeMinutes / 60) * 2) / 2,
            })),
        };
      }
    }
  }

  private today(): Promise<string> {
    return this.db.tx((tx) => workspaceToday(tx, this.context));
  }
}
