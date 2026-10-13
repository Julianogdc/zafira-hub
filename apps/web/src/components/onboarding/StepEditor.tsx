import React from 'react';
import type { OnboardingEvidenceKind, OnboardingStepInput } from '@zafira/contracts';
import {
  ASSIGNEE_REMOVED_LABEL,
  FUNCTION_REMOVED_LABEL,
  STEP_KIND_OPTIONS,
  applyAssignee,
  applyEvidence,
  applyKind,
} from '@/lib/onboarding-builder';
import type { OnboardingMemberView, OnboardingProblemView, OrganizationFunctionView } from '@/services/onboarding';
import type { AutomationFlowView } from '@/services/automation';
import styles from '@/pages/Onboarding.module.css';

interface StepEditorProps {
  step: OnboardingStepInput;
  index: number;
  allSteps: readonly OnboardingStepInput[];
  functions: readonly OrganizationFunctionView[];
  members: readonly OnboardingMemberView[];
  problems: readonly OnboardingProblemView[];
  /** Fluxos da organizacao; null quando a pessoa nao pode consulta-los (F7-4b). */
  automationFlows?: readonly AutomationFlowView[] | null;
  disabled: boolean;
  onChange: (next: OnboardingStepInput) => void;
}

const EVIDENCE_LABEL: Record<OnboardingEvidenceKind, string> = {
  NONE: 'Sem evidência',
  LINK: 'Link',
  NOTE: 'Nota escrita',
};

