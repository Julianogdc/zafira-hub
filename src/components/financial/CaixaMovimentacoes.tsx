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
  Plus,
  Trash2,
  Archive,
  RotateCcw,
  Check,
  Eye,
  Sliders,
  Settings,
  UserCheck,
  User,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  financialApi,
  FinancialAccountsOverviewResponse,
  FinancialTransactionItem,
  FinancialCategoryItem,
  FinancialCategoryRuleItem,
  FinancialAccountSummary,
} from '@/services/financial';
import { clientsService, HubClient } from '@/services/clients';
import { toast } from 'sonner';
import { formatBankDateTimeDisplay, formatCounterpartyDisplay } from '@/utils/financialFormatters';

export function CaixaMovimentacoes() {
  // Estados de dados
  const [overview, setOverview] = useState<FinancialAccountsOverviewResponse | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransactionItem[]>([]);
  const [categories, setCategories] = useState<FinancialCategoryItem[]>([]);
  const [categoryRules, setCategoryRules] = useState<FinancialCategoryRuleItem[]>([]);
  const [clients, setClients] = useState<HubClient[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Estados de carregamento
  const [loadingOverview, setLoadingOverview] = useState<boolean>(true);
  const [loadingTransactions, setLoadingTransactions] = useState<boolean>(true);
  const [loadingRules, setLoadingRules] = useState<boolean>(false);
  const [syncingAsaas, setSyncingAsaas] = useState<boolean>(false);
  const [syncingInter, setSyncingInter] = useState<boolean>(false);
  const [reprocessingInter, setReprocessingInter] = useState<boolean>(false);
  const [repairingDuplicates, setRepairingDuplicates] = useState<boolean>(false);
  const [loadingRepairPreview, setLoadingRepairPreview] = useState<boolean>(false);
  const [repairPreviewModalOpen, setRepairPreviewModalOpen] = useState<boolean>(false);
  const [repairPreviewData, setRepairPreviewData] = useState<{
    scanned: number;
    zeroRecordsCount: number;
    provenDuplicatesToRemove: number;
    manualClassificationsToPreserve: number;
    ambiguousRecordsKept: number;
    analyzedRecords?: number;
    positiveRecordsCount?: number;
    candidatePairsEvaluated?: number;
    matchesByOfficialId?: number;
    matchesByLegacyAmount?: number;
    matchesByStrictFallback?: number;
    rejectedByAccount?: number;
    rejectedByDate?: number;
    rejectedByDirection?: number;
    rejectedByTitle?: number;
    rejectedByAmount?: number;
    repairAlgorithmVersion?: string;
  } | null>(null);
  const [checkingTimes, setCheckingTimes] = useState<boolean>(false);
  const [applyingTimes, setApplyingTimes] = useState<boolean>(false);
  const [previewResult, setPreviewResult] = useState<{
    totalReceived: number;
    withOfficialTransactionId: number;
    withRealTimestamp: number;
    withoutTimestamp: number;
    scopeAvailable: boolean;
  } | null>(null);

  // Filtros
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [selectedDirection, setSelectedDirection] = useState<string>('ALL');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [pendingOnly, setPendingOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Gaveta lateral de detalhes da transação e edição
  const [detailsSheetOpen, setDetailsSheetOpen] = useState<boolean>(false);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [selectedTx, setSelectedTx] = useState<FinancialTransactionItem | null>(null);
  const [newCategoryId, setNewCategoryId] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [teachFutureClientRule, setTeachFutureClientRule] = useState<boolean>(true);
  const [createRule, setCreateRule] = useState<boolean>(true);
  const [rulePattern, setRulePattern] = useState<string>('');
  const [ruleField, setRuleField] = useState<'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT'>('DESCRIPTION');
  const [ruleMatchType, setRuleMatchType] = useState<'CONTAINS' | 'EXACT'>('CONTAINS');
  const [rulePriority, setRulePriority] = useState<number>(20);
  const [savingCategory, setSavingCategory] = useState<boolean>(false);

  // Modal de Gestão Completa de Categorias e Regras
  const [categoriesModalOpen, setCategoriesModalOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'categories' | 'rules'>('categories');
  const [includeArchivedCategories, setIncludeArchivedCategories] = useState<boolean>(false);

  // Formulário de Categoria (Criar / Editar)
  const [categoryFormOpen, setCategoryFormOpen] = useState<boolean>(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [catName, setCatName] = useState<string>('');
  const [catType, setCatType] = useState<string>('EXPENSE');
  const [catColor, setCatColor] = useState<string>('#6b7280');
  const [savingCategoryForm, setSavingCategoryForm] = useState<boolean>(false);

  // Modal de Migração de Transações (quando tentar excluir categoria com movimentações)
  const [migrationModalOpen, setMigrationModalOpen] = useState<boolean>(false);
  const [catToMigrate, setCatToMigrate] = useState<FinancialCategoryItem | null>(null);
  const [targetMigrationCatId, setTargetMigrationCatId] = useState<string>('');
  const [migrating, setMigrating] = useState<boolean>(false);

  // Formulário de Regra Automática (Criar / Editar)
  const [ruleFormOpen, setRuleFormOpen] = useState<boolean>(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formRuleCatId, setFormRuleCatId] = useState<string>('');
  const [formRuleClientId, setFormRuleClientId] = useState<string>('');
  const [formRuleField, setFormRuleField] = useState<'DESCRIPTION' | 'COUNTERPARTY_NAME' | 'COUNTERPARTY_DOCUMENT'>('DESCRIPTION');
  const [formRuleType, setFormRuleType] = useState<'CONTAINS' | 'EXACT'>('CONTAINS');
  const [formRuleValue, setFormRuleValue] = useState<string>('');
  const [formRulePriority, setFormRulePriority] = useState<number>(20);
  const [formRuleActive, setFormRuleActive] = useState<boolean>(true);
  const [rulePreview, setRulePreview] = useState<{ totalMatches: number; sampleMatches: any[] } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [savingRule, setSavingRule] = useState<boolean>(false);

  // Lista defensiva de categorias
  const categoryOptions = Array.isArray(categories) ? categories.filter((c) => c.isActive !== false) : [];

  // Formatação de Moeda
  const formatBRL = (val: number | null | undefined) => {
    return (val ?? 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  // Formatação de Data dd/MM/yyyy
  const formatDate = (rawDate: string | Date | null | undefined) => {
    if (!rawDate) return '-';
    try {
      const d = typeof rawDate === 'string' ? new Date(rawDate) : rawDate;
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('pt-BR', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return '-';
    }
  };

  // Mascaramento de privacidade de Documentos (CPF/CNPJ)
  const maskDocument = (doc?: string | null) => {
    if (!doc) return 'Não informado';
    const clean = doc.replace(/\D/g, '');
    if (clean.length === 11) {
      return `***.${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
    }
    if (clean.length === 14) {
      return `**.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-**`;
    }
    return clean.length > 4 ? `***${clean.slice(-4)}` : '***';
  };

  // Extração rigorosa de horário bancário (nunca inventa se o banco não forneceu)
  const getInterTime = (tx: FinancialTransactionItem | null): string | null => {
    if (!tx) return null;

    // Se o metadado persistido for explicitamente DATE_ONLY, nunca exibe horário
    if (tx.datePrecision === 'DATE_ONLY') {
      return null;
    }

    const raw = tx.rawPayload;
    if (raw && typeof raw === 'object') {
      // 1. Hora explícita
      if (typeof raw.hora === 'string' && raw.hora.trim() && raw.hora.includes(':')) {
        const m = raw.hora.match(/(\d{2}:\d{2}(?::\d{2})?)/);
        if (m) return m[1];
      }
      if (typeof raw.horaLancamento === 'string' && raw.horaLancamento.trim() && raw.horaLancamento.includes(':')) {
        const m = raw.horaLancamento.match(/(\d{2}:\d{2}(?::\d{2})?)/);
        if (m) return m[1];
      }

      // 2. dataHoraMovimento / dataHoraTransacao
      const rawDateTime = raw.dataHoraMovimento || raw.dataHoraTransacao || raw.dataHora;
      if (typeof rawDateTime === 'string') {
        const trimmed = rawDateTime.trim();
        const match = trimmed.match(/[ T](\d{2}:\d{2}(?::\d{2})?)/);
        if (match) {
          return match[1];
        }
      }
    }

    // Se marcado como DATETIME e tiver horário real no timestamp diferente de 12:00 e 00:00
    if (tx.datePrecision === 'DATETIME') {
      const dateStr = tx.occurredAt || tx.transactedAt;
      if (dateStr && typeof dateStr === 'string' && dateStr.includes('T')) {
        const timePart = dateStr.split('T')[1]?.slice(0, 5);
        if (timePart && timePart !== '12:00' && timePart !== '00:00') {
          return timePart;
        }
      }
    }

    // REGRA INEGOCIÁVEL: NUNCA inventar horário se o banco não informou
    return null;
  };

  // Carrega Visão Geral e Categorias
  const loadOverviewAndCategories = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const [overviewData, catData] = await Promise.all([
        financialApi.getOverview(),
        financialApi.getCategories(includeArchivedCategories),
      ]);
      setOverview(overviewData);
      setCategories(Array.isArray(catData) ? catData : (Array.isArray((catData as any)?.categories) ? (catData as any).categories : []));
    } catch (err: any) {
      console.error('Erro ao carregar overview financeiro:', err);
      toast.error('Erro ao carregar resumo de caixa.');
    } finally {
      setLoadingOverview(false);
    }
  }, [includeArchivedCategories]);

  // Carrega Regras
  const loadRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const r = await financialApi.getCategoryRules();
      setCategoryRules(r);
    } catch (err) {
      console.error('Erro ao carregar regras:', err);
    } finally {
      setLoadingRules(false);
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

  useEffect(() => {
    clientsService.listClients()
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Erro ao carregar clientes:', err));
  }, []);

  useEffect(() => {
    if (categoriesModalOpen && activeTab === 'rules') {
      loadRules();
    }
  }, [categoriesModalOpen, activeTab, loadRules]);

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

  // Reprocessar Extrato Inter
  const handleReprocessInter = async () => {
    setReprocessingInter(true);
    try {
      const res = await financialApi.reprocessInter();
      if (res.success) {
        toast.success(`Reprocessamento concluído: ${res.updatedCount} movimentações corrigidas.`);
        await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
      } else {
        toast.error('Não foi possível reprocessar as movimentações.');
      }
    } catch (err: any) {
      console.error('Erro ao reprocessar Inter:', err);
      toast.error(err.response?.data?.message || 'Falha no reprocessamento do Banco Inter.');
    } finally {
      setReprocessingInter(false);
    }
  };

  // Prévia somente-leitura de reparo de duplicatas do Inter PJ
  const handleOpenRepairPreview = async () => {
    setLoadingRepairPreview(true);
    try {
      const res = await financialApi.previewRepairInterDuplicates();
      if (res.success) {
        setRepairPreviewData({
          scanned: res.scanned ?? 0,
          zeroRecordsCount: res.zeroRecordsCount ?? 0,
          provenDuplicatesToRemove: res.provenDuplicatesToRemove ?? res.duplicatesToRemove ?? 0,
          manualClassificationsToPreserve: res.manualClassificationsToPreserve ?? res.manualDataToMerge ?? 0,
          ambiguousRecordsKept: res.ambiguousRecordsKept ?? res.ambiguousDuplicatesToSkip ?? 0,
          
          analyzedRecords: res.analyzedRecords ?? 0,
          positiveRecordsCount: res.positiveRecordsCount ?? 0,
          candidatePairsEvaluated: res.candidatePairsEvaluated ?? 0,
          matchesByOfficialId: res.matchesByOfficialId ?? 0,
          matchesByLegacyAmount: res.matchesByLegacyAmount ?? 0,
          matchesByStrictFallback: res.matchesByStrictFallback ?? 0,
          rejectedByAccount: res.rejectedByAccount ?? 0,
          rejectedByDate: res.rejectedByDate ?? 0,
          rejectedByDirection: res.rejectedByDirection ?? 0,
          rejectedByTitle: res.rejectedByTitle ?? 0,
          rejectedByAmount: res.rejectedByAmount ?? 0,
          repairAlgorithmVersion: res.repairAlgorithmVersion ?? '',
        });
        setRepairPreviewModalOpen(true);
      } else {
        toast.error(res.message || 'Não foi possível gerar a prévia do reparo.');
      }
    } catch (err: any) {
      console.error('Erro ao obter prévia de reparo:', err);
      toast.error(err.response?.data?.message || 'Falha ao analisar integridade do extrato Inter.');
    } finally {
      setLoadingRepairPreview(false);
    }
  };

  // Execução definitiva do reparo após confirmação explícita no modal
  const handleExecuteConfirmedRepair = async () => {
    setRepairingDuplicates(true);
    try {
      const res = await financialApi.repairInterDuplicates();
      if (res.success) {
        const removed = res.duplicatesRemoved ?? res.removedCount ?? 0;
        const merged = res.manualDataMerged ?? res.mergedCount ?? 0;
        const ambiguous = res.ambiguousDuplicatesSkipped ?? 0;

        if (removed > 0) {
          const ambiguousText = ambiguous > 0 ? ` (${ambiguous} registros ambíguos mantidos por segurança)` : '';
          toast.success(
            `Extrato reparado com sucesso: ${removed} duplicatas removidas, ${merged} classificações manuais preservadas.${ambiguousText}`
          );
        } else {
          if (ambiguous > 0) {
            toast.info(`Nenhuma duplicata confirmada (${ambiguous} registros ambíguos mantidos por segurança).`);
          } else {
            toast.info('Nenhuma duplicata foi confirmada pelas regras de segurança atuais.');
          }
        }
        setRepairPreviewModalOpen(false);
        await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
      } else {
        toast.error(res.message || 'Não foi possível reparar duplicatas.');
      }
    } catch (err: any) {
      console.error('Erro ao reparar duplicatas:', err);
      toast.error(err.response?.data?.message || 'Falha ao reparar duplicatas do Banco Inter.');
    } finally {
      setRepairingDuplicates(false);
    }
  };

  // Verificar horários do Inter (prévia somente leitura do extrato completo)
  const handleCheckInterTimes = async () => {
    setCheckingTimes(true);
    try {
      const res = await financialApi.previewInterEnrichedTimes();
      setPreviewResult(res);
      if (res.scopeAvailable) {
        toast.info(
          `Extrato analítico verificado: ${res.totalReceived} recebidas, ${res.withRealTimestamp} com horário real, ${res.withOfficialTransactionId} com ID oficial, ${res.withoutTimestamp} sem horário.`
        );
      } else {
        toast.error(res.message || 'Permissão insuficiente ou erro ao consultar extrato analítico do Banco Inter.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Erro ao verificar horários do extrato analítico.');
    } finally {
      setCheckingTimes(false);
    }
  };

  // Aplicar horários oficiais (somente com identificador bancário oficial único)
  const handleApplyInterTimes = async () => {
    setApplyingTimes(true);
    try {
      const res = await financialApi.applyInterEnrichedTimes();
      if (res.success) {
        toast.success(
          `Horários oficiais aplicados: ${res.updatedCount} movimentações atualizadas. (${res.skippedCount} ignoradas, ${res.ambiguousCount} ambíguas)`
        );
        await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
      } else {
        toast.error(res.message || 'Não foi possível aplicar os horários oficiais.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Falha ao aplicar horários oficiais.');
    } finally {
      setApplyingTimes(false);
    }
  };

  // Abrir Gaveta Lateral de Detalhes da Movimentação
  const openDetailsDrawer = (tx: FinancialTransactionItem) => {
    setSelectedTx(tx);
    const isCredit = tx.direction === 'CREDIT' || (tx.direction as string) === 'INCOME';

    let initialCatId = tx.category?.id || (tx as any).categoryId || '';
    if (!initialCatId || tx.category?.name === 'Para revisar') {
      if (isCredit) {
        const revCat = categories.find((c) => c.name.toLowerCase().includes('receita de cliente'));
        if (revCat) initialCatId = revCat.id;
      }
    }
    setNewCategoryId(initialCatId);

    // Cliente vinculado ou sugerido
    setSelectedClientId(tx.clientId || tx.client?.id || '');
    setTeachFutureClientRule(true);

    const safeCp = formatCounterpartyDisplay(tx.counterpartyName);
    const hasSafeCp = safeCp !== 'Não informada pelo banco';
    setRulePattern(hasSafeCp ? safeCp : (tx.description || ''));
    setRuleField(tx.counterpartyDocument ? 'COUNTERPARTY_DOCUMENT' : hasSafeCp ? 'COUNTERPARTY_NAME' : 'DESCRIPTION');
    setRuleMatchType(tx.counterpartyDocument ? 'EXACT' : 'CONTAINS');
    setRulePriority(25);
    setCreateRule(false);
    setDetailsSheetOpen(true);
  };

  // Alias retrocompatível
  const openEditCategory = openDetailsDrawer;

  // Confirmar sugestão de cliente com 1 clique diretamente na gaveta
  const handleConfirmSuggestedClient = async () => {
    if (!selectedTx || !selectedTx.suggestedClient) return;
    setSavingCategory(true);
    try {
      const clientId = selectedTx.suggestedClient.id;
      const isCredit = selectedTx.direction === 'CREDIT' || (selectedTx.direction as string) === 'INCOME';
      let catIdToSend = newCategoryId;
      if (!catIdToSend && isCredit) {
        const revCat = categories.find((c) => c.name.toLowerCase().includes('receita de cliente'));
        if (revCat) catIdToSend = revCat.id;
      }
      const safeCp = formatCounterpartyDisplay(selectedTx.counterpartyName);
      const hasSafeCp = safeCp !== 'Não informada pelo banco';
      await financialApi.updateTransactionCategory(selectedTx.id, {
        categoryId: catIdToSend || undefined,
        clientId,
        createRule: true,
        rulePattern: hasSafeCp ? safeCp : selectedTx.description,
        ruleField: selectedTx.counterpartyDocument ? 'COUNTERPARTY_DOCUMENT' : hasSafeCp ? 'COUNTERPARTY_NAME' : 'DESCRIPTION',
        ruleMatchType: selectedTx.counterpartyDocument ? 'EXACT' : 'CONTAINS',
        rulePriority: 25,
        ruleLinkClient: true,
      });
      toast.success(`Cliente "${selectedTx.suggestedClient.name}" vinculado e regra automática criada!`);
      setDetailsSheetOpen(false);
      setEditModalOpen(false);
      await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
    } catch (err: any) {
      console.error('Erro ao confirmar cliente:', err);
      toast.error(err.response?.data?.error || 'Erro ao confirmar cliente sugerido.');
    } finally {
      setSavingCategory(false);
    }
  };

  // Salvar Categoria e Cliente da Transação
  const handleSaveCategory = async () => {
    if (!selectedTx) return;
    setSavingCategory(true);
    try {
      const isCredit = selectedTx.direction === 'CREDIT' || (selectedTx.direction as string) === 'INCOME';
      const shouldCreateRule = (selectedClientId && teachFutureClientRule) ? true : createRule;

      let catIdToSend = newCategoryId;
      if (!catIdToSend && isCredit) {
        const revCat = categories.find((c) => c.name.toLowerCase().includes('receita de cliente'));
        if (revCat) catIdToSend = revCat.id;
      }

      await financialApi.updateTransactionCategory(selectedTx.id, {
        categoryId: catIdToSend || undefined,
        clientId: selectedClientId || null,
        createRule: shouldCreateRule,
        rulePattern: shouldCreateRule
          ? (rulePattern || (formatCounterpartyDisplay(selectedTx.counterpartyName) !== 'Não informada pelo banco' ? selectedTx.counterpartyName : selectedTx.description))
          : undefined,
        ruleField: shouldCreateRule ? ruleField : undefined,
        ruleMatchType: shouldCreateRule ? ruleMatchType : undefined,
        rulePriority: shouldCreateRule ? rulePriority : undefined,
        ruleLinkClient: Boolean(selectedClientId),
      });
      toast.success('Movimentação e classificação salvas com sucesso!');
      setDetailsSheetOpen(false);
      setEditModalOpen(false);
      await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
    } catch (err: any) {
      console.error('Erro ao atualizar categoria e cliente:', err);
      toast.error(err.response?.data?.error || 'Erro ao salvar alterações.');
    } finally {
      setSavingCategory(false);
    }
  };

  // Gestão de Categorias: Abrir formulário (Criar / Editar)
  const openCategoryForm = (cat?: FinancialCategoryItem) => {
    if (cat) {
      setEditingCategoryId(cat.id);
      setCatName(cat.name);
      setCatType(cat.type);
      setCatColor(cat.color || '#6b7280');
    } else {
      setEditingCategoryId(null);
      setCatName('');
      setCatType('EXPENSE');
      setCatColor('#6b7280');
    }
    setCategoryFormOpen(true);
  };

  // Gestão de Categorias: Salvar (Criar / Editar)
  const handleSaveCategoryForm = async () => {
    if (!catName.trim()) {
      toast.error('Informe o nome da categoria.');
      return;
    }
    setSavingCategoryForm(true);
    try {
      if (editingCategoryId) {
        await financialApi.updateCategory(editingCategoryId, {
          name: catName.trim(),
          type: catType as any,
          color: catColor,
        });
        toast.success('Categoria atualizada com sucesso!');
      } else {
        await financialApi.createCategory({
          name: catName.trim(),
          type: catType as any,
          color: catColor,
        });
        toast.success('Categoria criada com sucesso!');
      }
      setCategoryFormOpen(false);
      await loadOverviewAndCategories();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao salvar categoria.');
    } finally {
      setSavingCategoryForm(false);
    }
  };

  // Gestão de Categorias: Arquivar / Reativar
  const handleToggleArchiveCategory = async (cat: FinancialCategoryItem) => {
    try {
      if (cat.isActive === false) {
        await financialApi.reactivateCategory(cat.id);
        toast.success(`Categoria "${cat.name}" reativada com sucesso.`);
      } else {
        await financialApi.archiveCategory(cat.id);
        toast.success(`Categoria "${cat.name}" arquivada com sucesso.`);
      }
      await loadOverviewAndCategories();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Falha ao alterar status da categoria.');
    }
  };

  // Gestão de Categorias: Excluir Categoria com verificação de movimentações
  const handleDeleteCategory = async (cat: FinancialCategoryItem) => {
    try {
      await financialApi.deleteCategory(cat.id);
      toast.success(`Categoria "${cat.name}" excluída com sucesso.`);
      await loadOverviewAndCategories();
    } catch (err: any) {
      if (err.response?.data?.error === 'CATEGORY_HAS_TRANSACTIONS') {
        setCatToMigrate(cat);
        setTargetMigrationCatId('');
        setMigrationModalOpen(true);
      } else {
        toast.error(err.response?.data?.error || 'Não foi possível excluir a categoria.');
      }
    }
  };

  // Gestão de Categorias: Migrar Transações
  const handleMigrateTransactions = async () => {
    if (!catToMigrate || !targetMigrationCatId) {
      toast.error('Selecione a categoria de destino.');
      return;
    }
    setMigrating(true);
    try {
      const res = await financialApi.migrateCategory(catToMigrate.id, targetMigrationCatId);
      toast.success(`${res.migratedCount} movimentações migradas para a nova categoria.`);
      setMigrationModalOpen(false);

      // Agora que as transações foram migradas, tenta excluir a categoria original
      try {
        await financialApi.deleteCategory(catToMigrate.id);
        toast.success(`Categoria "${catToMigrate.name}" excluída após migração.`);
      } catch {
        // Se for sistema, apenas atualiza
      }

      await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Falha ao migrar movimentações.');
    } finally {
      setMigrating(false);
    }
  };

  // Gestão de Regras: Abrir formulário
  const openRuleForm = (rule?: FinancialCategoryRuleItem) => {
    setRulePreview(null);
    if (rule) {
      setEditingRuleId(rule.id);
      setFormRuleCatId(rule.categoryId);
      setFormRuleClientId(rule.clientId || '');
      setFormRuleField(rule.matchField);
      setFormRuleType(rule.matchType);
      setFormRuleValue(rule.matchValueNormalized);
      setFormRulePriority(rule.priority);
      setFormRuleActive(rule.isActive);
    } else {
      setEditingRuleId(null);
      setFormRuleCatId(categories[0]?.id || '');
      setFormRuleClientId('');
      setFormRuleField('DESCRIPTION');
      setFormRuleType('CONTAINS');
      setFormRuleValue('');
      setFormRulePriority(20);
      setFormRuleActive(true);
    }
    setRuleFormOpen(true);
  };

  // Gestão de Regras: Prévia de Impacto
  const handlePreviewRule = async () => {
    if (!formRuleValue.trim()) {
      toast.error('Informe o termo ou padrão da regra.');
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await financialApi.previewCategoryRule({
        matchField: formRuleField,
        matchType: formRuleType,
        matchValue: formRuleValue.trim(),
      });
      setRulePreview(res);
    } catch (err: any) {
      toast.error('Erro ao gerar prévia da regra.');
    } finally {
      setLoadingPreview(false);
    }
  };

  // Gestão de Regras: Salvar Regra
  const handleSaveRule = async () => {
    if (!formRuleValue.trim() || !formRuleCatId) {
      toast.error('Preencha os campos obrigatórios da regra.');
      return;
    }
    setSavingRule(true);
    try {
      if (editingRuleId) {
        await financialApi.updateCategoryRule(editingRuleId, {
          categoryId: formRuleCatId,
          clientId: formRuleClientId || null,
          matchField: formRuleField,
          matchType: formRuleType,
          matchValueNormalized: formRuleValue.trim(),
          priority: formRulePriority,
          isActive: formRuleActive,
        });
        toast.success('Regra atualizada com sucesso!');
      } else {
        await financialApi.createCategoryRule({
          categoryId: formRuleCatId,
          clientId: formRuleClientId || null,
          matchField: formRuleField,
          matchType: formRuleType,
          matchValue: formRuleValue.trim(),
          priority: formRulePriority,
          isActive: formRuleActive,
        });
        toast.success('Regra automática criada com sucesso!');
      }
      setRuleFormOpen(false);
      setEditingRuleId(null);
      setFormRuleClientId('');
      setFormRuleValue('');
      setRulePreview(null);
      await loadRules();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao salvar regra.');
    } finally {
      setSavingRule(false);
    }
  };

  // Gestão de Regras: Ativar / Desativar
  const handleToggleRuleActive = async (rule: FinancialCategoryRuleItem) => {
    try {
      await financialApi.updateCategoryRule(rule.id, { isActive: !rule.isActive });
      toast.success(`Regra ${!rule.isActive ? 'ativada' : 'desativada'} com sucesso.`);
      await loadRules();
    } catch (err: any) {
      toast.error('Falha ao alterar status da regra.');
    }
  };

  // Gestão de Regras: Excluir Regra
  const handleDeleteRule = async (ruleId: string) => {
    try {
      await financialApi.deleteCategoryRule(ruleId);
      toast.success('Regra excluída com sucesso.');
      await loadRules();
    } catch (err: any) {
      toast.error('Erro ao excluir regra.');
    }
  };

  // Gestão de Regras: Aplicar Retroativamente
  const handleApplyRuleRetroactively = async (ruleId: string) => {
    try {
      const res = await financialApi.applyCategoryRule(ruleId);
      toast.success(`${res.appliedCount} transação(ões) pendente(s) classificada(s) pela regra.`);
      await Promise.all([loadOverviewAndCategories(), loadTransactions()]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Erro ao aplicar regra.');
    }
  };

  const interAccount = overview?.accounts.find((a) => a.provider === 'INTER') || overview?.accounts[0];
  const isInterConnected = Boolean(interAccount && (interAccount.lastSyncedAt || interAccount.lastSyncAt));

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
          {/* BOTÃO GERENCIAR CATEGORIAS */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCategoriesModalOpen(true)}
            className="border-white/10 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800 text-xs gap-1.5 h-8"
          >
            <Tag className="w-3.5 h-3.5 text-emerald-400" />
            <span>Gerenciar categorias</span>
          </Button>

          {/* BOTÃO VERIFICAR HORÁRIOS DO INTER (PRÉVIA SOMENTE LEITURA) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckInterTimes}
            disabled={checkingTimes || applyingTimes}
            className="border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 text-xs gap-1.5 h-8"
            title="Consulta o extrato completo analítico sem gravar nada e apresenta contadores de horários reais disponíveis"
          >
            <Clock className={`w-3.5 h-3.5 ${checkingTimes ? 'animate-spin text-purple-300' : 'text-purple-400'}`} />
            <span>{checkingTimes ? 'Consultando analítico...' : 'Verificar Horários Inter'}</span>
          </Button>

          {/* BOTÃO APLICAR HORÁRIOS OFICIAIS (APLICAÇÃO CONTROLADA) */}
          {previewResult && previewResult.withRealTimestamp > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleApplyInterTimes}
              disabled={applyingTimes || checkingTimes}
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs gap-1.5 h-8"
              title="Aplica com segurança os horários reais oficiais vinculados exclusivamente por ID bancário oficial comprovado"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${applyingTimes ? 'animate-spin text-emerald-300' : 'text-emerald-400'}`} />
              <span>{applyingTimes ? 'Aplicando horários...' : 'Aplicar Horários Oficiais'}</span>
            </Button>
          )}

          {/* BOTÃO REPARAR DUPLICATAS / INTEGRIDADE */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenRepairPreview}
            disabled={loadingRepairPreview || repairingDuplicates || syncingInter || reprocessingInter}
            className="border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 text-xs gap-1.5 h-8"
            title="Analisa integridade e remove registros duplicados e fantasmas de R$ 0,00 preservando classificações"
          >
            <ShieldAlert className={`w-3.5 h-3.5 ${loadingRepairPreview || repairingDuplicates ? 'animate-spin text-blue-300' : 'text-blue-400'}`} />
            <span>{loadingRepairPreview ? 'Analisando...' : repairingDuplicates ? 'Reparando...' : 'Reparar Integridade'}</span>
          </Button>

          {/* REPROCESSAR EXTRATO (PROTEÇÃO TEMPORÁRIA PAUSADA) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReprocessInter}
            disabled={true}
            className="border-white/5 bg-zinc-900/30 text-zinc-500 cursor-not-allowed text-xs gap-1.5 h-8 opacity-60"
            title="Atualização temporariamente pausada para validação de integridade do extrato."
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
            <span>Reprocessar Extrato</span>
          </Button>

          {/* SINCRONIZAR INTER PJ (PROTEÇÃO TEMPORÁRIA PAUSADA) */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncInter}
            disabled={true}
            className="border-orange-500/20 bg-orange-500/5 text-orange-400/50 cursor-not-allowed text-xs gap-1.5 h-8 opacity-60"
            title="Atualização temporariamente pausada para validação de integridade do extrato."
          >
            <RefreshCw className="w-3.5 h-3.5 text-orange-400/50" />
            <span>Sincronizar Inter PJ</span>
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
              {isInterConnected ? formatBRL(overview?.periodSummary.operationalIncome) : '—'}
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
              {isInterConnected ? formatBRL(overview?.periodSummary.operationalExpense) : '—'}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">Débitos e despesas pagas pela conta PJ</p>
          </CardContent>
        </Card>

        {/* Fila "Para Revisar" */}
        <Card
          onClick={() => {
            setPendingOnly(!pendingOnly);
            setCurrentPage(1);
          }}
          className={`bg-zinc-950/40 cursor-pointer transition-all ${
            pendingOnly
              ? 'border-amber-500 ring-1 ring-amber-500/50 bg-amber-500/5'
              : (overview?.periodSummary.pendingReviewCount || 0) > 0
              ? 'border-amber-500/40 hover:border-amber-500/80'
              : 'border-white/10'
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
              <span>Para Revisar</span>
              {pendingOnly && <Badge className="bg-amber-500 text-black text-[9px] px-1 py-0 font-bold">Filtro Ativo</Badge>}
            </CardTitle>
            <AlertTriangle className={`w-4 h-4 ${(overview?.periodSummary.pendingReviewCount || 0) > 0 ? 'text-amber-400' : 'text-zinc-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">
              {overview?.periodSummary.pendingReviewCount || 0}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Fila de lançamentos aguardando categorização
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
              <span>{pendingOnly ? 'Para Revisar (Filtro Ativo)' : 'Fila Para Revisar'}</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* 4. TABELA DE EXTRATO UNIFICADO */}
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
                <th className="px-4 py-3 w-28">Data</th>
                <th className="px-4 py-3">Movimentação</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right w-36">Valor</th>
                <th className="px-4 py-3 w-10 text-center"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-zinc-200">
              {loadingTransactions ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-orange-400" />
                    Carregando extrato do Banco Inter PJ...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma movimentação financeira encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const isCredit = tx.direction === 'CREDIT' || (tx.direction as string) === 'INCOME';
                  const isInternal = tx.kind === 'TRANSFER_INTERNAL';

                  // Identificação clara da origem da classificação
                  const sourceBadge = () => {
                    if (tx.categorizationSource === 'AUTO_RULE') {
                      return <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">Automática</span>;
                    }
                    if (tx.categorizationSource === 'MANUAL') {
                      return <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">Manual</span>;
                    }
                    if (tx.categorizationSource === 'PROVIDER') {
                      return <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Banco</span>;
                    }
                    return <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">Para revisar</span>;
                  };

                  return (
                    <tr
                      key={tx.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openDetailsDrawer(tx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openDetailsDrawer(tx);
                        }
                      }}
                      className="group cursor-pointer hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors focus:outline-none focus:bg-white/[0.05]"
                      title="Clique para ver os detalhes da movimentação"
                    >
                      {/* 1. Data */}
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-400 font-mono text-[11px]">
                        {formatDate(tx.occurredAt || tx.transactedAt)}
                      </td>

                      {/* 2. Movimentação (Ícone, Descrição e Contraparte) */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${
                              isInternal
                                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                                : isCredit
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}
                          >
                            {isInternal ? (
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                            ) : isCredit ? (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-white text-xs truncate max-w-sm">
                              {tx.description}
                            </div>
                            {formatCounterpartyDisplay(tx.counterpartyName) !== 'Não informada pelo banco' && (
                              <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                                {formatCounterpartyDisplay(tx.counterpartyName)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 3. Categoria & Cliente discreto */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-1.5">
                            {tx.category ? (
                              <span className="text-xs font-medium text-zinc-200">
                                {tx.category.name}
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-amber-300">
                                Para revisar
                              </span>
                            )}
                            {sourceBadge()}
                          </div>
                          {tx.client ? (
                            <div className="text-[11px] text-emerald-400/90 font-medium flex items-center gap-1">
                              <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>Cliente: <strong>{tx.client.name}</strong></span>
                            </div>
                          ) : tx.suggestedClient ? (
                            <div className="text-[11px] text-amber-300/90 font-medium flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>Sugestão: {tx.suggestedClient.name}</span>
                            </div>
                          ) : null}
                        </div>
                      </td>

                      {/* 4. Valor */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span
                          className={`font-semibold text-xs ${
                            isInternal
                              ? 'text-cyan-300'
                              : isCredit
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {isInternal ? '' : isCredit ? '+ ' : '- '}
                          {formatBRL(tx.amount)}
                        </span>
                      </td>

                      {/* 5. Seta / Chevron suave */}
                      <td className="px-4 py-3 text-center whitespace-nowrap text-zinc-600 group-hover:text-zinc-300 transition-colors">
                        <ChevronRight className="w-4 h-4 mx-auto" />
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-zinc-950/80">
            <div className="text-xs text-zinc-500">
              Página {currentPage} de {totalPages} ({totalCount} lançamentos)
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

      {/* 5. MODAL DE GESTÃO COMPLETA DE CATEGORIAS E REGRAS AUTOMÁTICAS */}
      <Dialog open={categoriesModalOpen} onOpenChange={setCategoriesModalOpen}>
        <DialogContent className="sm:max-w-[720px] bg-zinc-950 border-white/10 text-zinc-100 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-400" />
              Gestão de Categorias e Classificação Automática
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Configure as categorias financeiras da organização e ensine regras para classificação automática de lançamentos.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)} className="w-full mt-2">
            <TabsList className="grid grid-cols-2 bg-zinc-900 border border-white/5">
              <TabsTrigger value="categories" className="text-xs">Categorias</TabsTrigger>
              <TabsTrigger value="rules" className="text-xs">Regras Automáticas</TabsTrigger>
            </TabsList>

            {/* ABA 1: CATEGORIAS */}
            <TabsContent value="categories" className="space-y-4 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={includeArchivedCategories}
                    onCheckedChange={(checked) => setIncludeArchivedCategories(checked)}
                    id="include-archived"
                  />
                  <label htmlFor="include-archived" className="text-xs text-zinc-400 cursor-pointer">
                    Exibir categorias arquivadas
                  </label>
                </div>

                <Button
                  size="sm"
                  onClick={() => openCategoryForm()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5 h-8"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova Categoria
                </Button>
              </div>

              <div className="border border-white/10 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-zinc-900/80 text-zinc-400 uppercase tracking-wider font-medium border-b border-white/5">
                    <tr>
                      <th className="px-3 py-2.5">Categoria</th>
                      <th className="px-3 py-2.5">Tipo</th>
                      <th className="px-3 py-2.5 text-center">Lançamentos</th>
                      <th className="px-3 py-2.5 text-center">Status</th>
                      <th className="px-3 py-2.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-zinc-200">
                    {categories.map((c) => {
                      const isArchived = c.isActive === false;
                      const txCount = c._count?.transactions || 0;

                      return (
                        <tr key={c.id} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2.5 font-medium flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                              style={{ backgroundColor: c.color || '#6b7280' }}
                            />
                            <span className={isArchived ? 'line-through text-zinc-500' : 'text-white'}>
                              {c.name}
                            </span>
                            {c.isSystem && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-zinc-400">
                                Sistema
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-zinc-400">
                            {c.type}
                          </td>
                          <td className="px-3 py-2.5 text-center text-zinc-400">
                            {txCount}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {isArchived ? (
                              <Badge variant="outline" className="bg-zinc-800 text-zinc-500 border-white/5 text-[10px]">
                                Arquivada
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                                Ativa
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right space-x-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openCategoryForm(c)}
                              className="h-7 w-7 text-zinc-400 hover:text-white"
                              title="Editar categoria"
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleToggleArchiveCategory(c)}
                              className="h-7 w-7 text-zinc-400 hover:text-white"
                              title={isArchived ? 'Reativar categoria' : 'Arquivar categoria'}
                            >
                              {isArchived ? <RotateCcw className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                            </Button>

                            {!c.isSystem && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteCategory(c)}
                                className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title={txCount > 0 ? 'Exigirá migração das movimentações vinculadas' : 'Excluir categoria'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* ABA 2: REGRAS AUTOMÁTICAS */}
            <TabsContent value="rules" className="space-y-4 pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-400">
                  Regras avaliadas na sincronização do Banco Inter em ordem de prioridade.
                </p>
                <Button
                  size="sm"
                  onClick={() => openRuleForm()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5 h-8"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova Regra
                </Button>
              </div>

              {loadingRules ? (
                <div className="py-8 text-center text-zinc-500 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-emerald-400" />
                  Carregando regras...
                </div>
              ) : categoryRules.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-xs border border-dashed border-white/10 rounded-lg">
                  Nenhuma regra automática cadastrada. Crie regras para classificar lançamentos recorrentes.
                </div>
              ) : (
                <div className="space-y-2">
                  {categoryRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="p-3 rounded-lg bg-zinc-900/60 border border-white/5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] bg-zinc-800 border-white/10 text-zinc-300">
                            Prioridade: {rule.priority}
                          </Badge>
                          <span className="font-semibold text-white">
                            Se {rule.matchField === 'COUNTERPARTY_NAME' ? 'Favorecido' : rule.matchField === 'COUNTERPARTY_DOCUMENT' ? 'CPF/CNPJ' : 'Descrição'} {rule.matchType === 'EXACT' ? 'for igual a' : 'contiver'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-300 font-mono text-[11px]">
                            "{rule.matchValueNormalized}"
                          </span>
                        </div>
                        <div className="text-zinc-400 flex items-center gap-1 text-[11px]">
                          <span>→ Categoria:</span>
                          <span className="text-zinc-200 font-medium">{rule.category?.name || 'Não definida'}</span>
                          {rule.client && (
                            <Badge variant="outline" className="ml-2 text-[10px] bg-emerald-950/40 border-emerald-500/30 text-emerald-300">
                              Cliente: {rule.client.name}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleApplyRuleRetroactively(rule.id)}
                          className="h-7 text-[10px] bg-zinc-900 border-white/10 text-zinc-300 hover:bg-zinc-800"
                          title="Aplica esta regra a movimentações pendentes de categoria"
                        >
                          Aplicar a Pendentes
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleRuleActive(rule)}
                          className={`h-7 w-7 ${rule.isActive ? 'text-emerald-400' : 'text-zinc-500'}`}
                          title={rule.isActive ? 'Desativar regra' : 'Ativar regra'}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openRuleForm(rule)}
                          className="h-7 w-7 text-zinc-400 hover:text-white"
                          title="Editar regra"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          title="Excluir regra"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-4 border-t border-white/5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCategoriesModalOpen(false)}
              className="text-xs bg-zinc-900 border-white/10"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6. MODAL DE FORMULÁRIO DE CATEGORIA (CRIAR / EDITAR) */}
      <Dialog open={categoryFormOpen} onOpenChange={setCategoryFormOpen}>
        <DialogContent className="sm:max-w-[420px] bg-zinc-950 border-white/10 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              {editingCategoryId ? 'Editar Categoria' : 'Nova Categoria'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Defina o nome, tipo e cor de identificação da categoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="text-zinc-400">Nome da categoria *</label>
              <Input
                type="text"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="Ex: Tráfego Pago ou Consultoria"
                className="h-8 bg-zinc-900 border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-zinc-400">Tipo de movimentação</label>
              <Select value={catType} onValueChange={setCatType}>
                <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                  <SelectItem value="INCOME">Receita / Entrada</SelectItem>
                  <SelectItem value="EXPENSE">Despesa Operacional</SelectItem>
                  <SelectItem value="TAX">Impostos & Tributos</SelectItem>
                  <SelectItem value="FEE">Tarifas Financeiras</SelectItem>
                  <SelectItem value="TRANSFER">Transferência</SelectItem>
                  <SelectItem value="OTHER">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-zinc-400">Cor de exibição</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  className="w-8 h-8 rounded border border-white/10 bg-transparent cursor-pointer"
                />
                <Input
                  type="text"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  className="h-8 bg-zinc-900 border-white/10 text-xs font-mono"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCategoryFormOpen(false)}
              className="text-xs bg-zinc-900 border-white/10"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveCategoryForm}
              disabled={savingCategoryForm}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              {savingCategoryForm ? 'Salvando...' : 'Salvar Categoria'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 7. MODAL DE MIGRAÇÃO DE LANÇAMENTOS (BLOQUEIO DE EXCLUSÃO COM MOVIMENTAÇÕES) */}
      <Dialog open={migrationModalOpen} onOpenChange={setMigrationModalOpen}>
        <DialogContent className="sm:max-w-[460px] bg-zinc-950 border-amber-500/30 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2 text-amber-400">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Exclusão Bloqueada: Movimentações Vinculadas
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400 leading-relaxed">
              A categoria <strong className="text-white">"{catToMigrate?.name}"</strong> possui lançamentos no extrato bancário. Para preservar a integridade histórica dos dados, você deve migrar essas movimentações para outra categoria antes de prosseguir.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="text-zinc-300 font-medium">Selecione a Categoria de Destino para os lançamentos:</label>
              <Select value={targetMigrationCatId} onValueChange={setTargetMigrationCatId}>
                <SelectTrigger className="h-9 bg-zinc-900 border-white/10 text-xs">
                  <SelectValue placeholder="Escolha a categoria destino" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                  {categories
                    .filter((c) => c.id !== catToMigrate?.id && c.isActive !== false)
                    .map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name} ({cat.type})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMigrationModalOpen(false)}
              className="text-xs bg-zinc-900 border-white/10"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleMigrateTransactions}
              disabled={migrating || !targetMigrationCatId}
              className="bg-amber-600 hover:bg-amber-500 text-white text-xs"
            >
              {migrating ? 'Migrando...' : 'Migrar Lançamentos e Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 8. MODAL DE FORMULÁRIO DE REGRA AUTOMÁTICA */}
      <Dialog
        open={ruleFormOpen}
        onOpenChange={(open) => {
          setRuleFormOpen(open);
          if (!open) {
            setEditingRuleId(null);
            setFormRuleClientId('');
            setFormRuleValue('');
            setRulePreview(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px] bg-zinc-950 border-white/10 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              {editingRuleId ? 'Editar Regra Automática' : 'Nova Regra Automática'}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Ensine o Hub a categorizar automaticamente novos lançamentos do Banco Inter.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-zinc-400">Campo a avaliar</label>
                <Select value={formRuleField} onValueChange={(val: any) => setFormRuleField(val)}>
                  <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                    <SelectItem value="DESCRIPTION">Descrição do Lançamento</SelectItem>
                    <SelectItem value="COUNTERPARTY_NAME">Nome do Favorecido/Contraparte</SelectItem>
                    <SelectItem value="COUNTERPARTY_DOCUMENT">CPF / CNPJ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-zinc-400">Tipo de comparação</label>
                <Select value={formRuleType} onValueChange={(val: any) => setFormRuleType(val)}>
                  <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                    <SelectItem value="CONTAINS">Contém o termo</SelectItem>
                    <SelectItem value="EXACT">Exatamente igual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-zinc-400">Texto ou termo a corresponder *</label>
              <Input
                type="text"
                value={formRuleValue}
                onChange={(e) => setFormRuleValue(e.target.value)}
                placeholder="Ex: PNEUTEK, GOOGLE, CLOUD"
                className="h-8 bg-zinc-900 border-white/10 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-zinc-400">Categoria de Destino *</label>
                <Select value={formRuleCatId} onValueChange={setFormRuleCatId}>
                  <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                    {categories
                      .filter((c) => c.isActive !== false)
                      .map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-zinc-400">Prioridade (maior = prioritária)</label>
                <Input
                  type="number"
                  value={formRulePriority}
                  onChange={(e) => setFormRulePriority(parseInt(e.target.value, 10) || 10)}
                  className="h-8 bg-zinc-900 border-white/10 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-zinc-400">Vincular a Cliente (Opcional - para receitas)</label>
                {formRuleClientId && (
                  <button
                    type="button"
                    onClick={() => setFormRuleClientId('')}
                    className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                  >
                    Remover cliente
                  </button>
                )}
              </div>
              <Select
                value={formRuleClientId || 'NONE'}
                onValueChange={(val) => {
                  const chosen = val === 'NONE' ? '' : val;
                  setFormRuleClientId(chosen);
                  if (chosen && (!formRuleCatId || categories.find((c) => c.id === formRuleCatId)?.name === 'Para revisar')) {
                    const revCat = categories.find((c) => c.name.toLowerCase().includes('receita de cliente'));
                    if (revCat) setFormRuleCatId(revCat.id);
                  }
                }}
              >
                <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs text-zinc-200">
                  <SelectValue placeholder="Nenhum cliente (apenas categoria)" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200 max-h-56">
                  <SelectItem value="NONE">Nenhum cliente</SelectItem>
                  {clients.map((cli) => (
                    <SelectItem key={cli.id} value={cli.id}>
                      {cli.name} {cli.document ? `(${cli.document})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePreviewRule}
                disabled={loadingPreview}
                className="text-xs h-7 gap-1 bg-zinc-900 border-white/10 text-zinc-300"
              >
                <Eye className="w-3 h-3" />
                {loadingPreview ? 'Verificando...' : 'Testar Impacto (Prévia)'}
              </Button>

              {rulePreview && (
                <span className="text-[11px] text-emerald-400 font-medium">
                  {rulePreview.totalMatches} transação(ões) encontradas no extrato
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRuleFormOpen(false);
                setEditingRuleId(null);
                setFormRuleClientId('');
                setFormRuleValue('');
                setRulePreview(null);
              }}
              className="text-xs bg-zinc-900 border-white/10"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSaveRule}
              disabled={savingRule}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              {savingRule ? 'Salvando...' : 'Salvar Regra'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE CONFIRMAÇÃO DE REPARO DE INTEGRIDADE */}
      <Dialog open={repairPreviewModalOpen} onOpenChange={setRepairPreviewModalOpen}>
        <DialogContent className="max-w-md bg-zinc-950 border-white/10 text-zinc-100 p-6">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="w-5 h-5 text-blue-400" />
              <DialogTitle className="text-base font-semibold text-white">
                Confirmar Reparo de Integridade
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-zinc-400">
              Prévia de integridade apurada do extrato Banco Inter PJ. Somente duplicatas artificiais comprovadas serão removidas, preservando lançamentos reais e classificações manuais.
            </DialogDescription>
          </DialogHeader>

          {repairPreviewData ? (
            <div className="space-y-3 py-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-white/5 space-y-1">
                  <div className="text-zinc-500 text-[11px]">Registros analisados</div>
                  <div className="text-lg font-bold text-white">{repairPreviewData.scanned}</div>
                </div>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-1">
                  <div className="text-red-400 text-[11px]">Duplicatas comprovadas</div>
                  <div className="text-lg font-bold text-red-300">{repairPreviewData.provenDuplicatesToRemove}</div>
                  <div className="text-[10px] text-red-400/80">serão removidas</div>
                </div>
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <div className="text-emerald-400 text-[11px]">Classificações manuais</div>
                  <div className="text-lg font-bold text-emerald-300">{repairPreviewData.manualClassificationsToPreserve}</div>
                  <div className="text-[10px] text-emerald-400/80">serão preservadas</div>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1">
                  <div className="text-amber-400 text-[11px]">Registros ambíguos</div>
                  <div className="text-lg font-bold text-amber-300">{repairPreviewData.ambiguousRecordsKept}</div>
                  <div className="text-[10px] text-amber-400/80">serão mantidos por segurança</div>
                </div>
              </div>

              {repairPreviewData.provenDuplicatesToRemove === 0 ? (
                repairPreviewData.zeroRecordsCount === 0 && repairPreviewData.ambiguousRecordsKept === 0 ? (
                  <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                    Extrato íntegro: nenhuma linha artificial de R$ 0,00 ou divergência estrutural detectada.
                  </div>
                ) : (
                  <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                    Nenhuma duplicata foi confirmada pelas regras de segurança atuais.
                  </div>
                )
              ) : (
                <div className="p-2.5 rounded-md bg-zinc-900 border border-white/5 text-zinc-400 text-[11px]">
                  Ao confirmar, as {repairPreviewData.provenDuplicatesToRemove} duplicatas de R$ 0,00 comprovadas serão excluídas e as {repairPreviewData.manualClassificationsToPreserve} classificações manuais serão transferidas para os lançamentos reais correspondentes em uma única transação atômica.
                </div>
              )}

              {/* Diagnósticos Técnicos Discretos */}
              {repairPreviewData.repairAlgorithmVersion && (
                <div className="pt-2 border-t border-white/5">
                  <div className="text-[10px] text-zinc-600 font-mono space-y-0.5">
                    <div>v{repairPreviewData.repairAlgorithmVersion} | Diagnóstico Estrito</div>
                    <div className="grid grid-cols-2 gap-x-4">
                      <div>Linhas R$ 0,00 encontradas: {repairPreviewData.zeroRecordsCount}</div>
                      <div>Candidatos reais ({'>'}0): {repairPreviewData.positiveRecordsCount}</div>
                      <div>Pares avaliados: {repairPreviewData.candidatePairsEvaluated}</div>
                      <div>Pares comprovados para remoção: {repairPreviewData.provenDuplicatesToRemove}</div>
                      <div>Ambíguos preservados: {repairPreviewData.ambiguousRecordsKept}</div>
                      <div className="col-span-2 pt-1 font-semibold">Falhas de Correspondência:</div>
                      <div>Por Conta: {repairPreviewData.rejectedByAccount}</div>
                      <div>Por Data: {repairPreviewData.rejectedByDate}</div>
                      <div>Por Direção: {repairPreviewData.rejectedByDirection}</div>
                      <div>Por Título: {repairPreviewData.rejectedByTitle}</div>
                      <div>Por Valor: {repairPreviewData.rejectedByAmount}</div>
                      <div className="col-span-2 pt-1 font-semibold">Match Source:</div>
                      <div>Official ID: {repairPreviewData.matchesByOfficialId}</div>
                      <div>Legacy Amount: {repairPreviewData.matchesByLegacyAmount}</div>
                      <div>Strict Fallback: {repairPreviewData.matchesByStrictFallback}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-zinc-500 text-xs">Carregando dados da prévia...</div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRepairPreviewModalOpen(false)}
              disabled={repairingDuplicates}
              className="text-xs bg-zinc-900 border-white/10"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExecuteConfirmedRepair}
              disabled={repairingDuplicates || !repairPreviewData || repairPreviewData.provenDuplicatesToRemove === 0}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs gap-1.5"
            >
              <ShieldAlert className={`w-3.5 h-3.5 ${repairingDuplicates ? 'animate-spin' : ''}`} />
              <span>{repairingDuplicates ? 'Executando Reparo...' : 'Confirmar e Reparar'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 9. GAVETA LATERAL (SHEET) DE DETALHES DA MOVIMENTAÇÃO */}
      <Sheet open={detailsSheetOpen || editModalOpen} onOpenChange={(open) => {
        setDetailsSheetOpen(open);
        setEditModalOpen(open);
      }}>
        <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl bg-zinc-950 border-l border-white/10 text-zinc-100 p-0 flex flex-col h-full overflow-hidden">
          {selectedTx ? (
            <>
              {/* CABEÇALHO DA GAVETA */}
              {(() => {
                const isCredit = selectedTx.direction === 'CREDIT' || (selectedTx.direction as string) === 'INCOME';
                const isInternal = selectedTx.kind === 'TRANSFER_INTERNAL';
                const interTime = getInterTime(selectedTx);
                const dateDisplay = formatBankDateTimeDisplay(
                  selectedTx.occurredAt || selectedTx.transactedAt,
                  selectedTx.datePrecision,
                  interTime
                );

                return (
                  <SheetHeader className="p-6 border-b border-white/5 bg-zinc-900/30 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isInternal ? (
                          <Badge variant="outline" className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 text-xs">
                            Transferência Interna
                          </Badge>
                        ) : isCredit ? (
                          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-xs">
                            Entrada / Receita
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-500/15 text-red-300 border-red-500/30 text-xs">
                            Saída / Despesa
                          </Badge>
                        )}
                        <Badge variant="outline" className="border-orange-500/30 bg-orange-500/10 text-orange-300 text-xs">
                          Banco Inter PJ
                        </Badge>
                      </div>
                    </div>

                    <div>
                      <div
                        className={`text-3xl font-bold tracking-tight ${
                          isInternal
                            ? 'text-cyan-300'
                            : isCredit
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                      >
                        {isInternal ? '' : isCredit ? '+ ' : '- '}
                        {formatBRL(selectedTx.amount)}
                      </div>
                      <SheetTitle className="text-sm font-semibold text-white mt-1.5 line-clamp-2">
                        {selectedTx.description}
                      </SheetTitle>
                    </div>

                    {/* Metadados temporais com precisão bancária oficial */}
                    <div className="pt-2 border-t border-white/5 space-y-1">
                      {dateDisplay.hasRealTime ? (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-zinc-400">Data bancária:</span>
                          <span className="font-medium text-zinc-200">
                            {dateDisplay.displayWithTime}
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-0.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-400">Data bancária:</span>
                            <span className="font-medium text-zinc-200">
                              {dateDisplay.dateOnly}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-zinc-500 italic text-[11px] pt-0.5">
                            <Clock className="w-3 h-3 text-zinc-600" />
                            <span>Horário ainda não consultado no extrato completo</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </SheetHeader>
                );
              })()}

              {/* CORPO ROLÁVEL COM INFORMAÇÕES PROTEGIDAS E AÇÕES */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
                {/* 1. DADOS PROTEGIDOS DA TRANSAÇÃO */}
                <div className="p-4 rounded-lg bg-zinc-900/50 border border-white/5 space-y-2.5">
                  <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Informações Oficiais do Lançamento
                  </div>
                  <div className="space-y-2 pt-1 text-zinc-300">
                    <div className="flex justify-between items-start gap-4">
                      <span className="text-zinc-500 shrink-0">Descrição oficial:</span>
                      <span className="font-medium text-white text-right">{selectedTx.description}</span>
                    </div>

                    <div className="flex justify-between items-center gap-4">
                      <span className="text-zinc-500 shrink-0">Contraparte:</span>
                      <span className="font-medium text-white text-right">
                        {formatCounterpartyDisplay(selectedTx.counterpartyName)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center gap-4">
                      <span className="text-zinc-500 shrink-0">Documento (CPF/CNPJ):</span>
                      <span className="font-mono text-zinc-300 bg-zinc-950 px-2 py-0.5 rounded border border-white/5">
                        {maskDocument(selectedTx.counterpartyDocument)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center gap-4">
                      <span className="text-zinc-500 shrink-0">Conta bancária:</span>
                      <span className="text-zinc-300">Banco Inter PJ (Conta Corrente)</span>
                    </div>

                    <div className="flex justify-between items-center gap-4">
                      <span className="text-zinc-500 shrink-0">ID / Referência:</span>
                      <span className="font-mono text-[11px] text-zinc-400 truncate max-w-[220px]">
                        {selectedTx.externalReference || selectedTx.externalId}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. BANNER DE SUGESTÃO INTELIGENTE DE CLIENTE */}
                {selectedTx.suggestedClient && !selectedClientId && (
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-xs font-semibold text-amber-200">Sugestão Inteligente de Cliente</div>
                        <div className="text-[11px] text-amber-300/80 leading-relaxed mt-0.5">
                          O nome da contraparte corresponde ao cliente <strong>{selectedTx.suggestedClient.name}</strong> cadastrado no Hub.
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleConfirmSuggestedClient}
                      disabled={savingCategory}
                      className="w-full h-8 text-xs bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30"
                    >
                      <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                      Confirmar {selectedTx.suggestedClient.name} como cliente
                    </Button>
                  </div>
                )}

                {/* 3. VÍNCULO DE CLIENTE (SEPARADO DE CATEGORIA) */}
                <div className="space-y-2 p-4 rounded-lg bg-zinc-900/30 border border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-zinc-200 flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Cliente Vinculado à Receita
                    </label>
                    {selectedClientId && (
                      <button
                        type="button"
                        onClick={() => setSelectedClientId('')}
                        className="text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                      >
                        Desvincular cliente
                      </button>
                    )}
                  </div>
                  <Select
                    value={selectedClientId || 'NONE'}
                    onValueChange={(val) => {
                      const chosenId = val === 'NONE' ? '' : val;
                      setSelectedClientId(chosenId);
                      if (chosenId && (!newCategoryId || categories.find((c) => c.id === newCategoryId)?.name === 'Para revisar')) {
                        const revCat = categories.find((c) => c.name.toLowerCase().includes('receita de cliente'));
                        if (revCat) setNewCategoryId(revCat.id);
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 bg-zinc-900/60 border-white/10 text-xs text-zinc-200">
                      <SelectValue placeholder="Selecione um cliente (ex: Biolab)" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200 max-h-56">
                      <SelectItem value="NONE">Nenhum cliente (manter desvinculado)</SelectItem>
                      {clients.map((cli) => (
                        <SelectItem key={cli.id} value={cli.id}>
                          {cli.name} {cli.document ? `(${maskDocument(cli.document)})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-zinc-500">
                    O cliente identifica a pessoa ou empresa que pagou. A categoria identifica a natureza contábil.
                  </p>

                  {/* Toggle para ensinar próximos recebimentos */}
                  {selectedClientId && (
                    <div className="pt-2 border-t border-white/5">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-300 text-[11px] flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-emerald-400" />
                          Reconhecer próximos recebimentos desta contraparte para este cliente
                        </span>
                        <input
                          type="checkbox"
                          checked={teachFutureClientRule}
                          onChange={(e) => setTeachFutureClientRule(e.target.checked)}
                          className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. CLASSIFICAÇÃO DE CATEGORIA */}
                <div className="space-y-2 p-4 rounded-lg bg-zinc-900/30 border border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="font-medium text-zinc-200 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-emerald-400" />
                      Categoria da Movimentação
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500 text-[10px]">Origem:</span>
                      {selectedTx.categorizationSource === 'AUTO_RULE' ? (
                        <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 text-[9px]">Automática</Badge>
                      ) : selectedTx.categorizationSource === 'MANUAL' ? (
                        <Badge className="bg-purple-500/15 text-purple-300 border-purple-500/30 text-[9px]">Manual</Badge>
                      ) : selectedTx.categorizationSource === 'PROVIDER' ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[9px]">Banco</Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[9px]">Para revisar</Badge>
                      )}
                    </div>
                  </div>

                  <Select value={newCategoryId} onValueChange={setNewCategoryId}>
                    <SelectTrigger className="h-9 bg-zinc-900/60 border-white/10 text-xs text-zinc-200">
                      <SelectValue placeholder="Selecione uma categoria" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200 max-h-56">
                      {categoryOptions.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name} ({cat.type === 'INCOME' ? 'Receita' : cat.type === 'EXPENSE' ? 'Despesa' : 'Outro'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Toggle para criar regra de classificação geral (se não houver cliente vinculado) */}
                  {!selectedClientId && (
                    <div className="pt-2 border-t border-white/5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-300 text-[11px] flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          Criar regra automática para lançamentos semelhantes futuros
                        </span>
                        <input
                          type="checkbox"
                          checked={createRule}
                          onChange={(e) => setCreateRule(e.target.checked)}
                          className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                        />
                      </div>

                      {createRule && (
                        <div className="space-y-2 pt-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-zinc-400">Campo correspondente</label>
                              <Select
                                value={ruleField}
                                onValueChange={(val: any) => setRuleField(val)}
                              >
                                <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                                  <SelectItem value="DESCRIPTION">Descrição da Transação</SelectItem>
                                  <SelectItem value="COUNTERPARTY_NAME">Nome da Contraparte</SelectItem>
                                  <SelectItem value="COUNTERPARTY_DOCUMENT">CPF/CNPJ</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] text-zinc-400">Tipo de comparação</label>
                              <Select
                                value={ruleMatchType}
                                onValueChange={(val: any) => setRuleMatchType(val)}
                              >
                                <SelectTrigger className="h-8 bg-zinc-900 border-white/10 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-white/10 text-zinc-200">
                                  <SelectItem value="CONTAINS">Contém o termo</SelectItem>
                                  <SelectItem value="EXACT">Exatamente igual</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] text-zinc-400">Termo ou texto da regra</label>
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
                  )}
                </div>
              </div>

              {/* RODAPÉ DA GAVETA COM AÇÕES */}
              <SheetFooter className="p-4 border-t border-white/5 bg-zinc-950 flex flex-row items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetailsSheetOpen(false);
                    setEditModalOpen(false);
                  }}
                  className="text-xs bg-zinc-900 border-white/10 hover:bg-zinc-800"
                >
                  Fechar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveCategory}
                  disabled={savingCategory || !newCategoryId}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                >
                  {savingCategory ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
              </SheetFooter>
            </>
          ) : (
            <div className="p-8 text-center text-zinc-500">Nenhuma movimentação selecionada.</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
