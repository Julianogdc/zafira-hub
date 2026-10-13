import type {
  OnboardingCompletionCondition,
  OnboardingEvidenceKind,
  OnboardingStepInput,
  OnboardingStepKind,
} from '@zafira/contracts';

/**
 * F7-1b — Regras puras do editor do construtor (sem React, sem rede).
 * O backend é a autoridade; aqui só se evita montar combinações que ele recusaria.
 */

/** Calendar disponível (F7-3c, DEC-F7-014): usa só eventos e vínculos locais. */
export const CALENDAR_STEP_AVAILABLE = true;
/** Automação disponível (F7-4, DEC-F7-016/017): conclui só pelo resultado autenticado do n8n. */
export const AUTOMATION_STEP_AVAILABLE = true;

export const STEP_KIND_OPTIONS: { value: OnboardingStepKind; label: string; hint: string; available: boolean }[] = [
  { value: 'MANUAL', label: 'Tarefa manual', hint: 'Alguém executa e confirma.', available: true },
  {
    value: 'CONFIRM_ASANA_PROJECT',
    label: 'Confirmar projeto do Asana',
    hint: 'Vincula um projeto existente; o Hub não cria nem altera nada no Asana.',
    available: true,
  },
  {
    value: 'CALENDAR_EVENT',
    label: 'Reunião no Calendar',
    hint: 'Conclui com um evento do Google Calendar já vinculado ao cliente (somente leitura; o Hub não cria nem altera eventos).',
    available: CALENDAR_STEP_AVAILABLE,
  },
  {
    value: 'AUTOMATION',
    label: 'Automação (n8n)',
    hint: 'Um fluxo do n8n executa e devolve o resultado. A etapa não conclui manualmente; o Hub não escreve no Asana por esse fluxo.',
    available: AUTOMATION_STEP_AVAILABLE,
  },
];

export function newStepKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `s_${random}`;
}

export function newStep(partial: Partial<OnboardingStepInput> = {}): OnboardingStepInput {
  return {
    stepKey: newStepKey(),
    title: '',
    description: null,
    kind: 'MANUAL',
    assigneeMode: 'NONE',
    functionId: null,
    memberId: null,
    dueBusinessDays: null,
    dueAnchor: 'RELEASED',
    evidenceKind: 'NONE',
    evidenceRequired: false,
    completionCondition: 'CONFIRMATION',
    blocksCompletion: false,
    dependsOn: [],
    automationKey: null,
    ...partial,
  };
}

/** Move uma etapa para cima (-1) ou para baixo (+1). A precedência real vem das dependências. */
export function moveStep(steps: readonly OnboardingStepInput[], stepKey: string, direction: -1 | 1): OnboardingStepInput[] {
  const index = steps.findIndex((s) => s.stepKey === stepKey);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= steps.length) return [...steps];
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Remove a etapa e limpa as dependências que apontavam para ela. */
export function removeStep(steps: readonly OnboardingStepInput[], stepKey: string): OnboardingStepInput[] {
  return steps
    .filter((s) => s.stepKey !== stepKey)
    .map((s) => (s.dependsOn.includes(stepKey) ? { ...s, dependsOn: s.dependsOn.filter((k) => k !== stepKey) } : s));
}

/** Evidência e condição andam juntas: a interface deriva a condição para nunca gerar combinação inválida. */
export function applyEvidence(
  step: OnboardingStepInput,
  evidenceKind: OnboardingEvidenceKind,
  required: boolean
): OnboardingStepInput {
  if (step.kind === 'CONFIRM_ASANA_PROJECT') {
    return { ...step, evidenceKind, evidenceRequired: false, completionCondition: 'ASANA_PROJECT_LINKED' };
  }
  if (step.kind === 'CALENDAR_EVENT') {
    return { ...step, evidenceKind, evidenceRequired: false, completionCondition: 'CALENDAR_EVENT_LINKED' };
  }
  if (step.kind === 'AUTOMATION') {
    return { ...step, evidenceKind: 'NONE', evidenceRequired: false, completionCondition: 'AUTOMATION_SUCCEEDED' };
  }
  const mustProvide = evidenceKind !== 'NONE' && required;
  const completionCondition: OnboardingCompletionCondition = mustProvide ? 'EVIDENCE_PROVIDED' : 'CONFIRMATION';
  return { ...step, evidenceKind, evidenceRequired: mustProvide, completionCondition };
}

/** Troca o tipo da etapa mantendo evidência/condição coerentes. */
export function applyKind(step: OnboardingStepInput, kind: OnboardingStepKind): OnboardingStepInput {
  const next = { ...step, kind, automationKey: kind === 'AUTOMATION' ? step.automationKey ?? null : null };
  if (kind === 'CONFIRM_ASANA_PROJECT') {
    return { ...next, evidenceRequired: false, completionCondition: 'ASANA_PROJECT_LINKED' };
  }
  if (kind === 'CALENDAR_EVENT') {
    return { ...next, evidenceRequired: false, completionCondition: 'CALENDAR_EVENT_LINKED' };
  }
  if (kind === 'AUTOMATION') {
    return { ...next, evidenceKind: 'NONE', evidenceRequired: false, completionCondition: 'AUTOMATION_SUCCEEDED' };
  }
  return applyEvidence(next, next.evidenceKind, next.evidenceRequired);
}

/** Troca o modo de responsável limpando o campo que deixa de valer. */
export function applyAssignee(
  step: OnboardingStepInput,
  mode: OnboardingStepInput['assigneeMode']
): OnboardingStepInput {
  return {
    ...step,
    assigneeMode: mode,
    functionId: mode === 'FUNCTION' ? step.functionId ?? null : null,
    memberId: mode === 'MEMBER' ? step.memberId ?? null : null,
  };
}

/** Agrupa problemas por etapa; problemas sem etapa ficam sob a chave "". */
export function groupProblemsByStep<T extends { stepKey?: string }>(problems: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const p of problems) {
    const key = p.stepKey ?? '';
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return map;
}

/** Compara conteúdo (para saber se há alterações não salvas). */
export function stepsEqual(a: readonly OnboardingStepInput[], b: readonly OnboardingStepInput[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const ASSIGNEE_REMOVED_LABEL = 'Pessoa removida ou inativa';
export const FUNCTION_REMOVED_LABEL = 'Função removida';
