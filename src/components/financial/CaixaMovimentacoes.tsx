import { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Tag,
  Edit2,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Clock,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
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
import {
  financialApi,
  FinancialAccountsOverviewResponse,
  FinancialTransactionItem,
  FinancialCategoryItem,
  FinancialAccountSummary,
} from '@/services/financial';
import { toast } from 'sonner';

export function CaixaMovimentacoes() {
  // Estados de dados
  const [overview, setOverview] = useState<FinancialAccountsOverviewResponse | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransactionItem[]>([]);
  const [categories, setCategories] = useState<FinancialCategoryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Estados de carregamento
  const [loadingOverview, setLoadingOverview] = useState<boolean>(true);
  const [loadingTransactions, setLoadingTransactions] = useState<boolean>(true);
  const [syncingAsaas, setSyncingAsaas] = useState<boolean>(false);
  const [syncingInter, setSyncingInter] = useState<boolean>(false);

  // Filtros
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [selectedDirection, setSelectedDirection] = useState<string>('ALL');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [pendingOnly, setPendingOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal de edição de categoria
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [selectedTx, setSelectedTx] = useState<FinancialTransactionItem | null>(null);
  const [newCategoryId, setNewCategoryId] = useState<string>('');
  const [createRule, setCreateRule] = useState<boolean>(true);
  const [rulePattern, setRulePattern] = useState<string>('');
  const [ruleField, setRuleField] = useState<'DESCRIPTION' | 'COUNTERPARTY_NAME'>('DESCRIPTION');
  const [savingCategory, setSavingCategory] = useState<boolean>(false);

  // Lista defensiva de opções de categorias para prevenir erros de renderização
  const categoryOptions = Array.isArray(categories) ? categories : [];

  // Formatação de Moeda
  const formatBRL = (val: number | null | undefined) => {
    return (val ?? 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  // Formatação de Data
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  // Carrega Visão Geral e Categorias
  const loadOverviewAndCategories = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const [overviewData, catData] = await Promise.all([
        financialApi.getOverview(),
        financialApi.getCategories(),
      ]);
      setOverview(overviewData);
      setCategories(Array.isArray(catData) ? catData : (Array.isArray((catData as any)?.categories) ? (catData as any).categories : []));
    } catch (err: any) {
      console.error('Erro ao carregar overview financeiro:', err);
      toast.error('Erro ao carregar resumo de caixa.');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Carrega Transações
  const loadTransactions = useCallback(async () => {
    setLoadingTransactions(true);
    try {
      const res = await financialApi.getTransactions({
        accountId: selectedAccountId !== 'ALL' ? selectedAccountId : undefined,
        direction: selectedDirection !== 'ALL' ? (selectedDirection as any) : undefined,
        categoryId: selectedCategoryId !== 'ALL' ? selectedCategoryId : undefined,
        pendingCategoryOnly: pendingOnly,
        search: searchQuery.trim() || undefined,
        page: currentPage,
        limit: 20,
      });
      setTransactions(res.transactions || []);
      setTotalCount(res.pagination?.total || 0);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err: any) {
      console.error('Erro ao carregar transações:', err);
      toast.error('Erro ao carregar extrato de movimentações.');
    } finally {
      setLoadingTransactions(false);
    }
  }, [selectedAccountId, selectedDirection, selectedCategoryId, pendingOnly, searchQuery, currentPage]);

  useEffect(() => {
    loadOverviewAndCategories();
  }, [loadOverviewAndCategories]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Sincronizar Asaas Ledger
  const handleSyncAsaas = async () => {
    setSyncingAsaas(true);
    try {
      const res = await financialApi.syncAsaasLedger();
      if (res.success) {
        toast.success(`Extrato Asaas sincronizado: ${res.syncedCount} transações.`);
        await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
      } else {
        toast.error('Não foi possível sincronizar o extrato do Asaas.');
      }
    } catch (err: any) {
      console.error('Erro ao sincronizar Asaas:', err);
      toast.error(err.response?.data?.message || 'Falha na sincronização do Asaas.');
    } finally {
      setSyncingAsaas(false);
    }
  };

  // Sincronizar Inter
  const handleSyncInter = async () => {
    setSyncingInter(true);
    try {
      const res = await financialApi.syncInter();
      if (res.success) {
        toast.success(`Extrato Inter sincronizado: ${res.syncedCount} transações.`);
        await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
      } else if (res.code === 'INTER_NOT_CONFIGURED') {
        toast.info('Banco Inter PJ ainda não configurado no ambiente.');
      } else {
        toast.error(res.message || 'Não foi possível sincronizar o Banco Inter.');
      }
    } catch (err: any) {
      console.error('Erro ao sincronizar Inter:', err);
      const code = err.response?.data?.code;
      if (code === 'INTER_NOT_CONFIGURED') {
        toast.info('Banco Inter PJ não configurado no servidor.');
      } else {
        toast.error(err.response?.data?.message || 'Falha na sincronização do Banco Inter.');
      }
    } finally {
      setSyncingInter(false);
    }
  };

  // Abrir Modal de Edição de Categoria
  const openEditCategory = (tx: FinancialTransactionItem) => {
    setSelectedTx(tx);
    setNewCategoryId(tx.category?.id || '');
    setRulePattern(tx.counterpartyName || tx.description || '');
    setRuleField(tx.counterpartyName ? 'COUNTERPARTY_NAME' : 'DESCRIPTION');
    setCreateRule(true);
    setEditModalOpen(true);
  };

  // Salvar Nova Categoria
  const handleSaveCategory = async () => {
    if (!selectedTx || !newCategoryId) return;
    setSavingCategory(true);
    try {
      await financialApi.updateTransactionCategory(selectedTx.id, {
        categoryId: newCategoryId,
        createRule,
        rulePattern: createRule ? rulePattern : undefined,
        ruleField: createRule ? ruleField : undefined,
        ruleMatchType: 'CONTAINS',
      });
      toast.success('Categoria atualizada com sucesso!');
      setEditModalOpen(false);
      await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
    } catch (err: any) {
      console.error('Erro ao atualizar categoria:', err);
      toast.error(err.response?.data?.error || 'Erro ao salvar categoria.');
    } finally {
      setSavingCategory(false);
    }
  };

  // Confirmar Transferência em Revisão
  const handleConfirmTransfer = async (transferId: string) => {
    try {
      await financialApi.confirmTransfer(transferId);
      toast.success('Transferência interna confirmada.');
      await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
    } catch (err: any) {
      console.error('Erro ao confirmar transferência:', err);
      toast.error('Não foi possível confirmar a transferência.');
    }
  };

  const interAccount = overview?.accounts.find((a) => a.provider === 'INTER') || overview?.accounts[0];
  const isInterConnected = Boolean(interAccount && (interAccount.lastSyncedAt || interAccount.lastSyncAt));

  const netResult = (overview?.periodSummary.operationalIncome || 0) - (overview?.periodSummary.operationalExpense || 0);

  return (
    <div className="space-y-6">
      {/* 1. BARRA DE SINCRONIZAÇÃO BANCO INTER PJ */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-zinc-950/60 border border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Caixa e Movimentações (Banco Inter PJ)</h3>
            <p className="text-xs text-zinc-400">
              Extrato bancário oficial, movimentações de conta corrente PJ e conciliação de receitas e despesas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncInter}
            disabled={syncingInter}
            className="border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 text-xs gap-1.5 h-8"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingInter ? 'animate-spin text-orange-400' : 'text-orange-400'}`} />
            <span>{syncingInter ? 'Sincronizando Inter...' : 'Sincronizar Inter PJ'}</span>
          </Button>
        </div>
      </div>

      {/* ESTADO VAZIO SE BANCO INTER NÃO ESTIVER CONECTADO */}
      {!loadingOverview && !isInterConnected && (
        <Card className="bg-zinc-950/40 border-dashed border-orange-500/30 p-8 text-center">
          <div className="max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 rounded-full bg-orange-500/10 text-orange-400 mx-auto flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
            <h4 className="text-base font-semibold text-white">Banco Inter PJ não conectado</h4>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Conecte o Banco Inter PJ para visualizar o caixa e as movimentações financeiras reais.
            </p>
            <p className="text-[11px] text-zinc-500">
              O Asaas atua exclusivamente como visor de cobranças e contas a receber. O saldo de caixa e as movimentações operacionais dependem da integração com a conta corrente PJ do Inter.
            </p>
          </div>
        </Card>
      )}

      {/* 2. CARDS DE SALDOS E TOTAIS OPERACIONAIS DO INTER PJ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Saldo Banco Inter PJ */}
        <Card className="bg-gradient-to-br from-zinc-900/90 to-zinc-950/80 border-orange-500/30">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-orange-400">Saldo em Caixa (Inter PJ)</CardTitle>
            <Wallet className="w-4 h-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {isInterConnected ? formatBRL(interAccount?.currentBalance ?? interAccount?.balance) : 'Não conectado'}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {interAccount?.lastSyncedAt || interAccount?.lastSyncAt
                ? `Atualizado em ${formatDate((interAccount.lastSyncedAt || interAccount.lastSyncAt)!)}`
                : 'Aguardando sincronização inicial'}
            </p>
          </CardContent>
        </Card>

        {/* Entradas Operacionais Inter */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Entradas Operacionais (Inter PJ)</CardTitle>
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-400">
              {formatBRL(overview?.periodSummary.operationalIncome)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">Créditos recebidos na conta corrente PJ</p>
          </CardContent>
        </Card>

        {/* Saídas Operacionais Inter */}
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Saídas Operacionais (Inter PJ)</CardTitle>
            <ArrowDownLeft className="w-4 h-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-red-400">
              {formatBRL(overview?.periodSummary.operationalExpense)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">Débitos e despesas pagas pela conta PJ</p>
          </CardContent>
        </Card>

        {/* Classificação Pendente */}
        <Card className={`bg-zinc-950/40 ${(overview?.periodSummary.pendingReviewCount || 0) > 0 ? 'border-amber-500/40' : 'border-white/10'}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Para Revisar</CardTitle>
            <AlertTriangle className={`w-4 h-4 ${(overview?.periodSummary.pendingReviewCount || 0) > 0 ? 'text-amber-400' : 'text-zinc-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">
              {overview?.periodSummary.pendingReviewCount || 0}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Transações sem categoria ou aguardando confirmação
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 3. FILTROS DO EXTRATO DO BANCO INTER PJ */}
      <Card className="bg-zinc-950/40 border-white/10 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Filtro de Direção */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">Fluxo</label>
            <Select
              value={selectedDirection}
              onValueChange={(val) => {
                setSelectedDirection(val);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200">
                <SelectValue placeholder="Todos os fluxos" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                <SelectItem value="ALL">Todos os fluxos</SelectItem>
                <SelectItem value="CREDIT">Entradas (Créditos)</SelectItem>
                <SelectItem value="DEBIT">Saídas (Débitos)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro de Categoria */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-400">Categoria</label>
            <Select
              value={selectedCategoryId}
              onValueChange={(val) => {
                setSelectedCategoryId(val);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200">
                <SelectValue placeholder="Todas as categorias" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200 max-h-56">
                <SelectItem value="ALL">Todas as categorias</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
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
                placeholder="Descrição ou favorecido..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-8 h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          </div>

          {/* Filtro Rápido: Pendentes de Categoria */}
          <div className="flex items-end pb-1">
            <Button
              type="button"
              variant={pendingOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setPendingOnly(!pendingOnly);
                setCurrentPage(1);
              }}
              className={`w-full h-9 text-xs gap-1.5 ${
                pendingOnly
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-zinc-900/50 text-zinc-300 border-white/10 hover:bg-zinc-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{pendingOnly ? 'Para Revisar (Ativo)' : 'Para Revisar'}</span>
            </Button>
          </div>
        </div>
      </Card>


      {/* 5. TABELA DE EXTRATO UNIFICADO */}
      <Card className="bg-zinc-950/40 border-white/10 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm font-semibold text-white">Extrato de Movimentações</CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              {totalCount} movimentações registradas
            </CardDescription>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-900/80 text-zinc-400 uppercase tracking-wider font-medium border-y border-white/5">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Descrição / Contraparte</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-center">Status / Conciliação</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-zinc-200">
              {loadingTransactions ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-orange-400" />
                    Carregando extrato do Banco Inter PJ...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma movimentação financeira encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const isIncome = tx.direction === 'INCOME';
                  const isInternal = tx.kind === 'TRANSFER_INTERNAL';

                  return (
                    <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                      {/* Data */}
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-400">
                        {formatDate(tx.transactedAt)}
                      </td>

                      {/* Conta */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className="bg-orange-500/10 text-orange-300 border-orange-500/20 text-[10px]"
                        >
                          Banco Inter PJ
                        </Badge>
                      </td>

                      {/* Descrição e Contraparte */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-white max-w-xs truncate">{tx.description}</div>
                        {tx.counterpartyName && (
                          <div className="text-[11px] text-zinc-400 flex items-center gap-1 mt-0.5">
                            <span>{tx.counterpartyName}</span>
                            {tx.counterpartyDocument && (
                              <span className="text-zinc-500">({tx.counterpartyDocument})</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Categoria */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {tx.category ? (
                            <Badge
                              variant="outline"
                              className="bg-zinc-900 border-white/10 text-zinc-300 text-[11px] font-normal"
                            >
                              {tx.category.name}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-500/10 text-amber-300 border-amber-500/20 text-[11px]"
                            >
                              Para revisar
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-zinc-400 hover:text-white"
                            onClick={() => openEditCategory(tx)}
                            title="Editar categoria"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>

                      {/* Valor */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            isInternal
                              ? 'text-cyan-300'
                              : isIncome
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {isInternal ? '' : isIncome ? '+ ' : '- '}
                          {formatBRL(tx.amount)}
                        </span>
                      </td>

                      {/* Status / Conciliação */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {isInternal ? (
                          tx.transferStatus === 'AUTO_MATCHED' ? (
                            <Badge
                              variant="outline"
                              className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-[10px]"
                            >
                              Transferência Asaas → Inter
                            </Badge>
                          ) : tx.transferStatus === 'CONFIRMED' ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]"
                            >
                              Confirmada
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]"
                            >
                              Revisão sugerida
                            </Badge>
                          )
                        ) : (
                          <span className="text-[11px] text-zinc-500">Operacional</span>
                        )}
                      </td>

                      {/* Ação */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isInternal && tx.transferStatus === 'REVIEW' && tx.transferId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleConfirmTransfer(tx.transferId!)}
                            className="h-7 text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                          >
                            Confirmar
                          </Button>
                        ) : (
                          <span className="text-zinc-600 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-white/5 text-xs text-zinc-400">
            <div>
              Página {currentPage} de {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loadingTransactions}
                className="h-8 bg-zinc-900 border-white/10 text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loadingTransactions}
                className="h-8 bg-zinc-900 border-white/10 text-xs"
              >
                Próxima <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 6. MODAL DE EDIÇÃO RÁPIDA DE CATEGORIA */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-[480px] bg-zinc-950 border-white/10 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-400" />
              Classificar Movimentação
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Defina a categoria e opcionalmente crie uma regra para automatizar lançamentos futuros similares.
            </DialogDescription>
          </DialogHeader>

          {selectedTx && (
            <div className="space-y-4 py-2 text-xs">
              <div className="p-3 rounded-lg bg-zinc-900/60 border border-white/5 space-y-1">
                <div className="text-zinc-400">Transação selecionada:</div>
                <div className="font-semibold text-white">{selectedTx.description}</div>
                {selectedTx.counterpartyName && (
                  <div className="text-zinc-400">Contraparte: {selectedTx.counterpartyName}</div>
                )}
                <div className="text-emerald-400 font-medium">{formatBRL(selectedTx.amount)}</div>
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-zinc-300">Nova Categoria</label>
                <Select value={newCategoryId} onValueChange={setNewCategoryId}>
                  <SelectTrigger className="h-9 bg-zinc-900/50 border-white/10 text-xs text-zinc-200">
                    <SelectValue placeholder="Selecione uma categoria" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200 max-h-56">
                    {categoryOptions.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="p-3 rounded-lg bg-zinc-900/40 border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Criar regra para transações semelhantes
                  </span>
                  <input
                    type="checkbox"
                    checked={createRule}
                    onChange={(e) => setCreateRule(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                  />
                </div>

                {createRule && (
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-400">Campo de identificação</label>
                      <Select
                        value={ruleField}
                        onValueChange={(val: any) => setRuleField(val)}
                      >
                        <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                          <SelectItem value="DESCRIPTION">Descrição da Transação</SelectItem>
                          <SelectItem value="COUNTERPARTY_NAME">Nome do Favorecido / Contraparte</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-400">Texto ou termo contido</label>
                      <Input
                        type="text"
                        value={rulePattern}
                        onChange={(e) => setRulePattern(e.target.value)}
                        placeholder="Ex: PNEUTEK ou GOOGLE"
                        className="h-8 bg-zinc-900 border-white/10 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditModalOpen(false)}
              disabled={savingCategory}
              className="border-white/10 text-xs h-8"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveCategory}
              disabled={savingCategory || !newCategoryId}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8"
            >
              {savingCategory ? 'Salvando...' : 'Salvar Categoria'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
