import React, { useEffect, useState } from 'react';
import { Plus, Undo2, XCircle, ArrowRight, Trash2 } from 'lucide-react';
import type { DeliverableItem, DeliverablePiece, DeliverableServiceType } from '@zafira/contracts';
import { capabilitiesService } from '@/services/capabilities';
import {
  CONTENT_FORMAT_OPTIONS,
  SERVICE_TYPE_OPTIONS,
  formatContentFormat,
  formatDeliverablePeriod,
  formatPieceStage,
  nextStageActionLabel,
} from '@/lib/deliverables-view';

/* ==========================================================================
   Operação de Entregas (F6-IMP.7B — DEC-F6-002)
   Os botões só aparecem para quem tem a permissão; a API valida tudo de novo.
   ========================================================================== */

export interface DeliverablesPermissions {
  canPlan: boolean;
  canRegister: boolean;
  canAdjust: boolean;
  canClose: boolean;
  canReopen: boolean;
}

const NO_PERMISSIONS: DeliverablesPermissions = {
  canPlan: false,
  canRegister: false,
  canAdjust: false,
  canClose: false,
  canReopen: false,
};

/** Permissões efetivas do usuário na organização ativa. Em caso de falha, nega tudo. */
export function useDeliverablesPermissions(): DeliverablesPermissions {
  const [permissions, setPermissions] = useState<DeliverablesPermissions>(NO_PERMISSIONS);
  useEffect(() => {
    let active = true;
    capabilitiesService
      .getEffectiveCapabilities()
      .then((res) => {
        if (!active) return;
        const p = (res?.permissions ?? {}) as Record<string, boolean | undefined>;
        setPermissions({
          canPlan: p['deliverables.plan'] === true,
          canRegister: p['deliverables.register'] === true,
          canAdjust: p['deliverables.adjust_target'] === true,
          canClose: p['deliverables.complete'] === true,
          canReopen: p['deliverables.reopen'] === true,
        });
      })
      .catch(() => {
        if (active) setPermissions(NO_PERMISSIONS);
      });
    return () => {
      active = false;
    };
  }, []);
  return permissions;
}

const inputClass =
  'h-8 rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-400/60';
const primaryButton =
  'inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white hover:bg-white/[0.07] disabled:opacity-50 disabled:cursor-not-allowed';
const ghostButton =
  'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-white hover:bg-white/[0.05] disabled:opacity-50';

/* -------------------------------------------------------------------------- */
/* Justificativa obrigatória                                                   */
/* -------------------------------------------------------------------------- */

