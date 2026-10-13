import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw, AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { toast } from 'sonner';
import { asanaHistoryService } from '@/services/asanaHistory';
import { capabilitiesService } from '@/services/capabilities';
import {
  AsanaHistoryProject,
  AsanaHistoryResponse,
  chartPoints,
  describeAsanaChange,
  describeFreshness,
  formatDayMonth,
  periodStartFor,
} from '@/lib/asana-history-view';
import { ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { useAuthStore } from '@/store/useAuthStore';
import { currentPeriodInTimeZone, isoDateToCalendarDate, todayInTimeZone } from '@/lib/organization-time';

/**
 * F6-IMP.8 — Evolução no Asana (DEC-F6-003): frescor, fotos diárias e mudanças guardadas no Hub.
 * Somente leitura do Asana. Dia sem foto não vira zero.
 */

const DAYS = 30;

function MiniChart({ project, timeZone }: { project: AsanaHistoryProject; timeZone?: string }) {
  const start = periodStartFor(DAYS, isoDateToCalendarDate(todayInTimeZone(timeZone)));
  const pending = chartPoints(project.snapshots, 'pendingTasks', start, DAYS);
  const overdue = chartPoints(project.snapshots, 'overdueTasks', start, DAYS);
  const max = Math.max(1, ...pending.map((p) => p.y), ...overdue.map((p) => p.y));
  const W = 320;
  const H = 70;
  const toXY = (p: { x: number; y: number }) => `${(p.x * (W - 8) + 4).toFixed(1)},${(H - 6 - (p.y / max) * (H - 14)).toFixed(1)}`;
  const line = (points: typeof pending) => points.map(toXY).join(' ');
  const last = project.snapshots[project.snapshots.length - 1];

  if (project.snapshots.length === 0) {
    return <span className="text-[11px] text-muted-foreground">Sem fotos diárias no período.</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Evolução de ${project.name}: pendentes e atrasadas nos últimos ${DAYS} dias`}
        className="rounded-md bg-white/[0.02] border border-white/5"
      >
        {pending.length > 1 && <polyline points={line(pending)} fill="none" stroke="#a78bfa" strokeWidth="2" />}
        {overdue.length > 1 && <polyline points={line(overdue)} fill="none" stroke="#f87171" strokeWidth="2" />}
        {pending.map((p) => <circle key={`p-${p.date}`} cx={toXY(p).split(',')[0]} cy={toXY(p).split(',')[1]} r="2" fill="#a78bfa" />)}
        {overdue.map((p) => <circle key={`o-${p.date}`} cx={toXY(p).split(',')[0]} cy={toXY(p).split(',')[1]} r="2" fill="#f87171" />)}
      </svg>
      <div className="flex flex-col gap-0.5 text-[11px]">
        <span className="text-violet-300">● Pendentes: {last.pendingTasks}</span>
        <span className="text-red-300">● Atrasadas: {last.overdueTasks}</span>
        <span className="text-muted-foreground">
          {last.completedTasks} concluídas de {last.totalTasks} · foto de {formatDayMonth(last.date)}
        </span>
        <span className="text-muted-foreground">{project.snapshots.length} dia(s) com foto em {DAYS}</span>
      </div>
    </div>
  );
}

export function AsanaHistoryPanel({ clientId }: { clientId: string }) {
  const [history, setHistory] = useState<AsanaHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [canSync, setCanSync] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const orgTimeZone = useAuthStore((state) => state.currentOrganization?.timezone);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await asanaHistoryService.getClientHistory(clientId, DAYS));
    } catch (err: unknown) {
      const status = (err as { status?: number } | null)?.status;
      setError({
        status,
        message:
          status === 403
            ? 'Sem permissão para consultar projetos (projects.view).'
            : 'Não foi possível carregar o histórico do Asana guardado no Hub.',
      });
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    capabilitiesService
      .getEffectiveCapabilities()
      .then((res) => active && setCanSync((res?.permissions as Record<string, boolean> | undefined)?.['projects.sync'] === true))
      .catch(() => active && setCanSync(false));
    return () => {
      active = false;
    };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await asanaHistoryService.refreshClientHistory(clientId);
      if (result.history) setHistory(result.history);
      if (result.status === 'SUCCESS') toast.success('Asana conferido agora.');
      else toast.error('A conferência falhou em um ou mais projetos. Os dados anteriores foram mantidos.');
    } catch (err: unknown) {
      toast.error((err as { message?: string } | null)?.message || 'Não foi possível conferir o Asana agora.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="mt-8 flex flex-col gap-3" aria-label="Evolução no Asana">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <History size={16} /> Evolução no Asana (últimos {DAYS} dias)
        </h2>
        {canSync && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white hover:bg-white/[0.07] disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Conferindo…' : 'Atualizar agora'}
          </button>
        )}
      </div>

      {loading ? (
        <LoadingState message="Carregando histórico guardado no Hub..." fullHeight={false} />
      ) : error?.status === 403 ? (
        <PermissionState title="Histórico restrito" description={error.message} />
      ) : error ? (
        <ErrorState title="Erro ao carregar o histórico" description={error.message} onRetry={load} />
      ) : !history || history.projects.length === 0 ? (
        <span className="text-xs text-muted-foreground">Nenhum projeto do Asana vinculado a este cliente.</span>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {history.projects.map((project) => {
              const fresh = describeFreshness(project);
              const Icon = fresh.tone === 'ok' ? CheckCircle2 : fresh.tone === 'error' ? AlertTriangle : CircleDashed;
              const color = fresh.tone === 'ok' ? 'text-emerald-400' : fresh.tone === 'error' ? 'text-amber-400' : 'text-muted-foreground';
              return (
                <div key={project.projectGid} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-white font-medium">{project.name}</span>
                    <span className={`flex items-center gap-1 text-[11px] ${color}`}>
                      <Icon size={12} /> {fresh.label}
                    </span>
                  </div>
                  {fresh.detail && <span className="text-[11px] text-muted-foreground">{fresh.detail}</span>}
                  <MiniChart project={project} timeZone={orgTimeZone} />
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-white">Mudanças recentes nas tarefas</span>
            {history.changes.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">
                Nenhuma mudança registrada ainda. As mudanças passam a ser registradas a partir da primeira conferência.
              </span>
            ) : (
              <ul className="flex flex-col gap-1">
                {history.changes.slice(0, 20).map((change) => (
                  <li key={change.id} className="text-[11px] flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground">
                      {new Date(change.detectedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-white">{change.taskName}</span>
                    <span className="text-violet-200/90">{describeAsanaChange(change)}</span>
                  </li>
                ))}
              </ul>
            )}
            <span className="text-[10px] text-muted-foreground">
              Atualizado pelos avisos do Asana (em segundos) e por uma conferência de segurança toda noite. Guardado por 13 meses.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
