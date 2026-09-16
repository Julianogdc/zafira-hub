import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  RefreshCw,
  Search,
  ExternalLink,
  QrCode,
  CreditCard,
  FileText,
  ShieldAlert,
  Info,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CalendarDays,
  DollarSign,
  UserPlus,
  Users,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CaixaMovimentacoes } from '@/components/financial/CaixaMovimentacoes';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/store/useAuthStore';
import {
  asaasService,
  FinancialOverviewResponse,
  FinancialOverviewPaymentItem,
  AsaasPaymentStatus,
  AsaasWalletSyncResult,
} from '@/services/asaas';
import { clientsService, HubClient } from '@/services/clients';
import { toast } from 'sonner';

export default function Financas() {
  const { role } = useAuthStore();
  const isAuthorized = role === 'admin' || role === 'manager';

  // Estados de Filtros
  const [period, setPeriod] = useState<string>('current-month');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Estados de Dados
  const [overview, setOverview] = useState<FinancialOverviewResponse | null>(null);
  const [clients, setClients] = useState<HubClient[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Estados de Sincronização da Carteira Asaas
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState<boolean>(false);
  const [syncingWallet, setSyncingWallet] = useState<boolean>(false);
  const [walletResult, setWalletResult] = useState<AsaasWalletSyncResult | null>(null);

  // Carrega lista de clientes para o filtro
  const reloadClients = useCallback(() => {
    if (!isAuthorized) return;
    clientsService.listClients()
      .then((res) => {
        setClients(res.data || []);
      })
      .catch((err) => {
        console.error('Erro ao carregar clientes para o filtro de finanças:', err);
      });
  }, [isAuthorized]);

  useEffect(() => {
    reloadClients();
  }, [reloadClients]);

  // Consulta consolidada do Financeiro
  const fetchOverview = useCallback(async (isRefresh = false) => {
    if (!isAuthorized) return;
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const res = await asaasService.getFinancialOverview({
        period,
        startDate: period === 'custom' ? startDate : undefined,
        endDate: period === 'custom' ? endDate : undefined,
        clientId: selectedClientId !== 'ALL' ? selectedClientId : undefined,
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        search: searchQuery.trim() || undefined,
        page: currentPage,
        limit: 15,
      });

      setOverview(res);
      if (isRefresh) {
        toast.success('Visão financeira atualizada com sucesso.');
      }
    } catch (err: any) {
      console.error('Erro ao buscar visão financeira do Asaas:', err);
      toast.error(err?.data?.message || err?.message || 'Falha ao carregar dados financeiros.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAuthorized, period, startDate, endDate, selectedClientId, selectedStatus, searchQuery, currentPage]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Executa sincronização da carteira completa
  const handleExecuteWalletSync = async () => {
    try {
      setSyncingWallet(true);
      const result = await asaasService.syncAllWallet();
      setWalletResult(result);
      setConfirmModalOpen(false);
      setSummaryModalOpen(true);

      // Recarrega dados atualizados
      await fetchOverview(false);
      reloadClients();
    } catch (err: any) {
      console.error('Erro ao sincronizar carteira completa do Asaas:', err);
      toast.error(err?.data?.message || err?.message || 'Falha ao sincronizar carteira do Asaas.');
      setConfirmModalOpen(false);
    } finally {
      setSyncingWallet(false);
    }
  };

  // Formatação de valores
  const formatBRL = (value?: number | null) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value || 0);
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '-';
    // 1. Prioriza extração direta de data de calendário civil (YYYY-MM-DD), imune a fusos horários
    const match = String(isoString).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return `${day}/${month}/${year}`;
    }
    // 2. Fallback resiliente usando UTC para evitar recuo de 1 dia no Brasil (UTC-3)
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '-';
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return '-';
    }
  };

  const getStatusBadge = (status: AsaasPaymentStatus, statusLabel: string, isOverdue?: boolean) => {
    if (isOverdue) {
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] gap-1">
          <AlertTriangle className="w-3 h-3" />
          Vencido
        </Badge>
      );
    }

    switch (status) {
      case 'RECEIVED':
      case 'CONFIRMED':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {statusLabel || 'Pago'}
          </Badge>
        );
      case 'OVERDUE':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] gap-1">
            <AlertTriangle className="w-3 h-3" />
            {statusLabel || 'Vencido'}
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] gap-1">
            <Clock className="w-3 h-3" />
            {statusLabel || 'Pendente'}
          </Badge>
        );
      case 'REFUNDED':
        return (
          <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[11px]">
            {statusLabel || 'Estornado'}
          </Badge>
        );
      case 'DELETED':
      case 'CANCELLED':
      default:
        return (
          <Badge variant="outline" className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[11px]">
            {statusLabel || 'Cancelado'}
          </Badge>
        );
    }
  };

  const getBillingTypeIcon = (type?: string) => {
    const t = String(type || '').toUpperCase();
    if (t.includes('PIX')) {
      return (
        <span className="flex items-center gap-1 text-[11px] text-zinc-300 font-mono">
          <QrCode className="w-3.5 h-3.5 text-emerald-400" /> PIX
        </span>
      );
    }
    if (t.includes('CREDIT_CARD') || t.includes('CARD')) {
      return (
        <span className="flex items-center gap-1 text-[11px] text-zinc-300 font-mono">
          <CreditCard className="w-3.5 h-3.5 text-blue-400" /> Cartão
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[11px] text-zinc-300 font-mono">
        <FileText className="w-3.5 h-3.5 text-amber-400" /> Boleto
      </span>
    );
  };

  // Bloqueio de Acesso RBAC para MEMBER
  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-white">Acesso Restrito</h2>
          <p className="text-sm text-zinc-400 max-w-md">
            A visão financeira consolidada é restrita aos administradores e gestores da Zafira.
          </p>
        </div>
      </div>
    );
  }

  const kpis = overview?.kpis || {
    receivedMonth: 0,
    receivedMonthCount: 0,
    pending: 0,
    pendingCount: 0,
    overdue: 0,
    overdueCount: 0,
    nextDueDate: null,
    statusCounts: { pending: 0, received: 0, overdue: 0, refunded: 0, cancelled: 0 },
  };

  const payments = overview?.payments || [];
  const pagination = overview?.pagination || { page: 1, limit: 15, total: 0, totalPages: 1 };
  const recebidosData = overview?.recebidosTimeSeries || [];
  const previstosData = overview?.previstosTimeSeries || [];

  const getReceivedCardTitle = () => {
    switch (period) {
      case 'last-month':
        return 'Recebido (Mês Anterior)';
      case 'current-year':
        return 'Recebido no Ano';
      case 'all':
        return 'Total Recebido';
      case 'custom':
        return 'Recebido no Período';
      case 'current-month':
      default:
        return 'Recebido no Mês';
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. HEADER COM AÇÕES */}
      <PageHeader
        title="Finanças"
        description="Gestão e visão financeira consolidada com dados reais do Asaas."
        icon={Wallet}
      >
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmModalOpen(true)}
            disabled={loading || syncingWallet}
            className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-xs gap-1.5 h-9"
          >
            <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sincronizar carteira Asaas</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOverview(true)}
            disabled={loading || refreshing || syncingWallet}
            className="border-white/10 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800 text-xs gap-1.5 h-9"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Atualizando...' : 'Atualizar visão'}</span>
          </Button>
        </div>
      </PageHeader>

      {/* SELEÇÃO DE ABAS: COBRANÇAS VS CAIXA E MOVIMENTAÇÕES */}
      <Tabs defaultValue="cobrancas" className="w-full space-y-6">
        <TabsList className="bg-zinc-950/80 border border-white/10 p-1 h-10 w-full sm:w-auto justify-start">
          <TabsTrigger
            value="cobrancas"
            className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-4"
          >
            Cobranças (Asaas)
          </TabsTrigger>
          <TabsTrigger
            value="caixa"
            className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white data-[state=active]:shadow-sm px-4"
          >
            Caixa e Movimentações (Asaas + Inter PJ)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cobrancas" className="space-y-6 mt-0">
          {/* 2. AVISO DISCRETO DE SINCRONIZAÇÃO */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-zinc-900/60 border border-white/5 text-xs text-zinc-400">
            <Info className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              {overview?.disclaimer ||
                'Os dados são atualizados pela sincronização por cliente e pelos eventos do Asaas.'}
            </span>
          </div>

      {/* 3. BARRA DE FILTROS */}
      <Card className="bg-zinc-950/40 border-white/10 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Filtro de Período */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">Período</label>
            <Select
              value={period}
              onValueChange={(val) => {
                setPeriod(val);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                <SelectItem value="current-month">Mês Atual</SelectItem>
                <SelectItem value="last-month">Mês Anterior</SelectItem>
                <SelectItem value="current-year">Ano Atual</SelectItem>
                <SelectItem value="all">Todos os Períodos</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro de Cliente */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">Cliente</label>
            <Select
              value={selectedClientId}
              onValueChange={(val) => {
                setSelectedClientId(val);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200">
                <SelectValue placeholder="Todos os clientes" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200 max-h-56">
                <SelectItem value="ALL">Todos os clientes</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Filtro de Status */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">Status da Cobrança</label>
            <Select
              value={selectedStatus}
              onValueChange={(val) => {
                setSelectedStatus(val);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                <SelectItem value="ALL">Todos os status</SelectItem>
                <SelectItem value="RECEIVED">Pago / Liquidado</SelectItem>
                <SelectItem value="PENDING">Em Aberto / Previsto</SelectItem>
                <SelectItem value="OVERDUE">Vencido / Inadimplente</SelectItem>
                <SelectItem value="REFUNDED">Estornado</SelectItem>
                <SelectItem value="CANCELLED">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Busca Textual */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">Buscar</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-zinc-500" />
              <Input
                type="text"
                placeholder="Cliente ou descrição..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-8 h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          </div>
        </div>

        {/* Datas Customizadas quando período for 'custom' */}
        {period === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-white/5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">Data Inicial</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">Data Final</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200"
              />
            </div>
          </div>
        )}
      </Card>

      {/* 4. CARDS DE KPI (4 COLUNAS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Recebido no Mês */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">{getReceivedCardTitle()}</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">{formatBRL(kpis.receivedMonth)}</div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {kpis.receivedMonthCount} {kpis.receivedMonthCount === 1 ? 'cobrança liquidada' : 'cobranças liquidadas'}
            </p>
          </CardContent>
        </Card>

        {/* Em Aberto */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Em Aberto / Previsto</CardTitle>
            <Clock className="w-4 h-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">{formatBRL(kpis.pending)}</div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {kpis.pendingCount} {kpis.pendingCount === 1 ? 'cobrança prevista' : 'cobranças previstas'}
            </p>
          </CardContent>
        </Card>

        {/* Vencido / Inadimplente */}
        <Card className={`bg-zinc-950/40 ${kpis.overdue > 0 ? 'border-red-500/30' : 'border-white/10'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Vencido / Inadimplente</CardTitle>
            <AlertTriangle className={`w-4 h-4 ${kpis.overdue > 0 ? 'text-red-400' : 'text-zinc-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${kpis.overdue > 0 ? 'text-red-400' : 'text-white'}`}>
              {formatBRL(kpis.overdue)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {kpis.overdueCount} {kpis.overdueCount === 1 ? 'cobrança em atraso' : 'cobranças em atraso'}
            </p>
          </CardContent>
        </Card>

        {/* Próximo Vencimento */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Próximo Vencimento</CardTitle>
            <Calendar className="w-4 h-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">
              {kpis.nextDueDate?.date ? formatDate(kpis.nextDueDate.date) : '-'}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1 truncate">
              {kpis.nextDueDate?.value ? `${formatBRL(kpis.nextDueDate.value)} — ` : ''}
              {kpis.nextDueDate?.clientName || 'Nenhuma cobrança futura'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 5. GRÁFICOS SEGREGADOS: RECEBIDOS REAIS X PREVISTOS POR VENCIMENTO */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: Recebimentos Reais (Apenas Liquidado) */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="pb-3 border-b border-white/5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Recebimentos Reais (Últimos 6 meses)
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  Valores efetivamente liquidados e creditados no período
                </CardDescription>
              </div>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                Liquidado
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={recebidosData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRecebido" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.6} />
                  <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(val) => `R$ ${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [formatBRL(val), 'Recebido']}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorRecebido)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Gráfico 2: Previsão de Entradas (Cobranças Futuras a Vencer) */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="pb-3 border-b border-white/5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-blue-400" />
                  Previsão de Entradas (Próximos 6 meses)
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  Cobranças emitidas a vencer por mês. Não contabilizado como receita recebida.
                </CardDescription>
              </div>
              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">
                A Vencer
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={previstosData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.6} />
                  <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={11}
                    tickLine={false}
                    tickFormatter={(val) => `R$ ${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [formatBRL(val), 'Previsto']}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 6. TABELA DE COBRANÇAS REAIS */}
      <Card className="bg-zinc-950/40 border-white/10">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div>
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              Extrato Geral de Cobranças Asaas
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400 mt-0.5">
              Listagem consolidada das cobranças espelhadas no Hub ({pagination.total} registros encontrados)
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="py-16 px-4 text-center space-y-3">
              <Wallet className="w-8 h-8 text-zinc-600 mx-auto opacity-40" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-300">Nenhuma cobrança localizada com os filtros atuais</p>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  Tente alterar os filtros de período, status ou remover termos de busca para visualizar mais registros.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900/40 text-zinc-400 border-b border-white/5 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Descrição</th>
                    <th className="py-3 px-4 font-medium">Forma</th>
                    <th className="py-3 px-4 font-medium">Valor</th>
                    <th className="py-3 px-4 font-medium">Vencimento</th>
                    <th className="py-3 px-4 font-medium">Pagamento</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-zinc-300">
                  {payments.map((p) => {
                    const invoiceLink = p.invoiceUrl || p.bankSlipUrl;
                    return (
                      <tr key={p.id} className="hover:bg-zinc-900/30 transition-colors">
                        <td className="py-3.5 px-4 font-medium text-white max-w-[160px] truncate">
                          {p.client?.name || 'Cliente não vinculado'}
                        </td>
                        <td className="py-3.5 px-4 max-w-[200px] truncate text-zinc-300" title={p.description}>
                          {p.description}
                        </td>
                        <td className="py-3.5 px-4">{getBillingTypeIcon(p.billingType)}</td>
                        <td className="py-3.5 px-4 font-semibold text-white">{formatBRL(p.value)}</td>
                        <td className="py-3.5 px-4 text-zinc-400">{formatDate(p.dueDate)}</td>
                        <td className="py-3.5 px-4 text-zinc-400">
                          {p.paymentDate ? (
                            <span className="text-emerald-400 font-medium">{formatDate(p.paymentDate)}</span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-3.5 px-4">{getStatusBadge(p.status, p.statusLabel, p.isOverdue)}</td>
                        <td className="py-3.5 px-4 text-right">
                          {invoiceLink ? (
                            <a
                              href={invoiceLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                            >
                              <span>Ver fatura</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-zinc-600 text-[11px]">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 text-xs text-zinc-400">
              <div>
                Página {pagination.page} de {pagination.totalPages} ({pagination.total} cobranças)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={pagination.page <= 1 || loading}
                  className="h-8 border-white/10 text-zinc-300 hover:bg-zinc-900"
                >
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.min(pagination.totalPages, prev + 1))}
                  disabled={pagination.page >= pagination.totalPages || loading}
                  className="h-8 border-white/10 text-zinc-300 hover:bg-zinc-900"
                >
                  Próxima <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="caixa" className="space-y-6 mt-0">
        <CaixaMovimentacoes />
      </TabsContent>
      </Tabs>

      {/* 7. MODAL DE CONFIRMAÇÃO: SINCRONIZAR CARTEIRA COMPLETA */}
      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="bg-zinc-950 border-white/10 text-zinc-100 max-w-md">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-base font-semibold text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-emerald-400" />
              Sincronizar Carteira Asaas
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400 leading-relaxed">
              A sincronização importará clientes e cobranças existentes do Asaas para o Hub. Nenhum dado será alterado no Asaas.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 rounded-lg bg-zinc-900/60 border border-white/5 space-y-2 text-xs text-zinc-300">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Clientes existentes com o mesmo CPF/CNPJ serão vinculados com segurança, sem sobrescrever dados preenchidos manualmente.</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Clientes presentes no Asaas que não existam no Hub serão criados automaticamente como ativos.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>Clientes sem CPF/CNPJ válido de 11 ou 14 dígitos serão ignorados por segurança.</span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmModalOpen(false)}
              disabled={syncingWallet}
              className="border-white/10 text-zinc-400 hover:text-white"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteWalletSync}
              disabled={syncingWallet}
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium"
            >
              {syncingWallet ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Sincronizando carteira...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sincronizar agora</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 8. MODAL DE RESUMO DA SINCRONIZAÇÃO */}
      <Dialog open={summaryModalOpen} onOpenChange={setSummaryModalOpen}>
        <DialogContent className="bg-zinc-950 border-white/10 text-zinc-100 max-w-lg">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-base font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              Resultado da Sincronização
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Resumo da importação e espelhamento da carteira do Asaas no Hub 2.0
            </DialogDescription>
          </DialogHeader>

          {walletResult && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-white/5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Clientes Criados</span>
                  <div className="text-xl font-bold text-emerald-400">{walletResult.createdClients}</div>
                  <p className="text-[10px] text-zinc-500">Cadastrados automaticamente no Hub</p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900/50 border border-white/5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Clientes Vinculados</span>
                  <div className="text-xl font-bold text-blue-400">{walletResult.linkedClients}</div>
                  <p className="text-[10px] text-zinc-500">Já existiam e foram associados</p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900/50 border border-white/5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Cobranças Espelhadas</span>
                  <div className="text-xl font-bold text-white">{walletResult.syncedPayments}</div>
                  <p className="text-[10px] text-zinc-500">Faturas registradas localmente</p>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900/50 border border-white/5 space-y-1">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Ignorados sem Doc.</span>
                  <div className="text-xl font-bold text-amber-400">{walletResult.ignoredWithoutDoc}</div>
                  <p className="text-[10px] text-zinc-500">Sem CPF/CNPJ de 11 ou 14 dígitos</p>
                </div>
              </div>

              {/* Reconciliação Individual de Cobranças Ativas */}
              <div className="p-3 rounded-lg bg-zinc-900/30 border border-white/5 space-y-2">
                <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 text-cyan-400" />
                  Reconciliação de Cobranças Ativas (GET individual)
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-zinc-950/60 p-2 rounded border border-white/5">
                    <span className="text-zinc-500 text-[10px] block">Verificadas Individualmente</span>
                    <span className="text-sm font-semibold text-zinc-200">
                      {walletResult.reconciledActivePayments ?? 0}
                    </span>
                  </div>
                  <div className="bg-zinc-950/60 p-2 rounded border border-white/5">
                    <span className="text-zinc-500 text-[10px] block">Marcadas como Removidas</span>
                    <span className={`text-sm font-semibold ${(walletResult.reconciledDeletedPayments ?? 0) > 0 ? 'text-amber-400' : 'text-zinc-400'}`}>
                      {walletResult.reconciledDeletedPayments ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {walletResult.reconciliationErrors && walletResult.reconciliationErrors.length > 0 && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertCircle className="w-4 h-4" />
                    <span>Erros de reconciliação individual:</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-red-400">
                    {walletResult.reconciliationErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {walletResult.ambiguousCount > 0 && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{walletResult.ambiguousCount} cliente(s) com documento duplicado requerem revisão manual.</span>
                </div>
              )}

              {walletResult.errors && walletResult.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertCircle className="w-4 h-4" />
                    <span>Erros reportados:</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-red-400">
                    {walletResult.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              size="sm"
              onClick={() => setSummaryModalOpen(false)}
              className="bg-zinc-800 hover:bg-zinc-700 text-white w-full sm:w-auto"
            >
              Concluir e fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}