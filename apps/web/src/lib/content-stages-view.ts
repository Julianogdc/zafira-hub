import type { ContentStagesResponse } from '@zafira/contracts';

/**
 * F8-3 (DEC-F8-007) - Apresentação do contador de Entregas por estágio.
 * Somente leitura. "Publicados" sem confirmação confiável nunca vira 0: aparece como aguardando integração.
 */

export type ContentStageCounts = ContentStagesResponse['counts'];

/** Hoje a API devolve sempre null; a tela já aceita o número que virá com a confirmação real (F8-4/F8-5). */
export type PublishedCounts = { received: number; published: number | null };

export interface StageCard {
  key: 'received' | 'sent' | 'approved' | 'published';
  label: string;
  /** null = dado indisponível (nunca exibido como 0). */
  value: number | null;
  hint: string;
}

export function contentStageCards(counts: ContentStageCounts): StageCard[] {
  return [
    { key: 'received', label: 'Arquivos recebidos', value: counts.received, hint: 'peças com arquivo final no Hub' },
    { key: 'sent', label: 'Enviados para aprovação', value: counts.sent, hint: 'peças enviadas ao cliente' },
    { key: 'approved', label: 'Aprovados pelo cliente', value: counts.approved, hint: 'peças aprovadas pelo cliente' },
    {
      key: 'published',
      label: 'Publicados',
      value: counts.published,
      hint: counts.published === null ? 'Aguardando integração da publicação' : 'publicação confirmada',
    },
  ];
}

export type PublishedBarState =
  | { kind: 'NOT_INTEGRATED'; label: string }
  | { kind: 'EMPTY'; label: string }
  | { kind: 'RATIO'; percent: number; label: string };

/** Barra complementar: publicadas ÷ recebidas. Neutra enquanto não houver confirmação real de publicação. */
export function publishedBarState(counts: PublishedCounts): PublishedBarState {
  if (counts.published === null) {
    return { kind: 'NOT_INTEGRATED', label: 'Publicação ainda não integrada (próximas etapas)' };
  }
  if (counts.received <= 0) return { kind: 'EMPTY', label: 'Sem arquivos recebidos no período' };
  const percent = Math.round(Math.min(1, Math.max(0, counts.published / counts.received)) * 100);
  return { kind: 'RATIO', percent, label: `${counts.published} de ${counts.received} peças publicadas` };
}

export function formatStageValue(value: number | null): string {
  return value === null ? '—' : String(value);
}
