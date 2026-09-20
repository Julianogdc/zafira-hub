import { PermissionCode } from './permissions.js';
import { roleHasDefaultPermission, RoleType } from './role-defaults.js';

export interface EvaluationContext {
  role: RoleType;
  permission: PermissionCode;
  override?: boolean;
}

export interface EvaluationResult {
  allowed: boolean;
  reason: string;
}

export function evaluatePermission({ role, permission, override }: EvaluationContext): EvaluationResult {
  if (override === false) {
    return { allowed: false, reason: 'DENIED_BY_OVERRIDE' };
  }

  if (override === true) {
    return { allowed: true, reason: 'GRANTED_BY_OVERRIDE' };
  }

  const hasDefault = roleHasDefaultPermission(role, permission);
  if (hasDefault) {
    return { allowed: true, reason: 'GRANTED_BY_ROLE_DEFAULT' };
  }

  return { allowed: false, reason: 'DENIED_BY_DEFAULT' };
}
