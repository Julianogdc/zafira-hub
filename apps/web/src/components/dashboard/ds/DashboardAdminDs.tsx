import React, { useState } from 'react';
import { Users, DollarSign, AlertTriangle, Briefcase } from 'lucide-react';
import { DashboardPeriod } from '@zafira/contracts';
import { useAdminDashboardSummary } from '@/hooks/useAdminDashboardSummary';
import { ApiError } from '@/lib/api';
import { LoadingState, ErrorState, PermissionState, EmptyState } from '@/components/ui/ds/States';
import { DashboardHeader } from './DashboardHeader';
import {
  DashKpiCard,
  DashboardSectionCard,
  CarteiraBars,
  FinancialSummary,
} from './DashboardWidgets';
import styles from './dashboard-widgets.module.css';

function formatCurrency(val: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(val);
}

function formatFreshness(isoString?: string): string | undefined {
  if (!isoString) return undefined;
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return undefined;
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `Atualizado às ${hours}:${minutes}`;
  } catch {
    return undefined;
  }
}

export function DashboardAdminDs() {
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const [selectedClientId, setSelectedClientId] = useState<string>('all');

  const { data, isLoading, isError, error, isFetching, refetch } = useAdminDashboardSummary({
    period,
    clientId: selectedClientId,
  });

  const periodLabels: Record<DashboardPeriod, string> = {
    '7d': 'Últimos 7 dias',
    '30d': 'Últimos 30 dias',
    '90d': 'Últimos 90 dias',
  };

  const clientDropdownOptions = [
    { value: 'all', label: 'Todos os clientes' },
    ...(data?.clientOptions?.map((c) => ({
      value: c.id,
      label: c.name,
    })) || []),
  ];

  const freshnessLabel = formatFreshness(data?.meta?.generatedAt);

  // Tratamento de estados no primeiro carregamento sem dados
  if (isLoading && !data) {
    return (
      <div className={styles.pageContainer}>
        <DashboardHeader
          period={period}
          onPeriodChange={setPeriod}
          clientOptions={clientDropdownOptions}
          selectedClientId={selectedClientId}
          onClientChange={setSelectedClientId}
          refreshing={true}
        />
        <LoadingState message="Carregando visão geral..." fullHeight />
      </div>
    );
  }

  if (isError && !data) {
    const isPermissionError = error instanceof ApiError && error.status === 403;

    return (
      <div className={styles.pageContainer}>
        <DashboardHeader
          period={period}
          onPeriodChange={setPeriod}
          clientOptions={clientDropdownOptions}
          selectedClientId={selectedClientId}
          onClientChange={setSelectedClientId}
          onRefresh={() => refetch()}
        />
        {isPermissionError ? (
          <PermissionState
            title="Acesso não autorizado"
            description="Você não possui permissão para visualizar os indicadores do Dashboard Administrativo."
            fullHeight
          />
        ) : (
          <ErrorState
            title="Não foi possível carregar o dashboard"
            description="Ocorreu um erro ao carregar os indicadores."
            onRetry={() => refetch()}
            fullHeight
          />
        )}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // Resolução de KPIs reais com rigor de tipagem e fail-closed
  // 1. Clientes Ativos
  const activeClientsValue = data.activeClients.count;

  // 2. MRR da Carteira (Fail-closed se available=false; null != zero preservado)
  let mrrValue: string = '—';
  let mrrContext: string = 'base contratual ativa';
  if (data.mrr.available) {
    if (data.mrr.knownValue !== null) {
      mrrValue = formatCurrency(data.mrr.knownValue);
    }
    if (!data.mrr.isComplete && data.mrr.missingContractValueCount > 0) {
      mrrContext = `${data.mrr.missingContractValueCount} cliente(s) sem valor contratual`;
    }
  } else {
    mrrValue = '—';
    mrrContext = 'Sem permissão financeira';
  }

  // 3. Recebíveis Vencidos (Fail-closed se available=false; null != zero preservado)
  let overdueValue: string = '—';
  let overdueContext: string = 'Cobranças vencidas';
  if (data.financial.available) {
    if (data.financial.overdue !== null) {
      overdueValue = formatCurrency(data.financial.overdue);
    }
    overdueContext = `${data.financial.overdueCount ?? 0} cobrança(s)`;
  } else {
    overdueValue = '—';
    overdueContext = 'Sem permissão financeira';
  }

  // 4. Total da Carteira
  const totalClientsValue = data.clientsByStatus.total;

  return (
    <div className={styles.pageContainer}>
      <DashboardHeader
        title="Visão geral"
        subtitle="Acompanhe a situação da agência, prioridades e principais indicadores."
        freshnessLabel={freshnessLabel}
        period={period}
        onPeriodChange={setPeriod}
        clientOptions={clientDropdownOptions}
        selectedClientId={selectedClientId}
        onClientChange={setSelectedClientId}
        refreshing={isFetching}
        onRefresh={() => refetch()}
      />

      {/* Grid com 4 KPIs REAIS */}
      <section className={styles.kpiGrid} aria-label="Indicadores principais">
        <DashKpiCard
          title="Clientes ativos"
          value={activeClientsValue}
          context="cadastrados no Hub"
          icon={<Users size={16} />}
          href="/clientes"
          aria-label={`Clientes ativos: ${activeClientsValue}`}
        />

        <DashKpiCard
          title="MRR da carteira"
          value={mrrValue}
          context={mrrContext}
          icon={<DollarSign size={16} />}
          aria-label={`MRR da carteira: ${mrrValue}. ${mrrContext}`}
        />

        <DashKpiCard
          title="Recebíveis vencidos"
          value={overdueValue}
          context={overdueContext}
          icon={<AlertTriangle size={16} />}
          href="/financas"
          aria-label={`Recebíveis vencidos: ${overdueValue}. ${overdueContext}`}
        />

        <DashKpiCard
          title="Total da carteira"
          value={totalClientsValue}
          context="distribuição cadastrada no Hub"
          icon={<Briefcase size={16} />}
          href="/clientes"
          aria-label={`Total da carteira: ${totalClientsValue}`}
        />
      </section>

      {/* Grid Principal com seções suportadas hoje */}
      <section className={styles.mainGrid}>
        {/* Seção Carteira de Clientes */}
        <DashboardSectionCard
          title="Carteira de clientes"
          subtitle="Distribuição por status cadastral"
          actionLabel="Ver todos"
          actionHref="/clientes"
        >
          {data.clientsByStatus.total === 0 ? (
            <EmptyState
              compact
              title="Nenhum cliente cadastrado"
              description="Os indicadores de carteira aparecerão quando houver clientes disponíveis."
            />
          ) : (
            <CarteiraBars
              items={[
                { label: 'Ativos', value: data.clientsByStatus.active, variant: 'success' },
                { label: 'Pausados', value: data.clientsByStatus.paused, variant: 'warning' },
                { label: 'Leads', value: data.clientsByStatus.lead, variant: 'primary' },
                { label: 'Inativos', value: data.clientsByStatus.inactive, variant: 'muted' },
              ]}
              total={data.clientsByStatus.total}
            />
          )}
        </DashboardSectionCard>

        {/* Seção Resumo Financeiro */}
        <DashboardSectionCard
          title="Resumo financeiro"
          subtitle={periodLabels[period]}
          actionLabel="Ver detalhes"
          actionHref="/financas"
        >
          {data.financial.available ? (
            <FinancialSummary
              received={data.financial.receivedInPeriod}
              pending={data.financial.pending}
              overdue={data.financial.overdue}
              overdueCount={data.financial.overdueCount}
              formatCurrency={formatCurrency}
            />
          ) : (
            <PermissionState
              compact
              title="Acesso restrito"
              description="Você não possui permissão para visualizar o resumo financeiro."
            />
          )}
        </DashboardSectionCard>
      </section>
    </div>
  );
}
