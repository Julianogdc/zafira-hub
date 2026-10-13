import type { OnboardingStepInput } from '@zafira/contracts';

/* ==========================================================================
   F7-1a — Regras do modelo de onboarding (DEC-F7-004/005). Funções puras.
   ========================================================================== */

/**
 * Chave do Calendar (F7-3c, DEC-F7-014): ligada. Etapa CALENDAR_EVENT e condição CALENDAR_EVENT_LINKED
 * passam a valer (usam só eventos e vínculos LOCAIS já sincronizados; nenhuma escrita no Google).
 * Se for desligada, ambos voltam a ser rejeitados ao salvar e ao publicar.
 */
export const ONBOARDING_CALENDAR_AVAILABLE = true;

/** AUTOMATION é reservado (F7-4) e indisponível. */
export const ONBOARDING_AUTOMATION_AVAILABLE = true;

export type OnboardingProblemCode =
  | 'STEP_REQUIRED'
  | 'TITLE_REQUIRED'
  | 'DUPLICATE_STEP_KEY'
  | 'UNKNOWN_DEPENDENCY'
  | 'SELF_DEPENDENCY'
  | 'DUPLICATE_DEPENDENCY'
  | 'DEPENDENCY_CYCLE'
  | 'CALENDAR_UNAVAILABLE'
  | 'AUTOMATION_KEY_REQUIRED'
  | 'AUTOMATION_FLOW_INVALID'
  | 'AUTOMATION_UNAVAILABLE'
  | 'CONDITION_MISMATCH'
  | 'EVIDENCE_MISMATCH'
  | 'ASSIGNEE_FUNCTION_REQUIRED'
  | 'ASSIGNEE_FUNCTION_INVALID'
  | 'ASSIGNEE_MEMBER_REQUIRED'
  | 'ASSIGNEE_MEMBER_INVALID'
  | 'ASSIGNEE_EXTRA_FIELD';

export interface OnboardingProblem {
  code: OnboardingProblemCode;
  stepKey?: string;
  message: string;
}

export interface OnboardingValidationContext {
  activeFunctionIds: ReadonlySet<string>;
  activeMemberIds: ReadonlySet<string>;
  /** Fluxos de automacao habilitados da organizacao (F7-4a). Ausente = nao confere a existencia. */
  enabledAutomationKeys?: ReadonlySet<string>;
}

const label = (step: Pick<OnboardingStepInput, 'stepKey' | 'title'>, index: number) =>
  step.title?.trim() ? `Etapa ${index + 1} ("${step.title.trim()}")` : `Etapa ${index + 1}`;

/**
 * Integridade mínima para SALVAR um rascunho: chaves únicas, dependências existentes e sem
 * auto-dependência, recursos indisponíveis (Calendar/automação) rejeitados.
 * Permite rascunho incompleto (título vazio, ciclo) para o administrador trabalhar.
 */
export function validateDraftIntegrity(steps: readonly OnboardingStepInput[]): OnboardingProblem[] {
  const problems: OnboardingProblem[] = [];
  const keys = new Set<string>();
  steps.forEach((step, index) => {
    if (keys.has(step.stepKey)) {
      problems.push({ code: 'DUPLICATE_STEP_KEY', stepKey: step.stepKey, message: `${label(step, index)}: identificador repetido.` });
    }
    keys.add(step.stepKey);
  });
  steps.forEach((step, index) => {
    const seen = new Set<string>();
    for (const dep of step.dependsOn) {
      if (dep === step.stepKey) {
        problems.push({ code: 'SELF_DEPENDENCY', stepKey: step.stepKey, message: `${label(step, index)} não pode depender de si mesma.` });
      } else if (!keys.has(dep)) {
        problems.push({ code: 'UNKNOWN_DEPENDENCY', stepKey: step.stepKey, message: `${label(step, index)} depende de uma etapa que não existe neste modelo.` });
      }
      if (seen.has(dep)) {
        problems.push({ code: 'DUPLICATE_DEPENDENCY', stepKey: step.stepKey, message: `${label(step, index)} repete a mesma dependência.` });
      }
      seen.add(dep);
    }
    if (!ONBOARDING_CALENDAR_AVAILABLE && (step.kind === 'CALENDAR_EVENT' || step.completionCondition === 'CALENDAR_EVENT_LINKED')) {
      problems.push({
        code: 'CALENDAR_UNAVAILABLE',
        stepKey: step.stepKey,
        message: `${label(step, index)}: etapas e condições ligadas ao Google Calendar não estão disponíveis.`,
      });
    }
    if (!ONBOARDING_AUTOMATION_AVAILABLE && step.kind === 'AUTOMATION') {
      problems.push({
        code: 'AUTOMATION_UNAVAILABLE',
        stepKey: step.stepKey,
        message: `${label(step, index)}: automações ainda não estão disponíveis (entrega da F7-4).`,
      });
    }
  });
  return problems;
}

