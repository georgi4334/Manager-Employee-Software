import { z } from 'zod';

export const MAX_TEAM_MEMBERS = 200;

const name = z.string().trim().min(1, { error: 'required' }).max(100, { error: 'tooLong' });
const optionalId = z.uuid().nullable();

export const createDepartmentRequestSchema = z
  .object({ name, parentId: optionalId.optional(), headEmployeeId: optionalId.optional() })
  .strict();
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z
  .object({ name, parentId: optionalId, headEmployeeId: optionalId })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequestSchema>;

export const createTeamRequestSchema = z
  .object({ name, departmentId: z.uuid(), leadEmployeeId: optionalId.optional() })
  .strict();
export type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;

export const updateTeamRequestSchema = z
  .object({ name, departmentId: z.uuid(), leadEmployeeId: optionalId })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: 'required' });
export type UpdateTeamRequest = z.infer<typeof updateTeamRequestSchema>;

export const setTeamMembersRequestSchema = z
  .object({
    employeeIds: z
      .array(z.uuid())
      .max(MAX_TEAM_MEMBERS)
      .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate' }),
  })
  .strict();
export type SetTeamMembersRequest = z.infer<typeof setTeamMembersRequestSchema>;

/** Both values are always sent: null means "nobody" / "no department". */
export const assignmentRequestSchema = z
  .object({ managerId: optionalId, departmentId: optionalId })
  .strict();
export type AssignmentRequest = z.infer<typeof assignmentRequestSchema>;

const personRef = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  head: personRef.nullable(),
  employeeCount: z.number().int().min(0),
  teamCount: z.number().int().min(0),
});
export type Department = z.infer<typeof departmentSchema>;

export const teamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  department: z.object({ id: z.uuid(), name: z.string() }),
  lead: personRef.nullable(),
  members: z.array(personRef),
});
export type Team = z.infer<typeof teamSchema>;

export const chartNodeSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  jobTitle: z.string().nullable(),
  managerId: z.uuid().nullable(),
  departmentId: z.uuid().nullable(),
});
export type ChartNode = z.infer<typeof chartNodeSchema>;

export const orgChartSchema = z.object({ nodes: z.array(chartNodeSchema) });
export type OrgChart = z.infer<typeof orgChartSchema>;

/** Roots first (people without manager), then each manager's reports, all sorted by name. */
export function buildChartTree(
  nodes: readonly ChartNode[],
): { node: ChartNode; reports: ReturnType<typeof buildChartTree> }[] {
  const byManager = new Map<string | null, ChartNode[]>();
  const known = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    // A manager who is not in the list (inactive or hidden) makes the person a root, never a lost node.
    const key = node.managerId && known.has(node.managerId) ? node.managerId : null;
    byManager.set(key, [...(byManager.get(key) ?? []), node]);
  }
  const sort = (list: ChartNode[]) =>
    [...list].sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName, 'en') || a.firstName.localeCompare(b.firstName, 'en'),
    );
  const seen = new Set<string>();
  const build = (managerId: string | null): ReturnType<typeof buildChartTree> =>
    sort(byManager.get(managerId) ?? []).flatMap((node) => {
      if (seen.has(node.id)) return []; // defensive: a cycle can never loop the renderer
      seen.add(node.id);
      return [{ node, reports: build(node.id) }];
    });
  return build(null);
}
