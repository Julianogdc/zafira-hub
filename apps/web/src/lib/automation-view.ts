import type { AutomationOutboxStatus } from '@/services/automation';
import type { BadgeTone } from '@/lib/onboarding-execution-view';

/** F7-4b - Apresentacao pura das automacoes n8n (sem React, sem rede). */

export const AUTOMATION_STATUS: Record<AutomationOutboxStatus, { label: string; tone: BadgeTone; help: string }> = {
  PENDING: { label: 'Aguardando envio', tone: 'neutral', help: 'O pedido foi registrado e ainda não foi enviado ao n8n.' },
  SENT: {
    label: 'Enviada, aguardando resultado',
    tone: 'info',
    help: 'O pedido foi enviado e o fluxo está em processamento. Enviado não é concluído: a etapa só conclui quando o n8n devolver o resultado de sucesso.',
  },
  RETRYING: { label: 'Nova tentativa agendada', tone: 'warning', help: 'O último envio falhou por instabilidade e uma nova tentativa foi agendada.' },
  SUCCEEDED: { label: 'Concluída com sucesso', tone: 'success', help: 'O n8n devolveu um resultado de sucesso autenticado.' },
  FAILED: { label: 'Falhou', tone: 'danger', help: 'A automação falhou. A etapa não conclui sozinha: reenvie ou dispense com justificativa.' },
  TIMED_OUT: { label: 'Tempo esgotado', tone: 'danger', help: 'Nenhum resultado chegou dentro do prazo. Reenvie ou dispense com justificativa.' },
  DEAD: { label: 'Tentativas esgotadas', tone: 'danger', help: 'As tentativas de envio acabaram. Reenvie ou dispense com justificativa.' },
};

export function automationStatusText(status: AutomationOutboxStatus | null): { label: string; tone: BadgeTone; help: string } {
  return status ? AUTOMATION_STATUS[status] : { label: 'Sem pedido', tone: 'neutral', help: 'Ainda não há pedido de automação para esta etapa.' };
}

export interface AutomationStepState {
  flowKey: string | null;
  status: AutomationOutboxStatus | null;
  dispatcherEnabled: boolean;
  appliedAt: string | null;
}

/** Aviso contextual: despachante desligado, resultado aguardando desbloqueio. */
export function automationNotice(a: AutomationStepState, stepBlocked: boolean): { tone: BadgeTone; text: string } | null {
  if ((a.status === 'PENDING' || a.status === 'RETRYING') && !a.dispatcherEnabled) {
    return {
      tone: 'warning',
      text: 'O envio automático está desligado neste ambiente. O pedido fica aguardando e a etapa não conclui até que o envio seja ativado por quem administra o Hub.',
    };
  }
  if (a.status === 'SUCCEEDED' && !a.appliedAt && stepBlocked) {
    return { tone: 'info', text: 'O resultado de sucesso já chegou, mas a etapa está bloqueada. Ao desbloquear, a conclusão é aplicada.' };
  }
  return null;
}

const AUTOMATION_EVENT_LABEL: Record<string, string> = {
  AUTOMATION_SENT: 'Automação enviada ao n8n',
  AUTOMATION_RETRY_SCHEDULED: 'Nova tentativa de envio agendada',
  AUTOMATION_FAILED: 'Automação falhou',
  AUTOMATION_TIMED_OUT: 'Automação sem resultado no prazo',
  AUTOMATION_SUCCEEDED: 'Resultado de sucesso recebido',
  AUTOMATION_RESULT_IGNORED: 'Resultado recebido e ignorado',
  AUTOMATION_RESULT_PENDING: 'Resultado aguardando desbloqueio',
  AUTOMATION_RETRY_REQUESTED: 'Reenvio solicitado',
  AUTOMATION_REDO_REQUESTED: 'Nova execução solicitada',
};

export const automationEventLabel = (type: string): string | null => AUTOMATION_EVENT_LABEL[type] ?? null;

export const isAutomationEvent = (type: string) => type.startsWith('AUTOMATION_');

/** Referencia externa so e link quando https; senao aparece como texto. */
export function safeExternalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Chave do fluxo: minusculas, numeros, hifen e sublinhado (mesma regra do servidor). */
export const FLOW_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function suggestFlowKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function flowFormProblem(f: { key: string; name: string; webhookUrl: string }, isNew: boolean): string | null {
  if (f.name.trim().length === 0) return 'Informe o nome do fluxo.';
  if (isNew && !FLOW_KEY_PATTERN.test(f.key)) return 'O identificador usa minúsculas, números, hífen e sublinhado.';
  if (f.webhookUrl.trim().length > 0 || isNew) {
    try {
      const u = new URL(f.webhookUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'A URL do webhook deve começar com https://.';
    } catch {
      return 'Informe a URL do webhook do n8n.';
    }
  }
  return null;
}

export function secretProblem(secret: string): string | null {
  return secret.length >= 32 ? null : 'O segredo compartilhado precisa ter ao menos 32 caracteres.';
}
