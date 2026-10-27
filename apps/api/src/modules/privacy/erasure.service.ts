import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import { SystemPrismaService } from '../../infrastructure/prisma/system-prisma.service.js';

const PLACEHOLDER = '—';
const conflict = (field: string, message: string) =>
  new AppException('CONFLICT', { message, params: { field } });

/**
 * Irreversible anonymisation of a former employee (docs/adr/0011-gdpr-export-erasure.md). Uses the system
 * connection because the application role may neither delete notifications nor edit leave decisions; every
 * statement is therefore scoped by tenant and employee here, and the caller has already checked permission and
 * that the employee belongs to the caller's workspace.
 */
@Injectable()
export class ErasureService {
  constructor(private readonly system: SystemPrismaService) {}

  /**
   * `actorUserId` is null for the automatic retention run (ADR 0027): then people on hold are skipped and the audit entry
   * says why it happened.
   */
  async erase(tenantId: string, actorUserId: string | null, employeeId: string): Promise<void> {
    const automatic = actorUserId === null;
    await this.system.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, tenantId },
        select: { userId: true, status: true, erasedAt: true },
      });
      if (!employee) throw new AppException('NOT_FOUND', { message: 'Employee not found' });
      if (actorUserId && employee.userId && employee.userId === actorUserId) {
        throw conflict('self', 'You cannot erase your own data');
      }
      if (employee.erasedAt) throw conflict('erased', 'The data was already erased');
      if (employee.status !== 'inactive') {
        throw conflict('active', 'Deactivate the employee before erasing their data');
      }

      // The condition makes a concurrent reactivation or a second erasure lose cleanly.
      const claimed = await tx.employee.updateMany({
        where: {
          id: employeeId,
          tenantId,
          status: 'inactive',
          erasedAt: null,
          ...(automatic ? { retentionHold: false } : {}),
        },
        data: {
          firstName: PLACEHOLDER,
          lastName: `#${employeeId.slice(-6)}`,
          employeeNo: null,
          jobTitle: null,
          location: null,
          seniority: null,
          birthDate: null,
          phone: null,
          country: null,
          departmentId: null,
          managerId: null,
          erasedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw conflict('active', 'The employee changed, try again');

      await tx.teamMember.deleteMany({ where: { tenantId, employeeId } });
      await tx.attendanceRecord.updateMany({
        where: { tenantId, employeeId },
        data: { note: null },
      });
      await tx.timeEntry.updateMany({ where: { tenantId, employeeId }, data: { note: null } });
      // Personal goals go with the person; what they wrote in check-ins elsewhere is cleared, the numbers stay.
      await tx.goal.deleteMany({
        where: { tenantId, scope: 'personal', ownerEmployeeId: employeeId },
      });
      await tx.goalUpdate.updateMany({
        where: { tenantId, authorEmployeeId: employeeId },
        data: { comment: null },
      });
      // Reviews about the person go with them; what they wrote about others stays with the other person's file (ADR 0023).
      await tx.review.deleteMany({ where: { tenantId, employeeId } });
      // Skill levels are personal data; the catalog is not (ADR 0022).
      await tx.employeeSkill.deleteMany({ where: { tenantId, employeeId } });
      // Working hours are not a statutory record (ADR 0026).
      await tx.workSchedule.deleteMany({ where: { tenantId, employeeId } });
      // Feedback they gave or received is about people, in words: it goes with them (ADR 0021).
      await tx.feedback.deleteMany({
        where: { tenantId, OR: [{ fromEmployeeId: employeeId }, { toEmployeeId: employeeId }] },
      });
      // A 1:1 holds the other person's private notes about this one too: the whole meeting goes (ADR 0020).
      await tx.oneOnOne.deleteMany({
        where: { tenantId, OR: [{ managerEmployeeId: employeeId }, { employeeId }] },
      });
      // Invitations they received; the guests of their own personal events go with those events (ADR 0028).
      await tx.calendarAttendee.deleteMany({ where: { tenantId, employeeId } });
      await tx.calendarEvent.deleteMany({
        where: { tenantId, ownerEmployeeId: employeeId, scope: 'personal' },
      });
      await tx.projectAssignment.updateMany({
        where: { tenantId, employeeId },
        data: { role: null },
      });
      await tx.leaveRequest.updateMany({ where: { tenantId, employeeId }, data: { reason: null } });
      await tx.leaveApproval.updateMany({
        where: {
          tenantId,
          OR: [{ approverEmployeeId: employeeId }, { request: { employeeId } }],
        },
        data: { comment: null },
      });

      // Other people's notifications and queued events that carry this person's name.
      for (const table of ['notification', 'outbox_event'] as const) {
        await tx.$executeRawUnsafe(
          `UPDATE "${table}" SET params = jsonb_set(params, '{employeeName}', to_jsonb($3::text))
           WHERE tenant_id = $1::uuid AND params ? 'employeeName'
             AND params->>'requestId' IN (
               SELECT id::text FROM leave_request WHERE tenant_id = $1::uuid AND employee_id = $2::uuid)`,
          tenantId,
          employeeId,
          PLACEHOLDER,
        );
      }

      const userId = employee.userId;
      if (userId) {
        await tx.$executeRawUnsafe(
          `DELETE FROM outbox_event WHERE tenant_id = $1::uuid AND params->>'recipientUserId' = $2`,
          tenantId,
          userId,
        );
        // Questions to the assistant, the stored key and the consent record go with the person (ADR 0025).
        await tx.aiConversation.deleteMany({ where: { tenantId, userId } }); // messages cascade
        await tx.aiCredential.deleteMany({ where: { tenantId, userId } });
        await tx.aiUserSetting.deleteMany({ where: { tenantId, userId } });
        await tx.notification.deleteMany({ where: { tenantId, recipientUserId: userId } });
        await tx.notificationPreference.deleteMany({ where: { tenantId, userId } });
        await tx.session.deleteMany({ where: { tenantId, userId } }); // refresh tokens cascade
        await tx.authToken.deleteMany({ where: { tenantId, userId } });
        await tx.authIdentity.deleteMany({ where: { tenantId, userId } });
        await tx.userRole.deleteMany({ where: { tenantId, userId } });
        await tx.user.update({
          where: { id: userId },
          data: {
            email: `erased-${userId}@invalid`,
            status: 'disabled',
            locale: null,
            timezone: null,
            lastLoginAt: null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          action: 'privacy.erased',
          entity: 'employee',
          entityId: employeeId,
          ...(automatic ? { after: { reason: 'retention' } } : {}),
        },
      });
    });
  }
}
