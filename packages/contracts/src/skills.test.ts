import { describe, expect, it } from 'vitest';
import {
  SKILL_LEVELS,
  createSkillCategoryRequestSchema,
  createSkillRequestSchema,
  isSelfAssessed,
  setRatingRequestSchema,
  skillPeopleQuerySchema,
  updateSkillRequestSchema,
} from './skills.js';

const ID = '0192f5a0-0000-7000-8000-00000000000a';
const OTHER = '0192f5a0-0000-7000-8000-00000000000b';

describe('isSelfAssessed', () => {
  it.each([
    [{ assessedByEmployeeId: ID, employeeId: ID }, true],
    [{ assessedByEmployeeId: OTHER, employeeId: ID }, false],
    [{ assessedByEmployeeId: null, employeeId: ID }, false],
  ])('%j → %s', (rating, expected) => {
    expect(isSelfAssessed(rating)).toBe(expected);
  });
});

describe('levels', () => {
  it('are 1 to 5', () => {
    expect(SKILL_LEVELS).toEqual([1, 2, 3, 4, 5]);
  });
  it.each([1, 2, 3, 4, 5])('accepts level %s', (level) => {
    expect(setRatingRequestSchema.safeParse({ level }).success).toBe(true);
  });
  it.each([0, 6, -1, 2.5, '3', null])('refuses level %s', (level) => {
    expect(setRatingRequestSchema.safeParse({ level }).success).toBe(false);
  });
  it('refuses extra fields', () => {
    expect(setRatingRequestSchema.safeParse({ level: 3, employeeId: ID }).success).toBe(false);
  });
});

describe('catalog requests', () => {
  it('trims names and takes an optional description', () => {
    expect(createSkillCategoryRequestSchema.parse({ name: ' Languages ' })).toEqual({
      name: 'Languages',
    });
    expect(
      createSkillRequestSchema.parse({ categoryId: ID, name: ' React ', description: '  ' }),
    ).toEqual({
      categoryId: ID,
      name: 'React',
    });
    expect(
      createSkillRequestSchema.parse({ categoryId: ID, name: 'x', description: ' UI ' })
        .description,
    ).toBe('UI');
  });

  it.each([
    ['no name', { categoryId: ID, name: ' ' }],
    ['a long name', { categoryId: ID, name: 'x'.repeat(61) }],
    ['a long description', { categoryId: ID, name: 'x', description: 'x'.repeat(301) }],
    ['no category', { name: 'x' }],
    ['a bad category', { categoryId: 'x', name: 'x' }],
    ['unknown fields', { categoryId: ID, name: 'x', level: 3 }],
  ])('refuses a skill with %s', (_label, body) => {
    expect(createSkillRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts the length limits', () => {
    expect(
      createSkillRequestSchema.safeParse({
        categoryId: ID,
        name: 'x'.repeat(60),
        description: 'x'.repeat(300),
      }).success,
    ).toBe(true);
    expect(createSkillCategoryRequestSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(
      false,
    );
  });

  it('updates part of a skill, clears the description and archives', () => {
    expect(updateSkillRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSkillRequestSchema.parse({ description: ' ' })).toEqual({ description: null });
    expect(updateSkillRequestSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(updateSkillRequestSchema.safeParse({ archived: 'yes' }).success).toBe(false);
    expect(updateSkillRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('skillPeopleQuerySchema', () => {
  it('defaults to the first page', () => {
    expect(skillPeopleQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });
  it('needs a skill for a minimum level', () => {
    expect(skillPeopleQuerySchema.safeParse({ minLevel: 3 }).success).toBe(false);
    expect(skillPeopleQuerySchema.parse({ skillId: ID, minLevel: '3' })).toMatchObject({
      skillId: ID,
      minLevel: 3,
    });
  });
  it.each([
    { minLevel: 0, skillId: ID },
    { minLevel: 6, skillId: ID },
    { skillId: 'x' },
    { categoryId: 'x' },
    { pageSize: 101 },
    { page: 0 },
  ])('refuses %j', (query) => {
    expect(skillPeopleQuerySchema.safeParse(query).success).toBe(false);
  });
});
