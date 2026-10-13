/**
 * Regras puras de apresentação de Entregas próprias Zafira (F6-IMP.7).
 *
 * Segregação estrita entre metas contratadas e entregas extras (DEC-ASANA-001 e Mapa Mestre).
 * Tarefas Asana são tratadas exclusivamente como evidências com links seguros de consulta externa.
 */
import type {
  DeliverablePlan,
  DeliverableItem,
  DeliverableLink,
  DeliverableEvent,
  DeliverablePlanStatus,
  DeliverableItemStatus,
  DeliverableLinkType,
} from '@zafira/contracts';

export interface DeliverablesViewMetrics {
  contractedTarget: number;
  contractedDelivered: number;
  contractedPending: number;
  contractedProgressPercent: number;
  extraDelivered: number;
  totalDelivered: number;
  isFullyDelivered: boolean;
}

export const MONTH_NAMES_PTBR = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

/**
 * Formata período YYYY-MM para exibição humana em português (ex: "Outubro de 2026").
 */
export function formatDeliverablePeriod(period: string): string {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period || 'Período não informado';
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (month < 1 || month > 12) return period;
  return `${MONTH_NAMES_PTBR[month - 1]} de ${year}`;
}

/**
 * Calcula métricas com segregação matemática rigorosa: itens extras NUNCA
 * entram no denominador da meta contratada e NUNCA mascaram déficits.
 */
export function calculateDeliverablesMetrics(
  items: readonly DeliverableItem[]
): DeliverablesViewMetrics {
  let contractedTarget = 0;
  let contractedDelivered = 0;
  let extraDelivered = 0;

  for (const item of items) {
    if (item.status === 'CANCELLED') continue;

    if (item.isExtra) {
      extraDelivered += Math.max(0, item.deliveredQuantity);
    } else {
      // DEC-F6-002: cada linha conta até a própria meta; o excedente é extra e não cobre outra linha.
      const target = Math.max(0, item.targetQuantity);
      const delivered = Math.max(0, item.deliveredQuantity);
      contractedTarget += target;
      contractedDelivered += Math.min(delivered, target);
      extraDelivered += Math.max(0, delivered - target);
    }
  }

  const contractedPending = Math.max(0, contractedTarget - contractedDelivered);

  let contractedProgressPercent = 0;
  if (contractedTarget > 0) {
    contractedProgressPercent = Math.min(
      100,
      Math.round((contractedDelivered / contractedTarget) * 100)
    );
  } else if (contractedDelivered > 0) {
    contractedProgressPercent = 100;
  }

  const totalDelivered = contractedDelivered + extraDelivered;
  const isFullyDelivered =
    contractedTarget > 0 && contractedDelivered >= contractedTarget;

  return {
    contractedTarget,
    contractedDelivered,
    contractedPending,
    contractedProgressPercent,
    extraDelivered,
    totalDelivered,
    isFullyDelivered,
  };
}

/**
 * Rótulo e estilização temática da situação do plano de entregas.
 */
export function getPlanStatusMeta(status: DeliverablePlanStatus): {
  label: string;
  badgeClass: string;
  isClosed: boolean;
} {
  switch (status) {
    case 'ACTIVE':
      return {
        label: 'Em Andamento',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        isClosed: false,
      };
    case 'CLOSED':
      return {
        label: 'Encerrado (Fechado)',
        badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        isClosed: true,
      };
    case 'DRAFT':
      return {
        label: 'Rascunho',
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        isClosed: false,
      };
    case 'CANCELLED':
      return {
        label: 'Cancelado',
        badgeClass: 'bg-red-500/10 text-red-400 border-red-500/20',
        isClosed: true,
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-white/5 text-muted-foreground border-white/10',
        isClosed: false,
      };
  }
}

/**
 * Rótulo e estilo para itens de entrega.
 */
export function getItemStatusMeta(status: DeliverableItemStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'DELIVERED':
      return {
        label: 'Entregue',
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      };
    case 'IN_PROGRESS':
      return {
        label: 'Em Produção',
        badgeClass: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      };
    case 'PENDING':
      return {
        label: 'Pendente',
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      };
    case 'CANCELLED':
      return {
        label: 'Cancelado',
        badgeClass: 'bg-red-500/10 text-red-400 border-red-500/20',
      };
    default:
      return {
        label: status,
        badgeClass: 'bg-white/5 text-muted-foreground border-white/10',
      };
  }
}

/**
 * Converte códigos de tipos de serviço em rótulos amigáveis.
 */
export function formatDeliverableServiceType(type: string): string {
  const normalized = (type || '').toUpperCase();
  const map: Record<string, string> = {
    CONTEUDO_SOCIAL: 'Conteúdos para redes (pacote)',
    CAPTACAO: 'Captação de foto/vídeo',
    GESTAO_TRAFEGO: 'Gestão de tráfego pago',
    OUTRO: 'Outro serviço',
    RELATORIO_MENSAL: 'Relatório mensal',
    POST_FEED: 'Post no Feed',
    REELS: 'Reels / Vídeo Curto',
    STORIES: 'Stories',
    CAROUSEL: 'Carrossel',
    ARTIGO_BLOG: 'Artigo de Blog',
    LANDING_PAGE: 'Landing Page',
    EMAIL_MARKETING: 'Email Marketing',
    RELATORIO: 'Relatório Mensal',
    CRIATIVO_ADS: 'Criativo para Ads',
  };
  return map[normalized] || type || 'Entrega Personalizada';
}

/**
 * Sanitiza e gera link seguro para evidências.
 * Para tarefas Asana, valida estritamente o host `asana.com` ou constrói deep link seguro.
 */
