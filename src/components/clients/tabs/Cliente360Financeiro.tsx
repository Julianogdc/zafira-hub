import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  CreditCard,
  QrCode,
  FileText,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  asaasService,
  ClientFinancialSummaryResponse,
  AsaasPaymentItem,
  AsaasPaymentStatus,
} from '@/services/asaas';

interface Cliente360FinanceiroProps {
  clientId: string;
  canManage: boolean;
}

export function Cliente360Financeiro({ clientId, canManage }: Cliente360FinanceiroProps) {
  const [data, setData] = useState<ClientFinancialSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadFinancialData = useCallback(async () => {
    if (!clientId) return;
    try {
      setLoading(true);
      setError(null);
      const summary = await asaasService.getClientFinancialSummary(clientId);
      setData(summary);
    } catch (err: any) {
      console.error('Erro ao carregar dados financeiros do Asaas:', err);
      setError(err?.data?.message || err?.message || 'Não foi possível carregar as cobranças do Asaas.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    loadFinancialData();
  }, [loadFinancialData]);

  const handleManualSync = async () => {
    if (!clientId) return;
    try {
      setIsSyncing(true);
      const result = await asaasService.triggerClientSync(clientId);
      if (result.success) {
        toast.success(
          `Sincronização concluída: ${result.syncedPayments} cobrança(s) atualizada(s). Vínculo: ${result.linkStatusLabel}`
        );
      } else {
        if (result.linkStatus === 'AMBIGUOUS') {
          toast.warning(
            `Atenção: ${result.linkStatusLabel}. Mais de um cadastro encontrado no Asaas com o mesmo documento.`
          );
        } else if (result.linkStatus === 'NO_DOCUMENT') {
          toast.error(`Não foi possível sincronizar: ${result.linkStatusLabel}`);
        } else {
          toast.info(result.linkStatusLabel || 'Cliente não encontrado no Asaas.');
        }
      }
      await loadFinancialData();
    } catch (err: any) {
      console.error('Erro ao sincronizar cliente com Asaas:', err);
      toast.error(err?.data?.message || err?.message || 'Falha ao sincronizar dados do cliente no Asaas.');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(val || 0);
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

  const getStatusBadge = (payment: AsaasPaymentItem) => {
    switch (payment.status) {
      case 'RECEIVED':
      case 'CONFIRMED':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] font-medium gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {payment.statusLabel}
          </Badge>
        );
      case 'OVERDUE':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] font-medium gap-1">
            <AlertTriangle className="w-3 h-3" />
            {payment.statusLabel}
          </Badge>
        );
      case 'PENDING':
        if (payment.isOverdue) {
          return (
            <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] font-medium gap-1">
              <AlertTriangle className="w-3 h-3" />
              Vencido
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] font-medium gap-1">
            <Clock className="w-3 h-3" />
            {payment.statusLabel}
          </Badge>
        );
      case 'REFUNDED':
        return (
          <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[11px] font-medium">
            {payment.statusLabel}
          </Badge>
        );
      case 'DELETED':
      case 'CANCELLED':
      default:
        return (
          <Badge variant="outline" className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[11px] font-medium">
            {payment.statusLabel}
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

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
        <p className="text-xs">Consultando dados financeiros no Asaas...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="bg-zinc-950/40 border-red-500/20 p-8 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
        <h3 className="text-sm font-semibold text-white">Falha ao carregar financeiro</h3>
        <p className="text-xs text-zinc-400 max-w-md mx-auto">{error}</p>
        <Button variant="outline" size="sm" onClick={loadFinancialData} className="border-white/10 text-xs">
          Tentar novamente
        </Button>
      </Card>
    );
  }

  const kpis = data?.kpis || {
    pending: 0,
    pendingCount: 0,
    receivedMonth: 0,
    receivedMonthCount: 0,
    overdue: 0,
    overdueCount: 0,
  };

  const payments = data?.payments || [];

  return (
    <div className="space-y-6">
      {/* Resumo de KPIs do Cliente */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Em Aberto</CardTitle>
            <Clock className="w-4 h-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">{formatCurrency(kpis.pending)}</div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {kpis.pendingCount} {kpis.pendingCount === 1 ? 'cobrança prevista' : 'cobranças previstas'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Recebido no Mês</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">{formatCurrency(kpis.receivedMonth)}</div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {kpis.receivedMonthCount} {kpis.receivedMonthCount === 1 ? 'cobrança liquidada' : 'cobranças liquidadas'}
            </p>
          </CardContent>
        </Card>

        <Card className={`bg-zinc-950/40 ${kpis.overdue > 0 ? 'border-red-500/30' : 'border-white/10'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Vencido / Inadimplente</CardTitle>
            <AlertTriangle className={`w-4 h-4 ${kpis.overdue > 0 ? 'text-red-400' : 'text-zinc-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${kpis.overdue > 0 ? 'text-red-400' : 'text-white'}`}>
              {formatCurrency(kpis.overdue)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {kpis.overdueCount} {kpis.overdueCount === 1 ? 'cobrança em atraso' : 'cobranças em atraso'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Cobranças */}
      <Card className="bg-zinc-950/40 border-white/10">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div>
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              Cobranças & Faturas no Asaas
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400 mt-0.5">
              Extrato de pagamentos e histórico financeiro sincronizado com o Asaas
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {data?.linkStatus === 'LINKED' && (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Vinculado
              </Badge>
            )}
            {data?.linkStatus === 'AMBIGUOUS' && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] gap-1">
                <AlertTriangle className="w-3 h-3" />
                Vínculo ambíguo
              </Badge>
            )}
            {data?.linkStatus === 'NO_DOCUMENT' && (
              <Badge variant="outline" className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[11px]">
                Sem CPF/CNPJ
              </Badge>
            )}
            {data?.linkStatus === 'NOT_FOUND' && (
              <Badge variant="outline" className="bg-zinc-800 text-zinc-400 border-zinc-700 text-[11px]">
                Não localizado no Asaas
              </Badge>
            )}

            {canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualSync}
                disabled={isSyncing || loading}
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs gap-1.5 h-8"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Asaas'}</span>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {payments.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-3">
              <HelpCircle className="w-8 h-8 text-zinc-600 mx-auto opacity-40" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-300">Nenhuma cobrança encontrada para este cliente</p>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  {data?.isLinked
                    ? 'O cliente está conectado ao Asaas, mas ainda não possui faturas emitidas.'
                    : 'Para vincular cobranças automaticamente, certifique-se de que o CPF/CNPJ do cliente está cadastrado e utilize o botão Sincronizar Asaas.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900/40 text-zinc-400 border-b border-white/5 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-3 px-4 font-medium">Descrição</th>
                    <th className="py-3 px-4 font-medium">Forma</th>
                    <th className="py-3 px-4 font-medium">Valor</th>
                    <th className="py-3 px-4 font-medium">Vencimento</th>
                    <th className="py-3 px-4 font-medium">Pagamento</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {payments.map((p) => {
                    const payUrl = p.invoiceUrl || p.bankSlipUrl;
                    return (
                      <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-white">{p.description}</div>
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">{p.externalId}</div>
                        </td>
                        <td className="py-3 px-4">{getBillingTypeIcon(p.billingType)}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{formatCurrency(p.value)}</div>
                          {p.netValue && p.netValue !== p.value && (
                            <div className="text-[10px] text-zinc-500">Líq: {formatCurrency(p.netValue)}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={p.isOverdue ? 'text-red-400 font-medium' : 'text-zinc-300'}>
                            {formatDate(p.dueDate)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-400">{formatDate(p.paymentDate)}</td>
                        <td className="py-3 px-4">{getStatusBadge(p)}</td>
                        <td className="py-3 px-4 text-right">
                          {payUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 gap-1"
                            >
                              <a href={payUrl} target="_blank" rel="noopener noreferrer">
                                <span>Ver fatura</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </Button>
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
        </CardContent>
      </Card>
    </div>
  );
}
