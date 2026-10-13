import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Sparkles,
  Search,
  History,
  X,
  AlertCircle,
  FileText,
  Lock,
  Plus,
  ListChecks,
  Target,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  DeliverablePlan,
  DeliverableItem,
  DeliverableLink,
  DeliverableEvent,
  DeliverableContentFormat,
} from '@zafira/contracts';
import { deliverablesService, deliverablesOperations, DeliverablePlanDetails } from '@/services/deliverables';
import {
  AddItemForm,
  AdjustTargetForm,
  CreatePlanForm,
  PiecesPanel,
  ReasonDialog,
  ReasonRequest,
  operationButtonClasses,
  useDeliverablesPermissions,
} from './DeliverablesOperations';
import {
  formatDeliverablePeriod,
  calculateDeliverablesMetrics,
  getPlanStatusMeta,
  getItemStatusMeta,
  formatDeliverableServiceType,
  getSafeEvidenceUrl,
  formatDeliverableEventDescription,
} from '@/lib/deliverables-view';
import {
  LoadingState,
  EmptyState,
  ErrorState,
  PermissionState,
} from '@/components/ui/ds';
import { useAuthStore } from '@/store/useAuthStore';
import { currentPeriodInTimeZone, isoDateToCalendarDate, todayInTimeZone } from '@/lib/organization-time';
import styles from './CanonicalDeliverablesView.module.css';

export interface CanonicalDeliverablesViewProps {
  clientId: string;
  clientName?: string;
}

/** Mês corrente no fuso da organização (DEC-F6-005). */
function getCurrentPeriod(timeZone?: string): string {
  return currentPeriodInTimeZone(timeZone);
}

