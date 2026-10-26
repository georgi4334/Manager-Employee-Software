import { z } from 'zod';

export const SKILL_LEVELS = [1, 2, 3, 4, 5] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export const MAX_SKILL_NAME = 60;
export const MAX_SKILL_DESCRIPTION = 300;

/** Whether a rating is a self-assessment: the person set it themself. */
export const isSelfAssessed = (rating: {
  assessedByEmployeeId: string | null;
  employeeId: string;
}): boolean => rating.assessedByEmployeeId === rating.employeeId;

// ----- requests --------------------------------------------------------------------------------

const name = z
  .string()
  .trim()
  .min(1, { error: 'required' })
  .max(MAX_SKILL_NAME, { error: 'tooLong' });

export const createSkillCategoryRequestSchema = z.object({ name }).strict();
export type CreateSkillCategoryRequest = z.infer<typeof createSkillCategoryRequestSchema>;
export const updateSkillCategoryRequestSchema = z.object({ name }).strict();
export type UpdateSkillCategoryRequest = z.infer<typeof updateSkillCategoryRequestSchema>;

export const createSkillRequestSchema = z
  .object({
    categoryId: z.uuid(),
    name,
    description: z
      .string()
      .trim()
      .max(MAX_SKILL_DESCRIPTION, { error: 'tooLong' })
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
  })
  .strict();
export type CreateSkillRequest = z.infer<typeof createSkillRequestSchema>;

export const updateSkillRequestSchema = z
  .object({
    categoryId: z.uuid(),
    name,
    description: z
      .string()
      .trim()
      .max(MAX_SKILL_DESCRIPTION, { error: 'tooLong' })
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    archived: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: 'required' });
export type UpdateSkillRequest = z.infer<typeof updateSkillRequestSchema>;

export const setRatingRequestSchema = z.object({ level: z.number().int().min(1).max(5) }).strict();
export type SetRatingRequest = z.infer<typeof setRatingRequestSchema>;

export const skillPeopleQuerySchema = z
  .object({
    categoryId: z.uuid().optional(),
    skillId: z.uuid().optional(),
    /** Only people who know the skill at least this well; needs a skill. */
    minLevel: z.coerce.number().int().min(1).max(5).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((v) => v.minLevel === undefined || v.skillId !== undefined, {
    path: ['skillId'],
    error: 'required',
  });
export type SkillPeopleQuery = z.infer<typeof skillPeopleQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const skillSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  archived: z.boolean(),
  /** For catalog managers: nobody has rated it, so it can be deleted. */
  canDelete: z.boolean(),
});
export type Skill = z.infer<typeof skillSchema>;

export const skillCatalogSchema = z.object({
  categories: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      skills: z.array(skillSchema),
      canDelete: z.boolean(),
    }),
  ),
  canManage: z.boolean(),
});
export type SkillCatalog = z.infer<typeof skillCatalogSchema>;

export const skillRatingSchema = z.object({
  skillId: z.uuid(),
  level: z.number().int().min(1).max(5),
  assessedBy: person.nullable(),
  selfAssessed: z.boolean(),
  assessedAt: z.string(),
});
export type SkillRating = z.infer<typeof skillRatingSchema>;

export const personSkillsSchema = z.object({
  employee: person,
  ratings: z.array(skillRatingSchema),
  canEdit: z.boolean(),
});
export type PersonSkills = z.infer<typeof personSkillsSchema>;

export const skillPeopleSchema = z.object({
  items: z.array(personSkillsSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type SkillPeople = z.infer<typeof skillPeopleSchema>;
