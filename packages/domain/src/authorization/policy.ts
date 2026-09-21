export interface EvaluationContext {
  override?: boolean;
  roleGrant: boolean;
}

export interface EvaluationResult {
  allowed: boolean;
  reason: string;
}

export function evaluatePermission({ override, roleGrant }: EvaluationContext): EvaluationResult {
  if (override === false) {
    return { allowed: false, reason: 'DENIED_BY_OVERRIDE' };
  }

  if (override === true) {
    return { allowed: true, reason: 'GRANTED_BY_OVERRIDE' };
  }

  if (roleGrant === true) {
    return { allowed: true, reason: 'GRANTED_BY_ROLE_PERMISSION' };
  }

  return { allowed: false, reason: 'DENIED_BY_DEFAULT' };
}