/** Ciclo de dependências: devolve a sequência de chaves do ciclo, ou null. */
export function findDependencyCycle(steps: readonly Pick<OnboardingStepInput, 'stepKey' | 'dependsOn'>[]): string[] | null {
  const graph = new Map(steps.map((s) => [s.stepKey, s.dependsOn.filter((d) => d !== s.stepKey)]));
  const state = new Map<string, 0 | 1 | 2>(); // 0 não visitado, 1 em visita, 2 concluído
  const stack: string[] = [];

  const visit = (key: string): string[] | null => {
    state.set(key, 1);
    stack.push(key);
    for (const next of graph.get(key) ?? []) {
      if (!graph.has(next)) continue;
      const s = state.get(next) ?? 0;
      if (s === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (s === 0) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(key, 2);
    return null;
  };

  for (const step of steps) {
    if ((state.get(step.stepKey) ?? 0) === 0) {
      const cycle = visit(step.stepKey);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Ordem de execução: topológica, estável pela posição (desempate = ordem do array). */
export function orderSteps(steps: readonly Pick<OnboardingStepInput, 'stepKey' | 'dependsOn'>[]): string[] {
  const position = new Map(steps.map((s, i) => [s.stepKey, i]));
  const pending = new Map(steps.map((s) => [s.stepKey, new Set(s.dependsOn.filter((d) => position.has(d) && d !== s.stepKey))]));
  const result: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, deps]) => deps.size === 0)
      .map(([key]) => key)
      .sort((a, b) => (position.get(a) as number) - (position.get(b) as number));
    if (ready.length === 0) return result; // ciclo: o restante não tem ordem
    const next = ready[0];
    result.push(next);
    pending.delete(next);
    for (const deps of pending.values()) deps.delete(next);
  }
  return result;
}

/** Coerência etapa × condição × evidência × responsável. */
function validateStepShape(step: OnboardingStepInput, index: number, ctx: OnboardingValidationContext): OnboardingProblem[] {
  const problems: OnboardingProblem[] = [];
  const at = label(step, index);

  if (!step.title.trim()) {
    problems.push({ code: 'TITLE_REQUIRED', stepKey: step.stepKey, message: `${at}: título obrigatório.` });
  }

  if (step.kind === 'CONFIRM_ASANA_PROJECT' && step.completionCondition !== 'ASANA_PROJECT_LINKED') {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: a confirmação de projeto Asana exige a condição "projeto vinculado" (somente vínculo local).` });
  }
  if (
    step.kind === 'MANUAL' &&
    step.completionCondition !== 'CONFIRMATION' &&
    step.completionCondition !== 'EVIDENCE_PROVIDED' &&
    step.completionCondition !== 'ASANA_PROJECT_LINKED' && // já tratada pela regra abaixo
    step.completionCondition !== 'CALENDAR_EVENT_LINKED' && // idem
    step.completionCondition !== 'AUTOMATION_SUCCEEDED' // idem
  ) {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: etapa manual aceita as condições "confirmação" ou "evidência fornecida".` });
  }
  if (step.completionCondition === 'ASANA_PROJECT_LINKED' && step.kind !== 'CONFIRM_ASANA_PROJECT') {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: a condição "projeto vinculado" só vale para a etapa de confirmar projeto Asana.` });
  }
  if (step.kind === 'AUTOMATION' && step.completionCondition !== 'AUTOMATION_SUCCEEDED') {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: a etapa de automação exige a condição "automação concluída com sucesso".` });
  }
  if (step.completionCondition === 'AUTOMATION_SUCCEEDED' && step.kind !== 'AUTOMATION') {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: a condição "automação concluída com sucesso" só vale para a etapa de automação.` });
  }
  if (step.kind === 'AUTOMATION') {
    if (!step.automationKey) {
      problems.push({ code: 'AUTOMATION_KEY_REQUIRED', stepKey: step.stepKey, message: `${at}: escolha o fluxo de automação.` });
    } else if (ctx.enabledAutomationKeys && !ctx.enabledAutomationKeys.has(step.automationKey)) {
      problems.push({ code: 'AUTOMATION_FLOW_INVALID', stepKey: step.stepKey, message: `${at}: o fluxo escolhido não existe ou está desabilitado.` });
    }
  } else if (step.automationKey) {
    problems.push({ code: 'AUTOMATION_FLOW_INVALID', stepKey: step.stepKey, message: `${at}: fluxo de automação informado em etapa que não é de automação.` });
  }
  if (step.kind === 'CALENDAR_EVENT' && step.completionCondition !== 'CALENDAR_EVENT_LINKED') {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: a etapa de reunião no Calendar exige a condição "evento vinculado" (somente vínculo local).` });
  }
  if (step.completionCondition === 'CALENDAR_EVENT_LINKED' && step.kind !== 'CALENDAR_EVENT') {
    problems.push({ code: 'CONDITION_MISMATCH', stepKey: step.stepKey, message: `${at}: a condição "evento vinculado" só vale para a etapa de reunião no Calendar.` });
  }
  if (step.completionCondition === 'EVIDENCE_PROVIDED') {
    if (step.evidenceKind === 'NONE' || !step.evidenceRequired) {
      problems.push({ code: 'EVIDENCE_MISMATCH', stepKey: step.stepKey, message: `${at}: a condição "evidência fornecida" exige evidência (link ou nota) marcada como obrigatória.` });
    }
  } else if (step.evidenceRequired) {
    problems.push({ code: 'EVIDENCE_MISMATCH', stepKey: step.stepKey, message: `${at}: evidência obrigatória só com a condição "evidência fornecida".` });
  }
  if (step.evidenceRequired && step.evidenceKind === 'NONE') {
    problems.push({ code: 'EVIDENCE_MISMATCH', stepKey: step.stepKey, message: `${at}: evidência obrigatória sem tipo de evidência.` });
  }

  if (step.assigneeMode === 'FUNCTION') {
    if (!step.functionId) {
      problems.push({ code: 'ASSIGNEE_FUNCTION_REQUIRED', stepKey: step.stepKey, message: `${at}: escolha a função responsável.` });
    } else if (!ctx.activeFunctionIds.has(step.functionId)) {
      problems.push({ code: 'ASSIGNEE_FUNCTION_INVALID', stepKey: step.stepKey, message: `${at}: a função escolhida não existe ou está inativa.` });
    }
    if (step.memberId) {
      problems.push({ code: 'ASSIGNEE_EXTRA_FIELD', stepKey: step.stepKey, message: `${at}: pessoa informada com responsável por função.` });
    }
  } else if (step.assigneeMode === 'MEMBER') {
    if (!step.memberId) {
      problems.push({ code: 'ASSIGNEE_MEMBER_REQUIRED', stepKey: step.stepKey, message: `${at}: escolha a pessoa responsável.` });
    } else if (!ctx.activeMemberIds.has(step.memberId)) {
      problems.push({ code: 'ASSIGNEE_MEMBER_INVALID', stepKey: step.stepKey, message: `${at}: a pessoa escolhida não é membro ativo da organização.` });
    }
    if (step.functionId) {
      problems.push({ code: 'ASSIGNEE_EXTRA_FIELD', stepKey: step.stepKey, message: `${at}: função informada com responsável específico.` });
    }
  } else if (step.functionId || step.memberId) {
    problems.push({ code: 'ASSIGNEE_EXTRA_FIELD', stepKey: step.stepKey, message: `${at}: há responsável informado, mas o modo é "sem responsável".` });
  }
  return problems;
}