export interface ReasonRequest {
  title: string;
  description: string;
  confirmLabel: string;
  optional?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function ReasonDialog({ request, busy, onCancel }: { request: ReasonRequest; busy: boolean; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const valid = request.optional || reason.trim().length >= 3;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="reason-title">
      <form
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#121218] p-5 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) void request.onConfirm(reason.trim());
        }}
      >
        <h3 id="reason-title" className="text-sm font-semibold text-white">{request.title}</h3>
        <p className="text-xs text-muted-foreground">{request.description}</p>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {request.optional ? 'Observação (opcional)' : 'Justificativa (obrigatória, mínimo 3 caracteres)'}
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={3}
            className={`${inputClass} h-auto py-2`}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>
            Voltar
          </button>
          <button type="submit" className={primaryButton} disabled={!valid || busy}>
            {busy ? 'Salvando…' : request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Linhas do plano (criação do plano e linha nova)                             */
/* -------------------------------------------------------------------------- */

interface LineDraft {
  serviceType: string;
  title: string;
  targetQuantity: string;
  isExtra: boolean;
}

const defaultTitle = (serviceType: string) =>
  SERVICE_TYPE_OPTIONS.find((o) => o.value === serviceType)?.label.replace(' (pacote)', '') ?? '';

function LineFields({
  line,
  onChange,
  allowExtra,
}: {
  line: LineDraft;
  onChange: (line: LineDraft) => void;
  allowExtra: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Serviço"
        className={inputClass}
        value={line.serviceType}
        onChange={(e) => {
          const serviceType = e.target.value;
          const keepTitle = line.title && line.title !== defaultTitle(line.serviceType);
          onChange({ ...line, serviceType, title: keepTitle ? line.title : defaultTitle(serviceType) });
        }}
      >
        {SERVICE_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <input
        aria-label="Título da linha"
        className={`${inputClass} flex-1 min-w-[160px]`}
        value={line.title}
        maxLength={200}
        onChange={(e) => onChange({ ...line, title: e.target.value })}
      />
      <input
        aria-label="Quantidade contratada"
        type="number"
        min={1}
        max={500}
        className={`${inputClass} w-20`}
        value={line.targetQuantity}
        onChange={(e) => onChange({ ...line, targetQuantity: e.target.value })}
      />
      {allowExtra && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={line.isExtra} onChange={(e) => onChange({ ...line, isExtra: e.target.checked })} />
          Extra (fora do contrato)
        </label>
      )}
    </div>
  );
}

const toItem = (line: LineDraft) => ({
  serviceType: line.serviceType as DeliverableServiceType,
  title: line.title.trim(),
  targetQuantity: Number(line.targetQuantity),
  isExtra: line.isExtra,
});
const lineValid = (line: LineDraft) =>
  line.title.trim().length > 0 && Number.isInteger(Number(line.targetQuantity)) && Number(line.targetQuantity) >= 1 && Number(line.targetQuantity) <= 500;

export function CreatePlanForm({
  period,
  clientName,
  busy,
  onSubmit,
  onCancel,
}: {
  period: string;
  clientName?: string;
  busy: boolean;
  onSubmit: (body: { period: string; title: string; items: ReturnType<typeof toItem>[] }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(`Plano de entregas — ${formatDeliverablePeriod(period)}`);
  const [lines, setLines] = useState<LineDraft[]>([
    { serviceType: 'CONTEUDO_SOCIAL', title: 'Conteúdos para redes', targetQuantity: '12', isExtra: false },
  ]);
  const valid = title.trim().length > 0 && lines.length > 0 && lines.every(lineValid);

  return (
    <form
      className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col gap-3"
      aria-label="Criar plano do mês"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void onSubmit({ period, title: title.trim(), items: lines.map(toItem) });
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-white">Criar plano de {formatDeliverablePeriod(period)}</span>
        <span className="text-xs text-muted-foreground">
          {clientName ? `${clientName}: ` : ''}informe o que o contrato prevê no mês. Conteúdos para redes contam como
          pacote único (qualquer formato).
        </span>
      </div>
      <input aria-label="Título do plano" className={inputClass} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      {lines.map((line, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="flex-1">
            <LineFields line={line} allowExtra={false} onChange={(next) => setLines(lines.map((l, i) => (i === index ? next : l)))} />
          </div>
          {lines.length > 1 && (
            <button type="button" className={ghostButton} aria-label="Remover linha" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className={ghostButton}
          onClick={() => setLines([...lines, { serviceType: 'CRIATIVO_ADS', title: defaultTitle('CRIATIVO_ADS'), targetQuantity: '1', isExtra: false }])}
        >
          <Plus size={13} /> Adicionar serviço
        </button>
        <div className="flex gap-2">
          <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="submit" className={primaryButton} disabled={!valid || busy}>{busy ? 'Salvando…' : 'Criar plano'}</button>
        </div>
      </div>
    </form>
  );
}

export function AddItemForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (body: ReturnType<typeof toItem>) => Promise<void>;
  onCancel: () => void;
}) {
  const [line, setLine] = useState<LineDraft>({ serviceType: 'CRIATIVO_ADS', title: defaultTitle('CRIATIVO_ADS'), targetQuantity: '1', isExtra: false });
  return (
    <form
      className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-col gap-2"
      aria-label="Adicionar linha ao plano"
      onSubmit={(e) => {
        e.preventDefault();
        if (lineValid(line) && !busy) void onSubmit(toItem(line));
      }}
    >
      <LineFields line={line} onChange={setLine} allowExtra />
      <div className="flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className={primaryButton} disabled={!lineValid(line) || busy}>Adicionar linha</button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças de uma linha                                                          */
/* -------------------------------------------------------------------------- */

export interface PieceHandlers {
  onAdd: (item: DeliverableItem, body: { title: string; format?: string }) => Promise<void>;
  onAdvance: (piece: DeliverablePiece) => Promise<void>;
  onRevert: (piece: DeliverablePiece) => void;
  onCancel: (piece: DeliverablePiece) => void;
}

const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

export function PiecesPanel({
  item,
  editable,
  busy,
  handlers,
}: {
  item: DeliverableItem;
  editable: boolean;
  busy: boolean;
  handlers: PieceHandlers;
}) {
  const pieces = item.pieces ?? [];
  const isContent = item.serviceType === 'CONTEUDO_SOCIAL';
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<string>('');
  const canSubmit = title.trim().length > 0 && (!isContent || format !== '') && !busy;

  return (
    <div className="mt-3 border-t border-white/5 pt-3 flex flex-col gap-2" data-testid={`pieces-${item.id}`}>
      {pieces.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">Nenhuma peça registrada nesta linha.</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pieces.map((piece) => {
            const stage = formatPieceStage(piece.stage, item.serviceType);
            const next = nextStageActionLabel(piece.stage, item.serviceType);
            const who =
              piece.stage === 'DELIVERED'
                ? `${piece.deliveredByName || 'Usuário removido'} em ${formatDate(piece.deliveredAt)}`
                : piece.stage === 'APPROVED'
                  ? `${piece.approvedByName || 'Usuário removido'} em ${formatDate(piece.approvedAt)}`
                  : `${piece.producedByName || 'Usuário removido'} em ${formatDate(piece.producedAt)}`;
            return (
              <li key={piece.id} className="flex flex-wrap items-center gap-2 rounded-md bg-white/[0.02] px-2.5 py-1.5">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${stage.badgeClass}`}>{stage.label}</span>
                <span className={`text-xs ${piece.stage === 'CANCELLED' ? 'line-through text-muted-foreground' : 'text-white'}`}>{piece.title}</span>
                {formatContentFormat(piece.format) && (
                  <span className="text-[10px] text-violet-300/90">{formatContentFormat(piece.format)}</span>
                )}
                <span className="text-[10px] text-muted-foreground">{who}</span>
                {editable && (
                  <span className="ml-auto flex items-center gap-1">
                    {next && (
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => void handlers.onAdvance(piece)}>
                        <ArrowRight size={12} /> {next}
                      </button>
                    )}
                    {(piece.stage === 'APPROVED' || piece.stage === 'DELIVERED') && (
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => handlers.onRevert(piece)}>
                        <Undo2 size={12} /> Voltar etapa
                      </button>
                    )}
                    {piece.stage !== 'CANCELLED' && (
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => handlers.onCancel(piece)}>
                        <XCircle size={12} /> Cancelar
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <form
          className="flex flex-wrap items-center gap-2"
          aria-label={`Registrar peça em ${item.title}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit) return;
            await handlers.onAdd(item, { title: title.trim(), ...(isContent ? { format } : {}) });
            setTitle('');
          }}
        >
          <input
            aria-label="Título da peça"
            placeholder={isContent ? 'Ex.: Reels de lançamento' : 'Ex.: Relatório de outubro'}
            className={`${inputClass} flex-1 min-w-[180px]`}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          {isContent && (
            <select aria-label="Formato" className={inputClass} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Formato…</option>
              {CONTENT_FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <button type="submit" className={secondaryButton} disabled={!canSubmit}>
            <Plus size={13} /> Registrar peça produzida
          </button>
        </form>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ajuste de meta                                                              */
/* -------------------------------------------------------------------------- */

export function AdjustTargetForm({
  item,
  busy,
  onSubmit,
  onCancel,
}: {
  item: DeliverableItem;
  busy: boolean;
  onSubmit: (newTargetQuantity: number, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(item.targetQuantity));
  const [reason, setReason] = useState('');
  const quantity = Number(value);
  const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 500 && quantity !== item.targetQuantity && reason.trim().length >= 3;
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3"
      aria-label={`Ajustar meta de ${item.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void onSubmit(quantity, reason.trim());
      }}
    >
      <span className="text-[11px] text-muted-foreground">Nova meta</span>
      <input aria-label="Nova meta" type="number" min={1} max={500} className={`${inputClass} w-20`} value={value} onChange={(e) => setValue(e.target.value)} />
      <input
        aria-label="Justificativa do ajuste"
        placeholder="Justificativa (ex.: aditivo contratual)"
        className={`${inputClass} flex-1 min-w-[200px]`}
        value={reason}
        maxLength={1000}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>Cancelar</button>
      <button type="submit" className={primaryButton} disabled={!valid || busy}>Salvar meta</button>
    </form>
  );
}

export const operationButtonClasses = { primaryButton, secondaryButton, ghostButton };