function shiftPeriod(period: string, deltaMonths: number): string {
  const [y, m] = period.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const newY = date.getUTCFullYear();
  const newM = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${newY}-${newM}`;
}

export function CanonicalDeliverablesView({
  clientId,
  clientName,
}: CanonicalDeliverablesViewProps) {
  const orgTimeZone = useAuthStore((state) => state.currentOrganization?.timezone);
  const [period, setPeriod] = useState<string>(() => getCurrentPeriod(orgTimeZone));
  const [plan, setPlan] = useState<DeliverablePlanDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  // Filtros locais de itens
  const [search, setSearch] = useState<string>('');
  const [onlyExtras, setOnlyExtras] = useState<boolean>(false);

  // Modal de Evidências
  const [selectedItemForEvidence, setSelectedItemForEvidence] = useState<DeliverableItem | null>(null);

  // Auditoria
  const [showAudit, setShowAudit] = useState<boolean>(false);

  // Operação (F6-IMP.7B — DEC-F6-002)
  const permissions = useDeliverablesPermissions();
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [reasonRequest, setReasonRequest] = useState<ReasonRequest | null>(null);

  const loadPlan = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await deliverablesService.getClientDeliverables(clientId, period);
      setPlan(res.plan);
    } catch (err: unknown) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 403) {
        setError({
          status: 403,
          message: 'Sem permissão para consultar entregas da organização (deliverables.view).',
        });
      } else {
        setError({
          status: status || 500,
          message: 'Não foi possível carregar o plano de entregas deste cliente.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [clientId, period]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    setShowCreate(false);
    setShowAddItem(false);
    setAdjustingItemId(null);
  }, [clientId, period]);

  /** Executa uma operação, troca o plano pelo devolvido pela API e informa o resultado. */
  const runOperation = useCallback(
    async (operation: () => Promise<DeliverablePlanDetails | null>, successMessage: string): Promise<boolean> => {
      setBusy(true);
      try {
        const updated = await operation();
        setPlan(updated);
        toast.success(successMessage);
        return true;
      } catch (err: unknown) {
        const e = err as { status?: number; message?: string } | null;
        toast.error(e?.message || 'Não foi possível salvar. Tente novamente.');
        if (e?.status === 409) void loadPlan();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadPlan]
  );

  const toggleExpanded = (itemId: string) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const rawItems = useMemo(() => plan?.items || [], [plan?.items]);

  const metrics = useMemo(() => {
    return calculateDeliverablesMetrics(rawItems);
  }, [rawItems]);

  const filteredItems = useMemo(() => {
    return rawItems.filter((item) => {
      if (onlyExtras && !item.isExtra) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(query);
        const matchType = item.serviceType.toLowerCase().includes(query);
        if (!matchTitle && !matchType) return false;
      }
      return true;
    });
  }, [rawItems, search, onlyExtras]);

  const planStatusMeta = useMemo(() => {
    return getPlanStatusMeta(plan?.status || 'ACTIVE');
  }, [plan?.status]);

  // Plano fechado ou cancelado fica somente leitura.
  const canEdit = Boolean(plan) && (plan?.status === 'ACTIVE' || plan?.status === 'DRAFT');

  // --------------------------------------------------------------------------
  // ESTADOS: Sem Permissão, Erro e Carregando
  // --------------------------------------------------------------------------
  if (error?.status === 403) {
    return (
      <div className={styles.container}>
        <PermissionState
          title="Acesso Negado às Entregas"
          description={error.message}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <LoadingState
          message={`Carregando entregas de ${clientName || 'cliente'} (${formatDeliverablePeriod(period)})...`}
          fullHeight={false}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <ErrorState
          title="Erro ao carregar entregas"
          description={error.message}
          onRetry={loadPlan}
        />
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="deliverables-view-container">
      {/* 1. CABEÇALHO DO PLANO E NAVEGAÇÃO DE PERÍODO */}
      <div className={styles.headerCard}>
        <div className={styles.planTitleGroup}>
          <div className={styles.planTitleRow}>
            <h2 className={styles.planTitle}>
              {plan?.title || `Entregas — ${formatDeliverablePeriod(period)}`}
            </h2>
            {plan && (
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${planStatusMeta.badgeClass}`}
              >
                {planStatusMeta.label}
              </span>
            )}
            {plan && planStatusMeta.isClosed && (
              <span className="flex items-center gap-1 text-[11px] text-blue-400">
                <Lock size={12} />
                Somente Leitura
              </span>
            )}
          </div>
          {plan && (permissions.canClose || permissions.canReopen) && (
            <div className="flex gap-2 mt-1">
              {!planStatusMeta.isClosed && permissions.canClose && (
                <button
                  type="button"
                  className={operationButtonClasses.secondaryButton}
                  disabled={busy}
                  onClick={() =>
                    setReasonRequest({
                      title: `Fechar ${formatDeliverablePeriod(plan.period)}`,
                      description: 'Depois de fechado, o mês fica somente leitura até ser reaberto com justificativa.',
                      confirmLabel: 'Fechar mês',
                      optional: true,
                      onConfirm: async () => {
                        const ok = await runOperation(() => deliverablesOperations.closePlan(clientId, plan.id), 'Mês fechado.');
                        if (ok) setReasonRequest(null);
                      },
                    })
                  }
                >
                  <Lock size={13} /> Fechar mês
                </button>
              )}
              {planStatusMeta.isClosed && permissions.canReopen && (
                <button
                  type="button"
                  className={operationButtonClasses.secondaryButton}
                  disabled={busy}
                  onClick={() =>
                    setReasonRequest({
                      title: `Reabrir ${formatDeliverablePeriod(plan.period)}`,
                      description: 'Explique por que o mês fechado precisa ser reaberto. Fica registrado no histórico.',
                      confirmLabel: 'Reabrir mês',
                      onConfirm: async (reason) => {
                        const ok = await runOperation(
                          () => deliverablesOperations.reopenPlan(clientId, plan.id, { reason }),
                          'Mês reaberto.'
                        );
                        if (ok) setReasonRequest(null);
                      },
                    })
                  }
                >
                  <Unlock size={13} /> Reabrir mês
                </button>
              )}
            </div>
          )}
          <p className={styles.planDescription}>
            {plan
              ? plan.description ||
                `Acompanhamento de metas contratuais e entregas extras para ${clientName || 'o cliente'}.`
              : `Nenhum plano de entregas cadastrado para ${clientName || 'este cliente'} neste período.`}
          </p>
        </div>

        {/* Seletor de Período YYYY-MM */}
        <div className={styles.periodControls}>
          <button
            type="button"
            onClick={() => setPeriod((prev) => shiftPeriod(prev, -1))}
            className={styles.periodNavButton}
            title="Mês anterior"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={16} />
          </button>

          <span className={styles.periodLabel}>{formatDeliverablePeriod(period)}</span>

          <button
            type="button"
            onClick={() => setPeriod((prev) => shiftPeriod(prev, 1))}
            className={styles.periodNavButton}
            title="Próximo mês"
            aria-label="Próximo mês"
          >
            <ChevronRight size={16} />
          </button>

          {period !== getCurrentPeriod(orgTimeZone) && (
            <button
              type="button"
              onClick={() => setPeriod(getCurrentPeriod(orgTimeZone))}
              className={styles.periodCurrentButton}
            >
              Hoje
            </button>
          )}
        </div>
      </div>

      {!plan ? (
        showCreate && permissions.canPlan ? (
          <CreatePlanForm
            period={period}
            clientName={clientName}
            busy={busy}
            onCancel={() => setShowCreate(false)}
            onSubmit={async (body) => {
              const ok = await runOperation(() => deliverablesOperations.createPlan(clientId, body), 'Plano do mês criado.');
              if (ok) setShowCreate(false);
            }}
          />
        ) : (
          <>
            <EmptyState
              title={`Nenhum plano de entregas em ${formatDeliverablePeriod(period)}`}
              description="Não há plano cadastrado para este cliente neste mês, então não há metas nem entregas a exibir. Use as setas para consultar outros meses."
            />
            {permissions.canPlan && (
              <div className="flex justify-center">
                <button
                  type="button"
                  className={operationButtonClasses.primaryButton}
                  onClick={() => setShowCreate(true)}
                >
                  <Plus size={13} /> Criar plano do mês
                </button>
              </div>
            )}
          </>
        )
      ) : (
        <>
      {/* 2. AVISO DE PLANO FECHADO (QUANDO APLICÁVEL) */}
      {planStatusMeta.isClosed && (
        <div className={styles.closedBanner}>
          <Lock size={16} className="shrink-0 text-blue-400" />
          <span>
            <strong>Mês fechado:</strong> este plano está consolidado. Para registrar ou
            corrigir algo, a gestão precisa reabrir o mês com justificativa.
          </span>
        </div>
      )}

      {/* 3. CARDS DE INDICADORES / MÉTRICAS CONSOLIDADAS */}
      <div className={styles.metricsGrid}>
        {/* Meta Contratada */}
        <div className={styles.metricCard}>
          <div className={styles.metricCardHeader}>
            <span className={styles.metricLabel}>Meta Contratada</span>
            <CalendarIcon size={14} className="text-muted-foreground" />
          </div>
          <div className={styles.metricValueRow}>
            <span className={styles.metricValue}>{metrics.contractedTarget}</span>
            <span className={styles.metricSubtitle}>itens no contrato</span>
          </div>
        </div>

        {/* Entregues do Contrato */}
        <div className={styles.metricCard}>
          <div className={styles.metricCardHeader}>
            <span className={styles.metricLabel}>Entregas do Contrato</span>
            <CheckCircle2 size={14} className="text-emerald-400" />
          </div>
          <div className={styles.metricValueRow}>
            <span className={styles.metricValue}>{metrics.contractedDelivered}</span>
            <span className={styles.metricSubtitle}>de {metrics.contractedTarget}</span>
          </div>
        </div>

        {/* Pendências do Contrato */}
        <div className={styles.metricCard}>
          <div className={styles.metricCardHeader}>
            <span className={styles.metricLabel}>Pendências Contratuais</span>
            <Clock size={14} className="text-amber-400" />
          </div>
          <div className={styles.metricValueRow}>
            <span
              className={`${styles.metricValue} ${
                metrics.contractedPending > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {metrics.contractedPending}
            </span>
            <span className={styles.metricSubtitle}>restantes</span>
          </div>
        </div>

        {/* Entregas Extras (Segregadas) */}
        <div className={`${styles.metricCard} ${styles.metricCardExtras}`}>
          <div className={styles.metricCardHeader}>
            <span className={`${styles.metricLabel} text-violet-300 font-semibold`}>
              Entregas Extras (+)
            </span>
            <Sparkles size={14} className="text-violet-400" />
          </div>
          <div className={styles.metricValueRow}>
            <span className={`${styles.metricValue} text-violet-300`}>
              +{metrics.extraDelivered}
            </span>
            <span className="text-[11px] text-violet-300/80">além do contrato</span>
          </div>
          <div className="text-[10px] text-violet-400/80 mt-1">
            Segregado: não compensa déficit
          </div>
        </div>

        {/* Progresso Contratado */}
        <div className={styles.metricCard}>
          <div className={styles.metricCardHeader}>
            <span className={styles.metricLabel}>Progresso do Contrato</span>
            <span className="text-xs font-semibold text-emerald-400">
              {metrics.contractedProgressPercent}%
            </span>
          </div>
          <div className={styles.progressBarContainer}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${metrics.contractedProgressPercent}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground mt-1">
            {metrics.isFullyDelivered
              ? 'Meta contratada 100% atingida'
              : `${metrics.contractedPending} entrega(s) para fechar o ciclo`}
          </span>
        </div>
      </div>

      {/* Nota de Integridade e Regra de Produto */}
      <div className={styles.integrityNotice}>
        <ShieldAlert size={14} className="text-emerald-400 shrink-0" />
        <span>
          <strong>Regra Canônica Zafira:</strong> Metas contratuais são governadas pelo
          Hub. Tarefas do Asana atuam exclusivamente como evidências operacionais de
          consulta (leitura). Entregas extras nunca compensam pendências contratuais.
        </span>
      </div>

      {/* 4. FILTROS E PESQUISA DOS ITENS */}
      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Search size={14} className="text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Buscar por serviço ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filterButtons}>
          <button
            type="button"
            onClick={() => setOnlyExtras(!onlyExtras)}
            className={`${styles.filterToggle} ${
              onlyExtras ? styles.filterToggleActive : ''
            }`}
          >
            {onlyExtras ? 'Mostrando Apenas Extras' : 'Ver Apenas Itens Extras'}
          </button>
        </div>
      </div>

      {/* 5. LISTA DE ITENS DE ENTREGA */}
      {filteredItems.length === 0 ? (
        <EmptyState
          title={
            rawItems.length === 0
              ? 'Plano sem itens cadastrados'
              : 'Nenhum item corresponde ao filtro'
          }
          description={
            rawItems.length === 0
              ? `O plano de ${formatDeliverablePeriod(period)} ainda não tem itens de entrega.`
              : 'Tente limpar a busca ou remover o filtro de itens extras.'
          }
        />
      ) : (
        <div className={styles.itemsList}>
          {filteredItems.map((item) => {
            const itemStatus = getItemStatusMeta(item.status);
            const linkCount = item.links?.length || 0;

            return (
              <div
                key={item.id}
                className={`${styles.itemCard} ${
                  item.isExtra ? styles.itemCardExtra : ''
                }`}
                data-testid={`deliverable-item-${item.id}`}
              >
                <div className={styles.itemCardContent}>
                  <div className={styles.itemMainInfo}>
                    <div className={styles.itemTitleRow}>
                      <span className={styles.itemTitle}>{item.title}</span>
                      {item.isExtra && (
                        <span className={styles.extraBadge}>Demanda Extra</span>
                      )}
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${itemStatus.badgeClass}`}
                      >
                        {itemStatus.label}
                      </span>
                    </div>

                    <div className={styles.itemServiceType}>
                      <FileText size={12} />
                      <span>{formatDeliverableServiceType(item.serviceType)}</span>
                      {item.description && (
                        <>
                          <span className="text-white/20">•</span>
                          <span className="truncate max-w-md">{item.description}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={styles.itemQuantities}>
                    <div className={styles.quantityBlock}>
                      <span className={styles.quantityLabel}>
                        {item.isExtra ? 'Previsto' : 'Meta'}
                      </span>
                      <span className={styles.quantityValue}>
                        {item.targetQuantity}
                      </span>
                    </div>

                    <div className={styles.quantityBlock}>
                      <span className={styles.quantityLabel}>Entregue</span>
                      <span
                        className={`${styles.quantityValue} ${
                          item.deliveredQuantity >= item.targetQuantity
                            ? 'text-emerald-400'
                            : 'text-white'
                        }`}
                      >
                        {item.deliveredQuantity}
                      </span>
                    </div>

                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(item.id)}
                        className={styles.evidenceButton}
                        aria-expanded={expandedItems.has(item.id)}
                        title="Ver e registrar peças desta linha"
                      >
                        <ListChecks size={13} />
                        <span>
                          Peças ({item.pieces?.filter((p) => p.stage !== 'CANCELLED').length || 0})
                        </span>
                      </button>
                      {canEdit && permissions.canAdjust && (
                        <button
                          type="button"
                          onClick={() => setAdjustingItemId(adjustingItemId === item.id ? null : item.id)}
                          className={styles.evidenceButton}
                          title="Ajustar a meta desta linha (com justificativa)"
                        >
                          <Target size={13} />
                          <span>Ajustar meta</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedItemForEvidence(item)}
                        className={styles.evidenceButton}
                        title="Ver evidências vinculadas"
                      >
                        <ExternalLink size={13} />
                        <span>Evidências ({linkCount})</span>
                      </button>
                    </div>
                  </div>
                </div>
                {adjustingItemId === item.id && canEdit && permissions.canAdjust && (
                  <AdjustTargetForm
                    item={item}
                    busy={busy}
                    onCancel={() => setAdjustingItemId(null)}
                    onSubmit={async (newTargetQuantity, reason) => {
                      const ok = await runOperation(
                        () =>
                          deliverablesOperations.adjustTarget(clientId, plan.id, item.id, {
                            newTargetQuantity,
                            reason,
                          }),
                        'Meta ajustada.'
                      );
                      if (ok) setAdjustingItemId(null);
                    }}
                  />
                )}
                {expandedItems.has(item.id) && (
                  <PiecesPanel
                    item={item}
                    editable={canEdit && permissions.canRegister}
                    busy={busy}
                    handlers={{
                      onAdd: async (target, body) => {
                        await runOperation(
                          () =>
                            deliverablesOperations.addPiece(clientId, plan.id, target.id, {
                              title: body.title,
                              ...(body.format ? { format: body.format as DeliverableContentFormat } : {}),
                            }),
                          'Peça registrada como produzida.'
                        );
                      },
                      onAdvance: async (piece) => {
                        await runOperation(
                          () =>
                            deliverablesOperations.advancePiece(clientId, plan.id, piece.id, {
                              expectedStage: piece.stage,
                            }),
                          'Etapa atualizada.'
                        );
                      },
                      onRevert: (piece) =>
                        setReasonRequest({
                          title: `Voltar etapa: ${piece.title}`,
                          description:
                            'Use para corrigir um registro feito por engano. Se a peça estava postada, ela deixa de contar.',
                          confirmLabel: 'Voltar etapa',
                          onConfirm: async (reason) => {
                            const ok = await runOperation(
                              () =>
                                deliverablesOperations.revertPiece(clientId, plan.id, piece.id, {
                                  reason,
                                  expectedStage: piece.stage,
                                }),
                              'Etapa desfeita.'
                            );
                            if (ok) setReasonRequest(null);
                          },
                        }),
                      onCancel: (piece) =>
                        setReasonRequest({
                          title: `Cancelar peça: ${piece.title}`,
                          description: 'A peça deixa de contar para a meta. O registro continua no histórico.',
                          confirmLabel: 'Cancelar peça',
                          onConfirm: async (reason) => {
                            const ok = await runOperation(
                              () =>
                                deliverablesOperations.cancelPiece(clientId, plan.id, piece.id, {
                                  reason,
                                  expectedStage: piece.stage,
                                }),
                              'Peça cancelada.'
                            );
                            if (ok) setReasonRequest(null);
                          },
                        }),
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {canEdit && permissions.canPlan &&
        (showAddItem ? (
          <AddItemForm
            busy={busy}
            onCancel={() => setShowAddItem(false)}
            onSubmit={async (body) => {
              const ok = await runOperation(
                () => deliverablesOperations.addItem(clientId, plan.id, body),
                'Linha adicionada ao plano.'
              );
              if (ok) setShowAddItem(false);
            }}
          />
        ) : (
          <div>
            <button
              type="button"
              className={operationButtonClasses.ghostButton}
              onClick={() => setShowAddItem(true)}
            >
              <Plus size={13} /> Adicionar linha ao plano
            </button>
          </div>
        ))}

      {/* 6. HISTÓRICO DE AUDITORIA E EVENTOS (COLAPSÁVEL) */}
      <div className={styles.auditSection}>
        <div
          className={styles.auditHeader}
          onClick={() => setShowAudit(!showAudit)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowAudit(!showAudit);
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={showAudit}
        >
          <span className={styles.auditTitle}>
            <History size={15} />
            Histórico Auditável e Justificativas de Metas ({plan?.events?.length || 0})
          </span>
          <span className="text-xs text-muted-foreground hover:text-white">
            {showAudit ? 'Ocultar' : 'Expandir histórico'}
          </span>
        </div>

        {showAudit && (
          <div className={styles.auditTimeline}>
            {(!plan?.events || plan.events.length === 0) ? (
              <span className="text-xs text-muted-foreground py-2">
                Nenhum evento registrado até o momento.
              </span>
            ) : (
              plan.events.map((ev) => {
                const desc = formatDeliverableEventDescription(ev);
                return (
                  <div key={ev.id} className={styles.auditEventItem}>
                    <span className={styles.auditEventTitle}>{desc.title}</span>
                    {desc.details && (
                      <span className={styles.auditEventDetails}>{desc.details}</span>
                    )}
                    <span className={styles.auditEventDate}>
                      {new Date(ev.createdAt).toLocaleString('pt-BR')} •{' '}
                      {ev.actorName || (ev.actorUserId ? 'Usuário removido' : 'Sistema')}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 7. MODAL / DRAWER DE EVIDÊNCIAS VINCULADAS */}
      {selectedItemForEvidence && (
        <div
          className={styles.modalOverlay}
          onClick={() => setSelectedItemForEvidence(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className="flex flex-col gap-0.5">
                <span className={styles.modalTitle}>Evidências e Vínculos</span>
                <span className="text-xs text-muted-foreground">
                  {selectedItemForEvidence.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForEvidence(null)}
                className={styles.modalCloseButton}
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {(!selectedItemForEvidence.links ||
                selectedItemForEvidence.links.length === 0) ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  Nenhuma evidência vinculada a esta entrega ainda.
                </div>
              ) : (
                selectedItemForEvidence.links.map((link) => {
                  const safeUrl = getSafeEvidenceUrl(link);
                  const isAsana = link.linkType === 'ASANA_TASK';

                  return (
                    <div key={link.id} className={styles.evidenceLinkCard}>
                      <div className={styles.evidenceLinkHeader}>
                        <span className={styles.evidenceLinkTitle}>
                          {link.title || 'Vínculo de Evidência'}
                        </span>
                        {isAsana && (
                          <span className={styles.asanaSafeBadge}>
                            <CheckCircle2 size={12} />
                            Asana (Somente Leitura)
                          </span>
                        )}
                      </div>

                      {link.externalId && (
                        <span className="text-[11px] text-muted-foreground">
                          Identificador Externo: {link.externalId}
                        </span>
                      )}

                      {safeUrl ? (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.openAsanaButton}
                        >
                          <ExternalLink size={13} />
                          <span>
                            {isAsana
                              ? 'Abrir Tarefa no Asana (Nova Aba)'
                              : 'Abrir Evidência Externa'}
                          </span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-amber-400">
                          URL indisponível ou protocolo não autorizado
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {reasonRequest && (
        <ReasonDialog request={reasonRequest} busy={busy} onCancel={() => setReasonRequest(null)} />
      )}
    </div>
  );
}