/** Configuração da etapa selecionada (F7-1b). Combinações inválidas são evitadas pelas regras de onboarding-builder. */
export function StepEditor({ step, index, allSteps, functions, members, problems, automationFlows = null, disabled, onChange }: StepEditorProps) {
  const id = (name: string) => `step-${step.stepKey}-${name}`;
  const patch = (partial: Partial<OnboardingStepInput>) => onChange({ ...step, ...partial });
  const isAsana = step.kind === 'CONFIRM_ASANA_PROJECT';
  const isCalendar = step.kind === 'CALENDAR_EVENT';
  const isAutomation = step.kind === 'AUTOMATION';
  const enabledFlows = (automationFlows ?? []).filter((f) => f.enabled);
  const currentFlow = step.automationKey ? (automationFlows ?? []).find((f) => f.key === step.automationKey) : undefined;
  const flowGone = isAutomation && Boolean(step.automationKey) && automationFlows !== null && (!currentFlow || !currentFlow.enabled);

  const activeFunctions = functions.filter((f) => f.isActive);
  const currentFn = step.functionId ? functions.find((f) => f.id === step.functionId) : undefined;
  const fnMissing = Boolean(step.functionId) && !currentFn;
  const fnInactive = Boolean(currentFn) && !currentFn!.isActive;

  const currentMember = step.memberId ? members.find((m) => m.id === step.memberId) : undefined;
  const memberMissing = Boolean(step.memberId) && !currentMember;

  const others = allSteps.filter((s) => s.stepKey !== step.stepKey);
  const numberOf = (key: string) => allSteps.findIndex((s) => s.stepKey === key) + 1;

  return (
    <div className={styles.form} data-testid="step-editor" data-step-key={step.stepKey}>
      {problems.length > 0 ? (
        <div className={`${styles.banner} ${styles.bannerWarn}`} role="alert" data-testid="step-problems">
          <ul className={styles.problems}>
            {problems.map((p, i) => (
              <li key={`${p.code}-${i}`} className={styles.problemItem}>{p.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={id('title')}>Título da etapa</label>
        <input
          id={id('title')}
          className={styles.input}
          value={step.title}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Ex.: Reunião de kickoff"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={id('description')}>Descrição (opcional)</label>
        <textarea
          id={id('description')}
          className={styles.textarea}
          value={step.description ?? ''}
          maxLength={2000}
          disabled={disabled}
          onChange={(e) => patch({ description: e.target.value.length > 0 ? e.target.value : null })}
        />
      </div>

      <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.label}>Tipo da etapa</legend>
        <div className={styles.choices}>
          {STEP_KIND_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`${styles.choice} ${step.kind === opt.value ? styles.choiceOn : ''} ${
                !opt.available ? styles.choiceDisabled : ''
              }`}
              title={opt.hint}
            >
              <input
                type="radio"
                name={id('kind')}
                value={opt.value}
                checked={step.kind === opt.value}
                disabled={disabled || !opt.available}
                onChange={() => onChange(applyKind(step, opt.value))}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <p className={styles.help}>{STEP_KIND_OPTIONS.find((o) => o.value === step.kind)?.hint}</p>
      </fieldset>

      {isAutomation ? (
        <div className={styles.field} data-testid="automation-flow-field">
          <label className={styles.label} htmlFor={id('flow')}>Fluxo do n8n</label>
          {automationFlows === null ? (
            <p className={styles.help} data-testid="automation-flow-noperm">
              Você não tem permissão para consultar os fluxos da organização. Fluxo atual: {step.automationKey ?? 'nenhum'}.
            </p>
          ) : enabledFlows.length === 0 && !step.automationKey ? (
            <p className={styles.help} data-testid="automation-flow-empty">
              Nenhum fluxo habilitado. Cadastre e habilite um fluxo em Automações antes de usar esta etapa.
            </p>
          ) : (
            <select
              id={id('flow')}
              className={styles.select}
              value={step.automationKey ?? ''}
              disabled={disabled}
              onChange={(e) => patch({ automationKey: e.target.value || null })}
              data-testid="automation-flow-select"
            >
              <option value="">Escolha um fluxo</option>
              {flowGone ? <option value={step.automationKey ?? ''}>{step.automationKey} (indisponível)</option> : null}
              {enabledFlows.map((f) => (
                <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
              ))}
            </select>
          )}
          {flowGone ? (
            <p className={styles.fieldError} role="alert" data-testid="automation-flow-gone">
              O fluxo escolhido não existe ou está desabilitado. Escolha outro antes de publicar.
            </p>
          ) : null}
          <p className={styles.help}>A etapa conclui somente quando o n8n devolver um resultado de sucesso autenticado; ninguém conclui manualmente.</p>
        </div>
      ) : null}

      <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.label}>Responsável</legend>
        <div className={styles.choices}>
          {(
            [
              ['NONE', 'Sem responsável'],
              ['FUNCTION', 'Uma função'],
              ['MEMBER', 'Uma pessoa'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={`${styles.choice} ${step.assigneeMode === value ? styles.choiceOn : ''}`}>
              <input
                type="radio"
                name={id('assignee')}
                value={value}
                checked={step.assigneeMode === value}
                disabled={disabled}
                onChange={() => onChange(applyAssignee(step, value))}
              />
              {label}
            </label>
          ))}
        </div>

        {step.assigneeMode === 'FUNCTION' ? (
          <>
            <label className={styles.label} htmlFor={id('function')}>Função</label>
            <select
              id={id('function')}
              className={styles.select}
              value={step.functionId ?? ''}
              disabled={disabled}
              onChange={(e) => patch({ functionId: e.target.value || null })}
            >
              <option value="">Escolha uma função</option>
              {activeFunctions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
              {fnInactive && currentFn ? <option value={currentFn.id}>{currentFn.name} (desativada)</option> : null}
              {fnMissing && step.functionId ? <option value={step.functionId}>{FUNCTION_REMOVED_LABEL}</option> : null}
            </select>
            {fnInactive || fnMissing ? (
              <p className={styles.fieldError}>
                Esta função não está mais ativa. Escolha outra antes de publicar uma nova versão.
              </p>
            ) : null}
            {activeFunctions.length === 0 && !fnInactive ? (
              <p className={styles.help}>Nenhuma função ativa. Crie funções na aba Funções.</p>
            ) : null}
          </>
        ) : null}

        {step.assigneeMode === 'MEMBER' ? (
          <>
            <label className={styles.label} htmlFor={id('member')}>Pessoa</label>
            <select
              id={id('member')}
              className={styles.select}
              value={step.memberId ?? ''}
              disabled={disabled}
              onChange={(e) => patch({ memberId: e.target.value || null })}
            >
              <option value="">Escolha uma pessoa</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
              {memberMissing && step.memberId ? <option value={step.memberId}>{ASSIGNEE_REMOVED_LABEL}</option> : null}
            </select>
            {memberMissing ? (
              <p className={styles.fieldError}>Esta pessoa não está mais ativa. Escolha outra antes de publicar.</p>
            ) : null}
          </>
        ) : null}
      </fieldset>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id('due')}>Prazo em dias úteis (opcional)</label>
          <input
            id={id('due')}
            className={styles.input}
            type="number"
            min={0}
            max={365}
            inputMode="numeric"
            value={step.dueBusinessDays ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              patch({ dueBusinessDays: raw === '' ? null : Math.max(0, Math.min(365, Math.trunc(Number(raw)))) });
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id('anchor')}>Contado a partir de</label>
          <select
            id={id('anchor')}
            className={styles.select}
            value={step.dueAnchor}
            disabled={disabled || step.dueBusinessDays === null}
            onChange={(e) => patch({ dueAnchor: e.target.value as OnboardingStepInput['dueAnchor'] })}
          >
            <option value="RELEASED">Liberação da etapa</option>
            <option value="START">Início do onboarding</option>
          </select>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Depende de</span>
        {others.length === 0 ? (
          <p className={styles.help}>Adicione outras etapas para criar dependências.</p>
        ) : (
          <div className={styles.checkList}>
            {others.map((o) => (
              <label key={o.stepKey} className={styles.check}>
                <input
                  type="checkbox"
                  checked={step.dependsOn.includes(o.stepKey)}
                  disabled={disabled}
                  onChange={(e) =>
                    patch({
                      dependsOn: e.target.checked
                        ? [...step.dependsOn, o.stepKey]
                        : step.dependsOn.filter((k) => k !== o.stepKey),
                    })
                  }
                />
                <span>
                  {numberOf(o.stepKey)}. {o.title.trim() || 'Etapa sem título'}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className={styles.help}>A etapa só é liberada depois que as etapas marcadas forem concluídas.</p>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id('evidence')}>Evidência</label>
          <select
            id={id('evidence')}
            className={styles.select}
            value={step.evidenceKind}
            disabled={disabled || isAutomation}
            onChange={(e) =>
              onChange(applyEvidence(step, e.target.value as OnboardingEvidenceKind, step.evidenceRequired))
            }
          >
            {(Object.keys(EVIDENCE_LABEL) as OnboardingEvidenceKind[]).map((k) => (
              <option key={k} value={k}>{EVIDENCE_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Conclusão</span>
          {isAsana ? (
            <p className={styles.help}>Concluída quando um projeto do Asana for vinculado (somente vínculo, sem escrita no Asana).</p>
          ) : isAutomation ? (
            <p className={styles.help}>Concluída pelo resultado de sucesso autenticado do fluxo. Falha ou tempo esgotado pedem reenvio ou dispensa com justificativa.</p>
          ) : isCalendar ? (
            <p className={styles.help}>
              Concluída por uma pessoa, escolhendo um evento do Google Calendar já vinculado ao cliente. O vínculo sozinho não conclui a etapa e o Hub não altera nada no Google.
            </p>
          ) : (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={step.evidenceRequired}
                disabled={disabled || step.evidenceKind === 'NONE'}
                onChange={(e) => onChange(applyEvidence(step, step.evidenceKind, e.target.checked))}
              />
              <span>Só conclui com a evidência informada</span>
            </label>
          )}
          {!isAsana && !isCalendar && !isAutomation ? (
            <p className={styles.help}>
              {step.completionCondition === 'EVIDENCE_PROVIDED'
                ? 'Condição: evidência fornecida.'
                : 'Condição: confirmação manual.'}
            </p>
          ) : null}
        </div>
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={step.blocksCompletion}
          disabled={disabled}
          onChange={(e) => patch({ blocksCompletion: e.target.checked })}
        />
        <span>Bloqueia a conclusão do onboarding enquanto não for concluída</span>
      </label>

      <p className={styles.help}>Etapa {index + 1} de {allSteps.length}.</p>
    </div>
  );
}
