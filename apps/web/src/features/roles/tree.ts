import {
  buildRoleTree,
  descendantIds,
  type RoleListItem,
  type RoleTreeNode,
} from '@intime/contracts';

export type RoleNode = RoleTreeNode<RoleListItem>;

export interface ParentOption {
  id: string;
  name: string;
  depth: number;
  /** The names from the root down to this role, e.g. "Admin › HR › Manager". */
  path: string;
}

/**
 * The roles a role may sit under, in tree order with their depth: everything except the role itself and its sub-roles
 * (those would make a cycle; the server refuses them too).
 */
export function parentOptions(roles: readonly RoleListItem[], selfId?: string): ParentOption[] {
  const blocked = selfId ? descendantIds(roles, selfId).add(selfId) : new Set<string>();
  const out: ParentOption[] = [];
  const walk = (nodes: RoleNode[], ancestors: string[]) => {
    for (const node of nodes) {
      if (blocked.has(node.role.id)) continue;
      const names = [...ancestors, node.role.name];
      out.push({
        id: node.role.id,
        name: node.role.name,
        depth: ancestors.length,
        path: names.join(' › '),
      });
      walk(node.children, names);
    }
  };
  walk(buildRoleTree(roles), []);
  return out;
}
