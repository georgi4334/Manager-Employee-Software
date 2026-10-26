import { Injectable } from '@nestjs/common';
import {
  type CreateSkillCategoryRequest,
  type CreateSkillRequest,
  type PersonSkills,
  type SkillCatalog,
  type SkillPeople,
  type SkillPeopleQuery,
  type UpdateSkillCategoryRequest,
  type UpdateSkillRequest,
} from '@intime/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { AuthorizationService } from '../../common/auth/authorization.service.js';
import { TenantContext, type TenantTx } from '../../infrastructure/tenancy/tenant-context.js';
import { TenantDb } from '../../infrastructure/tenancy/tenant-db.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  conflict,
  forbidden,
  guardUnique,
  invalid,
  notFound,
} from '../projects/projects.shared.js';

const PERSON = { id: true, firstName: true, lastName: true } as const;
const RATING = {
  skillId: true,
  level: true,
  assessedAt: true,
  assessedByEmployeeId: true,
  employeeId: true,
  assessedBy: { select: PERSON },
} satisfies Prisma.EmployeeSkillSelect;
type RatingRow = Prisma.EmployeeSkillGetPayload<{ select: typeof RATING }>;

/** The skill catalog and who knows what (docs/adr/0022-skills-matrix.md). */
@Injectable()
export class SkillsService {
  constructor(
    private readonly db: TenantDb,
    private readonly context: TenantContext,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  // ----- catalog ---------------------------------------------------------------------------------

  catalog(actor: RequestAuth): Promise<SkillCatalog> {
    return this.db.tx(async (tx) => {
      const canManage = Boolean(actor.permissions['skill.manage_catalog']);
      const [categories, used] = await Promise.all([
        tx.skillCategory.findMany({
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            skills: {
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              select: { id: true, name: true, description: true, archivedAt: true },
            },
          },
        }),
        canManage
          ? tx.employeeSkill.groupBy({ by: ['skillId'], _count: { _all: true } })
          : Promise.resolve([]),
      ]);
      const inUse = new Set(used.map((u) => u.skillId));
      return {
        canManage,
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          canDelete: canManage && c.skills.length === 0,
          skills: c.skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            archived: s.archivedAt !== null,
            canDelete: canManage && !inUse.has(s.id),
          })),
        })),
      };
    });
  }

  createCategory(actor: RequestAuth, body: CreateSkillCategoryRequest): Promise<SkillCatalog> {
    return this.db.tx(async (tx) => {
      await this.assertFreeCategoryName(tx, body.name);
      const created = await guardUnique(
        () => tx.skillCategory.create({ data: { name: body.name }, select: { id: true } }),
        'name',
      );
      await this.record(tx, actor, 'skill.category_created', 'skill_category', created.id);
      return this.catalogOf(actor);
    });
  }

  updateCategory(
    actor: RequestAuth,
    id: string,
    body: UpdateSkillCategoryRequest,
  ): Promise<SkillCatalog> {
    return this.db.tx(async (tx) => {
      if (!(await tx.skillCategory.findUnique({ where: { id }, select: { id: true } }))) {
        throw notFound('Category');
      }
      await this.assertFreeCategoryName(tx, body.name, id);
      await guardUnique(
        () => tx.skillCategory.update({ where: { id }, data: { name: body.name } }),
        'name',
      );
      await this.record(tx, actor, 'skill.category_updated', 'skill_category', id, ['name']);
      return this.catalogOf(actor);
    });
  }

  deleteCategory(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const row = await tx.skillCategory.findUnique({
        where: { id },
        select: { id: true, _count: { select: { skills: true } } },
      });
      if (!row) throw notFound('Category');
      if (row._count.skills > 0) throw conflict('in_use', 'The category still holds skills');
      await tx.skillCategory.delete({ where: { id } });
      await this.record(tx, actor, 'skill.category_deleted', 'skill_category', id);
    });
  }

  createSkill(actor: RequestAuth, body: CreateSkillRequest): Promise<SkillCatalog> {
    return this.db.tx(async (tx) => {
      await this.assertCategory(tx, body.categoryId);
      await this.assertFreeSkillName(tx, body.name);
      const created = await guardUnique(
        () =>
          tx.skill.create({
            data: {
              categoryId: body.categoryId,
              name: body.name,
              description: body.description ?? null,
            },
            select: { id: true },
          }),
        'name',
      );
      await this.record(tx, actor, 'skill.created', 'skill', created.id);
      return this.catalogOf(actor);
    });
  }

  updateSkill(actor: RequestAuth, id: string, body: UpdateSkillRequest): Promise<SkillCatalog> {
    return this.db.tx(async (tx) => {
      const row = await tx.skill.findUnique({
        where: { id },
        select: { id: true, archivedAt: true },
      });
      if (!row) throw notFound('Skill');
      if (body.categoryId) await this.assertCategory(tx, body.categoryId);
      if (body.name) await this.assertFreeSkillName(tx, body.name, id);
      await guardUnique(
        () =>
          tx.skill.update({
            where: { id },
            data: {
              ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.archived !== undefined
                ? { archivedAt: body.archived ? (row.archivedAt ?? new Date()) : null }
                : {}),
            },
          }),
        'name',
      );
      await this.record(tx, actor, 'skill.updated', 'skill', id, Object.keys(body).sort());
      return this.catalogOf(actor);
    });
  }

  deleteSkill(actor: RequestAuth, id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      const row = await tx.skill.findUnique({
        where: { id },
        select: { id: true, _count: { select: { ratings: true } } },
      });
      if (!row) throw notFound('Skill');
      if (row._count.ratings > 0) throw conflict('in_use', 'Somebody has rated this skill');
      await tx.skill.delete({ where: { id } });
      await this.record(tx, actor, 'skill.deleted', 'skill', id);
    });
  }

  // ----- ratings ---------------------------------------------------------------------------------

  people(actor: RequestAuth, query: SkillPeopleQuery): Promise<SkillPeople> {
    return this.db.tx(async (tx) => {
      const everyone = await tx.employee.findMany({
        where: { status: 'active' },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        select: PERSON,
      });
      const allowed = await this.authz.allowedEmployees(
        actor,
        'skill.view',
        everyone.map((e) => e.id),
      );
      const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
      let candidates = everyone.filter(
        (e) =>
          allowed.has(e.id) &&
          words.every((w) => `${e.firstName} ${e.lastName}`.toLowerCase().includes(w)),
      );

      if (query.skillId || query.categoryId) {
        const matching = await tx.employeeSkill.findMany({
          where: {
            employeeId: { in: candidates.map((c) => c.id) },
            ...(query.skillId
              ? { skillId: query.skillId, level: { gte: query.minLevel ?? 1 } }
              : { skill: { categoryId: query.categoryId } }),
          },
          select: { employeeId: true },
        });
        const keep = new Set(matching.map((m) => m.employeeId));
        candidates = candidates.filter((c) => keep.has(c.id));
      }

      const slice = candidates.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      );
      const sliceIds = slice.map((s) => s.id);
      const [ratings, editable] = await Promise.all([
        tx.employeeSkill.findMany({
          where: { employeeId: { in: sliceIds } },
          select: RATING,
          orderBy: [{ skill: { name: 'asc' } }, { id: 'asc' }],
        }),
        this.authz.allowedEmployees(actor, 'skill.update', sliceIds),
      ]);
      return {
        items: slice.map((person) => ({
          employee: person,
          ratings: ratings.filter((r) => r.employeeId === person.id).map((r) => this.rating(r)),
          canEdit: editable.has(person.id),
        })),
        total: candidates.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  employee(actor: RequestAuth, employeeId: string): Promise<PersonSkills> {
    return this.db.tx(async (tx) => {
      await this.visibleEmployee(tx, actor, employeeId);
      return this.personSkills(tx, actor, employeeId);
    });
  }

  setRating(
    actor: RequestAuth,
    employeeId: string,
    skillId: string,
    level: number,
  ): Promise<PersonSkills> {
    return this.db.tx(async (tx) => {
      await this.visibleEmployee(tx, actor, employeeId);
      await this.assertMayRate(actor, employeeId);
      const skill = await tx.skill.findUnique({
        where: { id: skillId },
        select: { id: true, archivedAt: true },
      });
      if (!skill) throw notFound('Skill');
      if (skill.archivedAt) throw invalid('skillId', 'skill_archived', 'This skill is archived');
      const assessor = await tx.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      const tenantId = this.context.requireTenantId();
      await tx.employeeSkill.upsert({
        where: { tenantId_employeeId_skillId: { tenantId, employeeId, skillId } },
        create: { employeeId, skillId, level, assessedByEmployeeId: assessor?.id ?? null },
        update: { level, assessedByEmployeeId: assessor?.id ?? null, assessedAt: new Date() },
      });
      return this.personSkills(tx, actor, employeeId);
    });
  }

  removeRating(actor: RequestAuth, employeeId: string, skillId: string): Promise<PersonSkills> {
    return this.db.tx(async (tx) => {
      await this.visibleEmployee(tx, actor, employeeId);
      await this.assertMayRate(actor, employeeId);
      const removed = await tx.employeeSkill.deleteMany({ where: { employeeId, skillId } });
      if (removed.count === 0) throw notFound('Rating');
      return this.personSkills(tx, actor, employeeId);
    });
  }

  // ----- helpers -------------------------------------------------------------------------------

  /** A person the caller may not see does not exist for them. */
  private async visibleEmployee(
    tx: TenantTx,
    actor: RequestAuth,
    employeeId: string,
  ): Promise<void> {
    const found = await tx.employee.findFirst({
      where: { id: employeeId, status: 'active' },
      select: { id: true },
    });
    if (!found || !(await this.authz.can(actor, 'skill.view', { ownerEmployeeId: employeeId }))) {
      throw notFound('Employee');
    }
  }

  private async assertMayRate(actor: RequestAuth, employeeId: string): Promise<void> {
    if (!(await this.authz.can(actor, 'skill.update', { ownerEmployeeId: employeeId }))) {
      throw forbidden('Not allowed to change the skills of this person');
    }
  }

  private async personSkills(
    tx: TenantTx,
    actor: RequestAuth,
    employeeId: string,
  ): Promise<PersonSkills> {
    const [employee, ratings, editable] = await Promise.all([
      tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: PERSON }),
      tx.employeeSkill.findMany({
        where: { employeeId },
        select: RATING,
        orderBy: [{ skill: { name: 'asc' } }, { id: 'asc' }],
      }),
      this.authz.can(actor, 'skill.update', { ownerEmployeeId: employeeId }),
    ]);
    return { employee, ratings: ratings.map((r) => this.rating(r)), canEdit: editable };
  }

  private rating(r: RatingRow): PersonSkills['ratings'][number] {
    return {
      skillId: r.skillId,
      level: r.level,
      assessedBy: r.assessedBy,
      selfAssessed: r.assessedByEmployeeId === r.employeeId,
      assessedAt: r.assessedAt.toISOString(),
    };
  }

  private catalogOf(actor: RequestAuth): Promise<SkillCatalog> {
    return this.catalog(actor);
  }

  private async assertCategory(tx: TenantTx, id: string): Promise<void> {
    if (!(await tx.skillCategory.findUnique({ where: { id }, select: { id: true } }))) {
      throw invalid('categoryId', 'unknown_category', 'This category does not exist');
    }
  }

  // Names are compared without regard to case, in memory: the lists are short and no wildcard can slip in.
  private async assertFreeCategoryName(tx: TenantTx, name: string, except?: string): Promise<void> {
    const all = await tx.skillCategory.findMany({ select: { id: true, name: true } });
    if (all.some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase())) {
      throw conflict('name', 'A category with this name exists');
    }
  }

  private async assertFreeSkillName(tx: TenantTx, name: string, except?: string): Promise<void> {
    const all = await tx.skill.findMany({ select: { id: true, name: true } });
    if (all.some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase())) {
      throw conflict('name', 'A skill with this name exists');
    }
  }

  private record(
    tx: TenantTx,
    actor: RequestAuth,
    action: string,
    entity: string,
    entityId: string,
    fields?: string[],
  ): Promise<void> {
    return this.audit.record(tx, {
      actorUserId: actor.userId,
      action,
      entity,
      entityId,
      ...(fields ? { after: { fields } } : {}),
    });
  }
}