/** Tudo o que precisa estar certo para PUBLICAR. Lista todos os problemas de uma vez. */
export function validatePublishable(steps: readonly OnboardingStepInput[], ctx: OnboardingValidationContext): OnboardingProblem[] {
  const problems: OnboardingProblem[] = [];
  if (steps.length === 0) {
    problems.push({ code: 'STEP_REQUIRED', message: 'O modelo precisa de pelo menos uma etapa.' });
  }
  problems.push(...validateDraftIntegrity(steps));
  steps.forEach((step, index) => problems.push(...validateStepShape(step, index, ctx)));
  const cycle = findDependencyCycle(steps);
  if (cycle) {
    const titles = cycle.map((k) => {
      const at = steps.findIndex((s) => s.stepKey === k);
      return at >= 0 ? steps[at].title?.trim() || `Etapa ${at + 1}` : 'etapa removida';
    });
    problems.push({ code: 'DEPENDENCY_CYCLE', stepKey: cycle[0], message: `Dependência circular entre etapas: ${titles.join(' → ')}.` });
  }
  return problems;
}

/**
 * Cópia das etapas para um novo rascunho: preserva stepKey (mesma etapa = mesma chave)
 * e dependências; nada é compartilhado por referência com a versão publicada.
 */
export function cloneStepsForNewVersion<T extends OnboardingStepInput>(steps: readonly T[]): T[] {
  return steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] }));
}

/* ----------------------------------------------------------------------------
   Dias úteis (segunda a sexta). Aritmética de data pura (YYYY-MM-DD), sem fuso.
   ---------------------------------------------------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(iso: string): Date {
  if (!ISO_DATE.test(iso)) throw new Error(`Data inválida: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Data inválida: ${iso}`);
  }
  return date;
}

const fmt = (date: Date) => date.toISOString().slice(0, 10);

export function isBusinessDay(iso: string, holidays: ReadonlySet<string> = new Set()): boolean {
  const weekday = toUtc(iso).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(iso);
}

/**
 * Soma `days` dias úteis a uma data. 0 dia útil devolve a própria data se for útil, ou o próximo
 * dia útil. Feriados são opcionais (lista da organização, fora da F7-1).
 */
export function addBusinessDays(startIso: string, days: number, holidays: ReadonlySet<string> = new Set()): string {
  if (!Number.isInteger(days) || days < 0) throw new Error('Quantidade de dias úteis deve ser inteiro >= 0');
  const date = toUtc(startIso);
  while (!isBusinessDay(fmt(date), holidays)) date.setUTCDate(date.getUTCDate() + 1);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isBusinessDay(fmt(date), holidays)) remaining--;
  }
  return fmt(date);
}
