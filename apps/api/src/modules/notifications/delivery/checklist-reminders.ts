import { addDays, checklistReminderDue, todayIn } from '@intime/contracts';
import type { TenantTx } from '../../../infrastructure/tenancy/tenant-context.js';

/** Steps looked at per workspace and run; what is left is picked up by the next run. */
const BATCH = 500;

const day = (date: Date): string => date.toISOString().slice(0, 10);
const dateIn = (value: string): Date => new Date(`${value}T00:00:00Z`);

export interface ChecklistReminder {
  recipientUserId: string;
  checklistId: string;
  date: string;
}

/**
 * Reminders before a checklist step is due (docs/adr/0040-onboarding-checklists.md, follow-ups): open steps of open
 * checklists with an assignee, due today or tomorrow in the workspace time zone, each claimed once through
 * `reminded_at`. Only an active assignee with an account is told. Returns how many steps were claimed.
 */
export async function remindChecklists(
  tx: TenantTx,
  tenantId: string,
  now: Date,
  queue: (reminder: ChecklistReminder) => Promise<void>,
): Promise<number> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultTimezone: true },
  });
  const today = todayIn(tenant?.defaultTimezone ?? 'UTC', now);

  const items = await tx.checklistItem.findMany({
    where: {
      doneAt: null,
      remindedAt: null,
      assigneeEmployeeId: { not: null },
      dueDate: { gte: dateIn(today), lte: dateIn(addDays(today, 1)) },
      checklist: { status: 'open' },
    },
    select: {
      id: true,
      checklistId: true,
      dueDate: true,
      assignee: { select: { userId: true, status: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    take: BATCH,
  });

  let claimedSteps = 0;
  for (const item of items) {
    const date = day(item.dueDate);
    if (!checklistReminderDue({ dueDate: date, done: false }, today)) continue;
    // Claim first: a second run (or a second server) finds it taken.
    const claimed = await tx.checklistItem.updateMany({
      where: { id: item.id, remindedAt: null, doneAt: null },
      data: { remindedAt: now },
    });
    if (claimed.count !== 1) continue;
    claimedSteps += 1;
    if (item.assignee?.userId && item.assignee.status === 'active') {
      await queue({ recipientUserId: item.assignee.userId, checklistId: item.checklistId, date });
    }
  }
  return claimedSteps;
}
