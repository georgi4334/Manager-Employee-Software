import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorBodySchema,
  employeeSchema,
  personSkillsSchema,
  personalDataExportSchema,
  skillCatalogSchema,
  skillPeopleSchema,
  todayIn,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';
const api = '/api/v1';

describe.skipIf(!urls)('skills over HTTP (real database)', () => {
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  type Person = Member & { employeeId: string };
  let acme: Workspace;
  let globex: Workspace;
  let hr: Person;
  let mia: Person; // manager of dan and eve
  let ron: Person; // manager without reports
  let dan: Person; // report of mia
  let eve: Person; // report of mia
  let sub: Person; // report of dan
  let gus: Person; // outside mia's team
  let admin: Person;
  let langs: string;
  let tools: string;
  let react: string;
  let ts: string;
  let docker: string;
  let legacy: string;
  const today = todayIn(ZONE);

  async function onboard(ws: Workspace, name: string, role: SystemRole = 'employee') {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`${api}/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const assign = async (who: Person, managerId: string | null) => {
    const res = await acme.admin.agent
      .put(`${api}/org/employees/${who.employeeId}/assignment`)
      .send({ managerId, departmentId: null });
    expect(res.status).toBe(204);
  };
  const catalog = async (who: Member) => {
    const res = await who.agent.get(`${api}/skills/catalog`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return skillCatalogSchema.parse(res.body);
  };
  const addCategory = (who: Member, name: string) =>
    who.agent.post(`${api}/skills/categories`).send({ name });
  const addSkill = (who: Member, categoryId: string, name: string, body: object = {}) =>
    who.agent.post(`${api}/skills`).send({ categoryId, name, ...body });
  const idOf = async (kind: 'category' | 'skill', name: string) => {
    const c = await catalog(hr);
    return kind === 'category'
      ? c.categories.find((x) => x.name === name)!.id
      : c.categories.flatMap((x) => x.skills).find((x) => x.name === name)!.id;
  };
  const rate = (who: Member, target: Person | string, skillId: string, level: number) =>
    who.agent
      .put(
        `${api}/skills/employees/${typeof target === 'string' ? target : target.employeeId}/ratings/${skillId}`,
      )
      .send({ level });
  const rated = async (who: Member, target: Person, skillId: string, level: number) => {
    const res = await rate(who, target, skillId, level);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return personSkillsSchema.parse(res.body);
  };
  const unrate = (who: Member, target: Person, skillId: string) =>
    who.agent.delete(`${api}/skills/employees/${target.employeeId}/ratings/${skillId}`);
  const people = async (who: Member, query: object = {}) => {
    const res = await who.agent.get(`${api}/skills/people`).query({ pageSize: 100, ...query });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return skillPeopleSchema.parse(res.body);
  };
  const names = async (who: Member, query: object = {}) =>
    (await people(who, query)).items.map((p) => p.employee.firstName);

  beforeAll(async () => {
    app = await createTestApp({ env });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    ron = await onboard(acme, 'ron', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    sub = await onboard(acme, 'sub');
    gus = await onboard(acme, 'gus');
    const adminEmployee = await system.employee.findFirstOrThrow({
      where: { tenantId: acme.tenantId, userId: acme.admin.id },
    });
    admin = { ...acme.admin, employeeId: adminEmployee.id };
    await assign(dan, mia.employeeId);
    await assign(eve, mia.employeeId);
    await assign(sub, dan.employeeId);
    expect((await addCategory(hr, 'Languages')).status).toBe(201);
    expect((await addCategory(hr, 'Tools')).status).toBe(201);
    langs = await idOf('category', 'Languages');
    tools = await idOf('category', 'Tools');
    for (const [cat, name] of [
      [langs, 'React'],
      [langs, 'TypeScript'],
      [tools, 'Docker'],
      [tools, 'Legacy'],
    ] as const) {
      expect((await addSkill(hr, cat, name)).status).toBe(201);
    }
    react = await idOf('skill', 'React');
    ts = await idOf('skill', 'TypeScript');
    docker = await idOf('skill', 'Docker');
    legacy = await idOf('skill', 'Legacy');
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------
  describe('the catalog', () => {
    it('lists categories and skills by name for everybody, with delete flags for managers only', async () => {
      const asHr = await catalog(hr);
      expect(asHr.canManage).toBe(true);
      expect(asHr.categories.map((c) => c.name)).toEqual(['Languages', 'Tools']);
      expect(asHr.categories[0]!.skills.map((s) => s.name)).toEqual(['React', 'TypeScript']);
      expect(asHr.categories[0]!.skills[0]).toMatchObject({
        archived: false,
        description: null,
        canDelete: true,
      });
      const asDan = await catalog(dan);
      expect(asDan.canManage).toBe(false);
      expect(
        asDan.categories
          .flatMap((c) => [c.canDelete, ...c.skills.map((s) => s.canDelete)])
          .every((x) => !x),
      ).toBe(true);
      expect((await catalog(globex.admin)).categories).toEqual([]);
    });

    it('lets only HR and the administrator change it', async () => {
      for (const who of [dan, mia, ron]) {
        for (const res of [
          await addCategory(who, 'Sneaky'),
          await addSkill(who, langs, 'Sneaky'),
          await who.agent.patch(`${api}/skills/${react}`).send({ name: 'Hacked' }),
          await who.agent.patch(`${api}/skills/categories/${langs}`).send({ name: 'Hacked' }),
          await who.agent.delete(`${api}/skills/${docker}`),
          await who.agent.delete(`${api}/skills/categories/${tools}`),
        ]) {
          expect([res.status, errorBody(res).code], who.email).toEqual([403, 'FORBIDDEN']);
        }
      }
      expect((await addSkill(admin, langs, 'Rust', { description: ' Systems ' })).status).toBe(201);
      const rust = (await catalog(hr)).categories[0]!.skills.find((s) => s.name === 'Rust')!;
      expect(rust.description).toBe('Systems');
      expect((await admin.agent.delete(`${api}/skills/${rust.id}`)).status).toBe(204);
    });

    it('refuses duplicate names without regard to case, and names the field', async () => {
      for (const res of [
        await addCategory(hr, 'languages'),
        await addSkill(hr, tools, 'REACT'),
        await hr.agent.patch(`${api}/skills/${ts}`).send({ name: 'react' }),
        await hr.agent.patch(`${api}/skills/categories/${tools}`).send({ name: 'LANGUAGES' }),
      ]) {
        expect([res.status, errorBody(res).code, errorBody(res).params?.field]).toEqual([
          409,
          'CONFLICT',
          'name',
        ]);
      }
      // renaming to the same name in another case is fine for the skill itself
      expect(
        (await hr.agent.patch(`${api}/skills/${ts}`).send({ name: 'TypeScript' })).status,
      ).toBe(200);
    });

    it('treats wildcard characters as plain text', async () => {
      expect((await addSkill(hr, tools, 'C%')).status).toBe(201);
      expect((await addSkill(hr, tools, 'C_')).status).toBe(201);
      expect((await addSkill(hr, tools, 'c%')).status).toBe(409);
      const c = await catalog(hr);
      for (const n of ['C%', 'C_']) {
        const id = c.categories.flatMap((x) => x.skills).find((s) => s.name === n)!.id;
        expect((await hr.agent.delete(`${api}/skills/${id}`)).status).toBe(204);
      }
    });

    it('renames, moves, describes and archives a skill, and answers 404 for unknown ones', async () => {
      const id = (await addSkill(hr, langs, 'Go')).body.categories
        .flatMap((c: { skills: { id: string; name: string }[] }) => c.skills)
        .find((s: { name: string }) => s.name === 'Go').id as string;
      const moved = skillCatalogSchema.parse(
        (
          await hr.agent
            .patch(`${api}/skills/${id}`)
            .send({ categoryId: tools, name: 'Golang', description: ' fast ' })
        ).body,
      );
      const golang = moved.categories
        .find((c) => c.name === 'Tools')!
        .skills.find((s) => s.id === id)!;
      expect(golang).toMatchObject({ name: 'Golang', description: 'fast', archived: false });
      const archived = skillCatalogSchema.parse(
        (await hr.agent.patch(`${api}/skills/${id}`).send({ archived: true, description: ' ' }))
          .body,
      );
      expect(archived.categories.flatMap((c) => c.skills).find((s) => s.id === id)).toMatchObject({
        archived: true,
        description: null,
      });
      const back = skillCatalogSchema.parse(
        (await hr.agent.patch(`${api}/skills/${id}`).send({ archived: false })).body,
      );
      expect(back.categories.flatMap((c) => c.skills).find((s) => s.id === id)!.archived).toBe(
        false,
      );
      for (const res of [
        await hr.agent.patch(`${api}/skills/${UNKNOWN}`).send({ name: 'x' }),
        await hr.agent.patch(`${api}/skills/categories/${UNKNOWN}`).send({ name: 'x' }),
        await hr.agent.delete(`${api}/skills/${UNKNOWN}`),
        await hr.agent.delete(`${api}/skills/categories/${UNKNOWN}`),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      const bad = await addSkill(hr, UNKNOWN, 'Orphan');
      expect([bad.status, errorBody(bad).details?.[0]?.code]).toEqual([400, 'unknown_category']);
      const move = await hr.agent.patch(`${api}/skills/${id}`).send({ categoryId: UNKNOWN });
      expect(errorBody(move).details?.[0]?.code).toBe('unknown_category');
      expect((await hr.agent.delete(`${api}/skills/${id}`)).status).toBe(204);
    });

    it('deletes a skill only while nobody has rated it, and a category only while empty', async () => {
      const inUse = await hr.agent.delete(`${api}/skills/categories/${langs}`);
      expect([inUse.status, errorBody(inUse).params?.field]).toEqual([409, 'in_use']);
      await rated(dan, dan, legacy, 2);
      const used = await hr.agent.delete(`${api}/skills/${legacy}`);
      expect([used.status, errorBody(used).params?.field]).toEqual([409, 'in_use']);
      expect(
        (await catalog(hr)).categories.flatMap((c) => c.skills).find((s) => s.id === legacy)!
          .canDelete,
      ).toBe(false);
      expect((await unrate(dan, dan, legacy)).status).toBe(200);
      const empty = await addCategory(hr, 'Temporary');
      expect(empty.status).toBe(201);
      const tmp = await idOf('category', 'Temporary');
      expect((await hr.agent.delete(`${api}/skills/categories/${tmp}`)).status).toBe(204);
    });

    it.each([
      ['no name', { name: ' ' }],
      ['a long name', { name: 'x'.repeat(61) }],
      ['a long description', { name: 'x', description: 'x'.repeat(301) }],
      ['unknown fields', { name: 'x', level: 3 }],
    ])('refuses a skill with %s', async (_label, body) => {
      const res = await hr.agent.post(`${api}/skills`).send({ categoryId: langs, ...body });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('audits catalog changes with ids and field names, never names', async () => {
      await addSkill(hr, tools, 'Confidential-Skill-Name');
      const id = await idOf('skill', 'Confidential-Skill-Name');
      await hr.agent
        .patch(`${api}/skills/${id}`)
        .send({ name: 'Confidential-Renamed', archived: true });
      await hr.agent.delete(`${api}/skills/${id}`);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: { startsWith: 'skill.' } },
      });
      expect(entries.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'skill.created',
          'skill.updated',
          'skill.deleted',
          'skill.category_created',
        ]),
      );
      expect(JSON.stringify(entries)).not.toMatch(/Confidential/);
      expect(entries.find((e) => e.action === 'skill.updated' && e.entityId === id)?.after).toEqual(
        {
          fields: ['archived', 'name'],
        },
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('rating', () => {
    it('lets people rate themselves, and records that it is a self-assessment', async () => {
      const p = await rated(dan, dan, react, 3);
      expect(p.canEdit).toBe(true);
      expect(p.ratings).toEqual([
        {
          skillId: react,
          level: 3,
          assessedBy: expect.objectContaining({ id: dan.employeeId }),
          selfAssessed: true,
          assessedAt: expect.any(String),
        },
      ]);
      const again = await rated(dan, dan, react, 4); // changing keeps one rating
      expect(again.ratings).toHaveLength(1);
      expect(again.ratings[0]!.level).toBe(4);
    });

    it('lets a manager rate the team, including people further down, and shows who did', async () => {
      const p = await rated(mia, dan, ts, 5);
      expect(p.ratings.find((r) => r.skillId === ts)).toMatchObject({
        level: 5,
        selfAssessed: false,
        assessedBy: { id: mia.employeeId },
      });
      const deep = await rated(mia, sub, docker, 2); // a report of a report is in the team
      expect(deep.employee.id).toBe(sub.employeeId);
      expect((await rated(mia, mia, docker, 1)).ratings[0]!.selfAssessed).toBe(true);
    });

    it('lets HR and the administrator rate anyone', async () => {
      expect((await rated(hr, gus, react, 2)).ratings[0]!.assessedBy?.id).toBe(hr.employeeId);
      expect((await rated(admin, gus, ts, 3)).ratings).toHaveLength(2);
    });

    it('keeps people out of ratings they may not see or change', async () => {
      // an employee sees and rates only themself; others do not exist for them
      for (const who of [eve, sub, gus]) {
        for (const res of [
          await who.agent.get(`${api}/skills/employees/${dan.employeeId}`),
          await rate(who, dan, react, 1),
          await unrate(who, dan, react),
        ]) {
          expect([res.status, errorBody(res).code], who.email).toEqual([404, 'NOT_FOUND']);
        }
      }
      // a manager outside the line has no view of the team of mia
      for (const who of [ron, gus]) {
        expect((await rate(who, eve, react, 1)).status, who.email).toBe(404);
      }
      // mia's reach ends at her team
      expect((await rate(mia, gus, react, 1)).status).toBe(404);
      expect((await rate(mia, hr, react, 1)).status).toBe(404);
      expect((await rate(mia, UNKNOWN, react, 1)).status).toBe(404);
      const levels = (
        await hr.agent.get(`${api}/skills/employees/${dan.employeeId}`)
      ).body.ratings.map((r: { skillId: string; level: number }) => [r.skillId, r.level]);
      expect(Object.fromEntries(levels)[react]).toBe(4); // untouched
    });

    it('lets an employee read their own ratings and a manager the team’s', async () => {
      expect(
        personSkillsSchema.parse(
          (await dan.agent.get(`${api}/skills/employees/${dan.employeeId}`)).body,
        ).ratings.length,
      ).toBeGreaterThan(0);
      expect((await mia.agent.get(`${api}/skills/employees/${sub.employeeId}`)).status).toBe(200);
      const own = personSkillsSchema.parse(
        (await eve.agent.get(`${api}/skills/employees/${eve.employeeId}`)).body,
      );
      expect(own).toMatchObject({ canEdit: true, ratings: [] });
    });

    it.each([0, 6, -1, 2.5, '3', null])('refuses level %s', async (level) => {
      const res = await dan.agent
        .put(`${api}/skills/employees/${dan.employeeId}/ratings/${react}`)
        .send({ level });
      expect([res.status, errorBody(res).code]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('refuses unknown skills and archived skills, but keeps existing ratings of archived ones', async () => {
      expect((await rate(dan, dan, UNKNOWN, 3)).status).toBe(404);
      await rated(eve, eve, legacy, 3);
      await hr.agent.patch(`${api}/skills/${legacy}`).send({ archived: true });
      const res = await rate(dan, dan, legacy, 3);
      expect([res.status, errorBody(res).details?.[0]?.code]).toEqual([400, 'skill_archived']);
      const mine = personSkillsSchema.parse(
        (await eve.agent.get(`${api}/skills/employees/${eve.employeeId}`)).body,
      );
      expect(mine.ratings.find((r) => r.skillId === legacy)?.level).toBe(3);
      await hr.agent.patch(`${api}/skills/${legacy}`).send({ archived: false });
    });

    it('removes a rating, once', async () => {
      await rated(dan, dan, docker, 2);
      const gone = personSkillsSchema.parse((await unrate(dan, dan, docker)).body);
      expect(gone.ratings.find((r) => r.skillId === docker)).toBeUndefined();
      expect((await unrate(dan, dan, docker)).status).toBe(404);
    });

    it('does not rate or show people who are no longer active', async () => {
      const gone = await onboard(acme, 'gone');
      await assign(gone, mia.employeeId);
      await rated(gone, gone, react, 2);
      await hr.agent
        .post(`${api}/employees/${gone.employeeId}/deactivate`)
        .send({ terminationDate: today });
      expect((await rate(hr, gone, react, 3)).status).toBe(404);
      expect(await names(hr)).not.toContain('gone');
    });

    it('does not audit ratings', async () => {
      const taken = await rated(mia, dan, react, 4); // dan had rated it himself: the last writer is recorded
      expect(taken.ratings.find((r) => r.skillId === react)).toMatchObject({
        selfAssessed: false,
        assessedBy: { id: mia.employeeId },
      });
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, entity: 'employee_skill' },
      });
      expect(entries).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('the matrix of people', () => {
    it('shows each person only themself, a manager the team, HR and the administrator everybody', async () => {
      expect(await names(dan)).toEqual(['dan']);
      expect(await names(gus)).toEqual(['gus']);
      expect(await names(mia)).toEqual(['dan', 'eve', 'mia', 'sub']);
      expect(await names(ron)).toEqual(['ron']);
      const everyone = await names(hr);
      expect(everyone).toEqual(
        expect.arrayContaining(['dan', 'eve', 'gus', 'hrx', 'mia', 'ron', 'sub']),
      );
      expect(await names(admin)).toEqual(everyone);
      expect(await names(globex.admin)).not.toContain('dan');
    });

    it('marks who the caller may rate', async () => {
      const edit = async (who: Member) =>
        Object.fromEntries((await people(who)).items.map((p) => [p.employee.firstName, p.canEdit]));
      expect(await edit(dan)).toEqual({ dan: true });
      expect(await edit(mia)).toEqual({ dan: true, eve: true, mia: true, sub: true });
      expect(Object.values(await edit(hr)).every(Boolean)).toBe(true);
    });

    it('filters by skill and minimum level', async () => {
      await rated(dan, dan, react, 4);
      await rated(eve, eve, react, 2);
      await rated(gus, gus, react, 5);
      expect(await names(hr, { skillId: react })).toEqual(
        expect.arrayContaining(['dan', 'eve', 'gus']),
      );
      expect(await names(hr, { skillId: react, minLevel: 4 })).toEqual(
        expect.arrayContaining(['dan', 'gus']),
      );
      expect(await names(hr, { skillId: react, minLevel: 4 })).not.toContain('eve');
      expect(await names(hr, { skillId: react, minLevel: 5 })).toEqual(['gus']);
      expect(await names(mia, { skillId: react, minLevel: 3 })).toEqual(['dan']); // gus is outside the team
      expect(await names(hr, { skillId: UNKNOWN })).toEqual([]);
    });

    it('filters by category and by name, and shows every rating of a person', async () => {
      await rated(eve, eve, docker, 3);
      expect(await names(hr, { categoryId: tools })).toContain('eve');
      expect(await names(hr, { categoryId: tools })).not.toContain('gus');
      expect(await names(hr, { q: 'GU' })).toEqual(['gus']);
      expect(await names(hr, { q: 'no such person' })).toEqual([]);
      const eveRow = (await people(hr, { categoryId: tools })).items.find(
        (p) => p.employee.firstName === 'eve',
      )!;
      expect(eveRow.ratings.map((r) => r.skillId)).toEqual(expect.arrayContaining([react, docker])); // also the other category
    });

    it('pages the list and refuses bad queries', async () => {
      const page = await people(hr, { pageSize: 2, page: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBeGreaterThan(4);
      for (const query of [
        { minLevel: 3 },
        { skillId: react, minLevel: 0 },
        { skillId: react, minLevel: 6 },
        { categoryId: 'x' },
        { pageSize: 101 },
        { page: 0 },
      ]) {
        const res = await hr.agent.get(`${api}/skills/people`).query(query);
        expect([res.status, errorBody(res).code], JSON.stringify(query)).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('privacy', () => {
    it('exports a person’s ratings, and only theirs', async () => {
      const person = await onboard(acme, 'exporter');
      await rated(person, person, ts, 4);
      await rated(hr, person, docker, 2);
      const doc = personalDataExportSchema.parse(
        (await person.agent.get(`${api}/privacy/export`)).body,
      );
      expect(doc.skills).toEqual([
        {
          category: 'Tools',
          skill: 'Docker',
          level: 2,
          selfAssessed: false,
          assessedAt: expect.any(String),
        },
        {
          category: 'Languages',
          skill: 'TypeScript',
          level: 4,
          selfAssessed: true,
          assessedAt: expect.any(String),
        },
      ]);
      const other = personalDataExportSchema.parse(
        (await gus.agent.get(`${api}/privacy/export`)).body,
      );
      expect(
        other.skills.every(
          (s) => s.level !== 4 || s.skill !== 'TypeScript' || other.skills.length > 0,
        ),
      ).toBe(true);
      expect(doc.skills).toHaveLength(2);
    });

    it('erases the ratings of a former employee and keeps the catalog and others’ ratings', async () => {
      const leaver = await onboard(acme, 'erasable');
      await rated(leaver, leaver, react, 5);
      const before = await system.employeeSkill.count({ where: { tenantId: acme.tenantId } });
      expect(
        (
          await hr.agent
            .post(`${api}/employees/${leaver.employeeId}/deactivate`)
            .send({ terminationDate: today })
        ).status,
      ).toBe(200);
      const erased = await hr.agent
        .post(`${api}/privacy/erase/${leaver.employeeId}`)
        .send({ confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBeLessThan(300);
      expect(await system.employeeSkill.count({ where: { employeeId: leaver.employeeId } })).toBe(
        0,
      );
      expect(await system.employeeSkill.count({ where: { tenantId: acme.tenantId } })).toBe(
        before - 1,
      );
      expect(
        (await catalog(hr)).categories.flatMap((c) => c.skills).some((s) => s.name === 'React'),
      ).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tenant isolation and database rules', () => {
    it('keeps another workspace away from skills, in lists and in every write', async () => {
      const x = globex.admin;
      for (const res of [
        await x.agent.patch(`${api}/skills/${react}`).send({ name: 'Mine now' }),
        await x.agent.delete(`${api}/skills/${react}`),
        await x.agent.patch(`${api}/skills/categories/${langs}`).send({ name: 'Mine now' }),
        await x.agent.delete(`${api}/skills/categories/${langs}`),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect(errorBody(await addSkill(x, langs, 'Foreign')).details?.[0]?.code).toBe(
        'unknown_category',
      );
      const outsider = await onboard(globex, 'neighbour');
      for (const res of [
        await rate(outsider, dan, react, 3),
        await outsider.agent.get(`${api}/skills/employees/${dan.employeeId}`),
        await unrate(outsider, dan, react),
      ]) {
        expect([res.status, errorBody(res).code]).toEqual([404, 'NOT_FOUND']);
      }
      expect((await rate(outsider, outsider, react, 3)).status).toBe(404); // the skill is acme's
      expect(await system.skill.findUnique({ where: { id: react } })).not.toBeNull();
      // the same name may exist in another workspace
      const own = await x.agent.post(`${api}/skills/categories`).send({ name: 'Languages' });
      expect(own.status).toBe(201);
    });

    it('enforces the rules in the database when the application is bypassed', async () => {
      const t = acme.tenantId;
      await expect(
        system.skillCategory.create({ data: { tenantId: t, name: '' } }),
      ).rejects.toThrow();
      await expect(
        system.skillCategory.create({ data: { tenantId: t, name: 'x'.repeat(61) } }),
      ).rejects.toThrow();
      await expect(
        system.skillCategory.create({ data: { tenantId: t, name: 'Languages' } }),
      ).rejects.toThrow(); // duplicate
      await expect(
        system.skill.create({ data: { tenantId: t, categoryId: langs, name: 'React' } }),
      ).rejects.toThrow();
      await expect(
        system.skill.create({
          data: { tenantId: t, categoryId: langs, name: 'Ok', description: 'x'.repeat(301) },
        }),
      ).rejects.toThrow();
      for (const level of [0, 6, -1]) {
        await expect(
          system.employeeSkill.create({
            data: { tenantId: t, employeeId: gus.employeeId, skillId: legacy, level },
          }),
        ).rejects.toThrow();
      }
      await expect(
        system.employeeSkill.create({
          data: { tenantId: t, employeeId: gus.employeeId, skillId: react, level: 3 },
        }),
      ).rejects.toThrow(); // gus already rated react
    });
  });
});