export function getSafeEvidenceUrl(link: DeliverableLink): string | null {
  if (link.linkType === 'ASANA_TASK') {
    if (link.url) {
      try {
        const parsed = new URL(link.url);
        if (
          parsed.protocol === 'https:' &&
          (parsed.hostname === 'asana.com' || parsed.hostname.endsWith('.asana.com'))
        ) {
          return parsed.toString();
        }
      } catch {
        // Fallback para construção pelo externalId se a URL estiver inválida
      }
    }
    if (link.externalId && /^\d+$/.test(link.externalId)) {
      return `https://app.asana.com/0/0/${link.externalId}`;
    }
    return null;
  }

  if (link.url) {
    try {
      const parsed = new URL(link.url);
      if (parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Formata descrição legível para eventos de auditoria do plano.
 */
export function formatDeliverableEventDescription(event: DeliverableEvent): {
  title: string;
  details?: string;
} {
  switch (event.eventType) {
    case 'PLAN_CREATED':
      return { title: 'Plano de entregas criado para o período' };
    case 'TARGET_ADJUSTED':
      return {
        title: 'Meta contratada ajustada',
        details: event.reason
          ? `Justificativa formal: "${event.reason}"`
          : undefined,
      };
    case 'PLAN_CLOSED':
      return {
        title: 'Plano de entregas encerrado formalmente',
        details: event.reason ? `Motivo: ${event.reason}` : undefined,
      };
    case 'PLAN_REOPENED':
      return {
        title: 'Plano de entregas reaberto para ajustes',
        details: event.reason
          ? `Justificativa de reabertura: "${event.reason}"`
          : undefined,
      };
    case 'ITEM_ADDED':
      return { title: 'Novo item adicionado ao plano' };
    case 'ITEM_REMOVED':
      return { title: 'Item removido do plano' };
    case 'LINK_ATTACHED':
      return { title: 'Evidência vinculada à entrega' };
    case 'LINK_DETACHED':
      return { title: 'Evidência desvinculada da entrega' };
    case 'STATUS_CHANGED':
      return { title: 'Situação do item atualizada' };
    case 'ITEM_DELIVERED':
      return { title: 'Item entregue' };
    case 'PIECE_ADDED':
      return { title: `Peça registrada: ${pieceTitle(event.after)}` };
    case 'PIECE_ADVANCED':
      return { title: `${pieceTitle(event.after)}: ${stageOf(event.after) === 'DELIVERED' ? 'entregue/postada' : formatPieceStage(stageOf(event.after)).label.toLowerCase()}` };
    case 'PIECE_REVERTED':
      return {
        title: `${pieceTitle(event.after)}: voltou para ${formatPieceStage(stageOf(event.after)).label.toLowerCase()}`,
        details: event.reason ? `Justificativa: "${event.reason}"` : undefined,
      };
    case 'PIECE_CANCELLED':
      return {
        title: `Peça cancelada: ${pieceTitle(event.after)}`,
        details: event.reason ? `Justificativa: "${event.reason}"` : undefined,
      };
    default:
      return { title: event.eventType };
  }
}

/* --------------------------------------------------------------------------
   Operação de Entregas (F6-IMP.7B — DEC-F6-002)
   -------------------------------------------------------------------------- */

function pieceTitle(value: unknown): string {
  const title = value && typeof value === 'object' ? (value as { title?: unknown }).title : undefined;
  return typeof title === 'string' && title.trim() ? title : 'peça';
}

function stageOf(value: unknown): string {
  const stage = value && typeof value === 'object' ? (value as { stage?: unknown }).stage : undefined;
  return typeof stage === 'string' ? stage : '';
}

export const SERVICE_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'CONTEUDO_SOCIAL', label: 'Conteúdos para redes (pacote)' },
  { value: 'CRIATIVO_ADS', label: 'Criativos para anúncios' },
  { value: 'RELATORIO_MENSAL', label: 'Relatório mensal' },
  { value: 'CAPTACAO', label: 'Captação de foto/vídeo' },
  { value: 'GESTAO_TRAFEGO', label: 'Gestão de tráfego pago' },
  { value: 'OUTRO', label: 'Outro serviço' },
];

export const CONTENT_FORMAT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'FEED', label: 'Post no feed' },
  { value: 'CARROSSEL', label: 'Carrossel' },
  { value: 'REELS', label: 'Reels / vídeo curto' },
  { value: 'STORIES', label: 'Stories' },
];

export function formatContentFormat(format: string | null | undefined): string | null {
  if (!format) return null;
  return CONTENT_FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? format;
}

/** Rótulo e cor da etapa da peça. Só "Entregue/Postada" conta para a meta. */
export function formatPieceStage(stage: string, serviceType?: string): { label: string; badgeClass: string } {
  switch (stage) {
    case 'PRODUCED':
      return { label: 'Produzida', badgeClass: 'bg-slate-500/10 text-slate-300 border-slate-500/20' };
    case 'APPROVED':
      return { label: 'Aprovada', badgeClass: 'bg-blue-500/10 text-blue-300 border-blue-500/20' };
    case 'DELIVERED':
      return {
        label: serviceType === 'CONTEUDO_SOCIAL' ? 'Postada' : 'Entregue',
        badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
      };
    case 'CANCELLED':
      return { label: 'Cancelada', badgeClass: 'bg-red-500/10 text-red-300 border-red-500/20' };
    default:
      return { label: stage || 'Desconhecida', badgeClass: 'bg-white/5 text-muted-foreground border-white/10' };
  }
}

/** Texto do botão que avança a peça para a próxima etapa (ou null se não avança). */
export function nextStageActionLabel(stage: string, serviceType: string): string | null {
  if (stage === 'PRODUCED') return 'Marcar como aprovada';
  if (stage === 'APPROVED') return serviceType === 'CONTEUDO_SOCIAL' ? 'Marcar como postada' : 'Marcar como entregue';
  return null;
}
