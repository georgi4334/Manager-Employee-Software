import { createSkillCategoryRequestSchema, createSkillRequestSchema } from '@intime/contracts';
import { describe, expect, it } from 'vitest';
import { categoryFormSchema, emptySkill, skillFormSchema, toCreateSkill } from './forms';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const issues = (r: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => (r.success ? [] : (r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? []));

describe('category form', () => {
  it('accepts a name and has the limits of the API', () => {
    expect(categoryFormSchema.safeParse({ name: ' Languages ' }).success).toBe(true);
    expect(categoryFormSchema.safeParse({ name: 'x'.repeat(60) }).success).toBe(true);
    expect(createSkillCategoryRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(issues(categoryFormSchema.safeParse({ name: 'x'.repeat(61) }))).toEqual([
      'name:tooLong',
    ]);
    expect(issues(categoryFormSchema.safeParse({ name: '  ' }))).toEqual(['name:required']);
  });
});

describe('skill form', () => {
  const base = { ...emptySkill(ID), name: ' React ' };

  it('sends only what is filled in, as the API accepts it', () => {
    expect(skillFormSchema.safeParse(base).success).toBe(true);
    const body = toCreateSkill(base);
    expect(body).toEqual({ categoryId: ID, name: 'React' });
    expect(createSkillRequestSchema.safeParse(body).success).toBe(true);
    const full = toCreateSkill({ ...base, description: ' UI library ' });
    expect(full).toEqual({ categoryId: ID, name: 'React', description: 'UI library' });
    expect(createSkillRequestSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['no category', { categoryId: '' }, ['categoryId:required']],
    ['no name', { name: ' ' }, ['name:required']],
    ['a long name', { name: 'x'.repeat(61) }, ['name:tooLong']],
    ['a long description', { description: 'x'.repeat(301) }, ['description:tooLong']],
  ])('refuses %s, as the API does', (_label, change, expected) => {
    expect(issues(skillFormSchema.safeParse({ ...base, ...change }))).toEqual(expected);
  });

  it('accepts the limits', () => {
    expect(
      skillFormSchema.safeParse({ ...base, name: 'x'.repeat(60), description: 'x'.repeat(300) })
        .success,
    ).toBe(true);
    expect(
      createSkillRequestSchema.safeParse(
        toCreateSkill({ ...base, name: 'x'.repeat(60), description: 'x'.repeat(300) }),
      ).success,
    ).toBe(true);
  });
});
