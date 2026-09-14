import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Layers,
  Film,
  Image as ImageIcon,
  ExternalLink,
  Eye,
  X,
  SlidersHorizontal,
  LayoutGrid,
  List as ListIcon,
  Sparkles,
  Plus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  postizIntegrationService,
  AggregatedPostizPost,
  AggregatedContentSummary,
} from '@/services/postiz';

import { useAuthStore } from '@/store/useAuthStore';
import { CompositorZafiraModal } from '@/components/content/CompositorZafiraModal';

export default function ConteudosAgenda() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreate = user?.role === 'admin' || user?.role === 'manager';

  // Estado do Compositor Zafira
  const [compositorOpen, setCompositorOpen] = useState<boolean>(false);

  // Mês de navegação (data de referência)
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // Modo de visualização: 'calendar' ou 'list'
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');

  // Filtros
  const [selectedClientId, setSelectedClientId] = useState<string>('ALL');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedFormat, setSelectedFormat] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Estados de dados
  const [posts, setPosts] = useState<AggregatedPostizPost[]>([]);
  const [summary, setSummary] = useState<AggregatedContentSummary>({
    scheduledCount: 0,
    publishedCount: 0,
    errorCount: 0,
    draftCount: 0,
    nextPost: null,
  });
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [accountsList, setAccountsList] = useState<
    { id: string; name: string; platform: string; clientId: string }[]
  >([]);

  // Estados de controle
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Paginação da lista
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 15;

  // Modal para exibir todos os posts de um dia específico
  const [selectedDayPosts, setSelectedDayPosts] = useState<{
    date: Date;
    posts: AggregatedPostizPost[];
  } | null>(null);

  // Calcula início e fim do mês corrente em ISO
  const { startDateIso, endDateIso, monthName, year } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(currentDate);
    const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    return {
      startDateIso: start.toISOString(),
      endDateIso: end.toISOString(),
      monthName: capitalizedMonth,
      year,
    };
  }, [currentDate]);

  // Carrega dados da API do Hub
  const loadData = useCallback(
    async (isForceRefresh = false) => {
      try {
        if (isForceRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const response = await postizIntegrationService.getAggregatedContent({
          startDate: startDateIso,
          endDate: endDateIso,
          clientId: selectedClientId !== 'ALL' ? selectedClientId : undefined,
          integrationId: selectedAccountId !== 'ALL' ? selectedAccountId : undefined,
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          format: selectedFormat !== 'ALL' ? selectedFormat : undefined,
          search: searchQuery.trim() || undefined,
          limit: 0, // Traz todos os posts do período filtrado para exibição contínua
          forceRefresh: isForceRefresh,
        });

        setPosts(response.posts || []);
        setSummary(
          response.summary || {
            scheduledCount: 0,
            publishedCount: 0,
            errorCount: 0,
            draftCount: 0,
            nextPost: null,
          }
        );

        if (response.clients && response.clients.length > 0) {
          setClientsList(response.clients);
        }
        if (response.accounts && response.accounts.length > 0) {
          setAccountsList(response.accounts);
        }

        if (isForceRefresh) {
          toast.success('Conteúdos sincronizados com sucesso!');
        }
      } catch (err: any) {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          'Falha ao carregar conteúdos do Postiz.';
        setError(msg);
        toast.error('Erro na sincronização', {
          description: 'Não foi possível atualizar os conteúdos do Postiz.',
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [startDateIso, endDateIso, selectedClientId, selectedAccountId, selectedStatus, selectedFormat, searchQuery]
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Reset de página quando filtros mudam
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClientId, selectedAccountId, selectedStatus, selectedFormat, searchQuery]);

  // Navegação de mês
  const handlePrevMonth = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  };

  const handleTodayMonth = () => {
    const today = new Date();
    today.setDate(1);
    setCurrentDate(today);
  };

  // Regra unificada de clique no post
  const handlePostClick = (post: AggregatedPostizPost) => {
    if (post.status === 'PUBLISHED' && post.releaseUrl && post.releaseUrl.trim() !== '') {
      window.open(post.releaseUrl, '_blank', 'noopener,noreferrer');
    } else {
      navigate(`/clientes/${post.clientId}/conteudo/${post.id}`, { state: { post } });
    }
  };

  // Formatação de data / hora
  const formatTime = (dateStr?: string | null) => {
    if (!dateStr) return '--:--';
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return '--:--';
    }
  };

  const formatDateFull = (dateStr?: string | null) => {
    if (!dateStr) return 'Sem data';
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Helper de badges
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] gap-1 font-medium"
          >
            <CheckCircle2 className="w-3 h-3" /> Publicado
          </Badge>
        );
      case 'QUEUE':
      case 'SCHEDULED':
        return (
          <Badge
            variant="outline"
            className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] gap-1 font-medium"
          >
            <Clock className="w-3 h-3" /> Agendado
          </Badge>
        );
      case 'DRAFT':
        return (
          <Badge
            variant="outline"
            className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 text-[10px] gap-1 font-medium"
          >
            <FileText className="w-3 h-3" /> Rascunho
          </Badge>
        );
      case 'ERROR':
        return (
          <Badge
            variant="outline"
            className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] gap-1 font-medium"
          >
            <AlertCircle className="w-3 h-3" /> Falhou
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-zinc-800 text-zinc-300 border-white/10 text-[10px]">
            {status}
          </Badge>
        );
    }
  };

  const renderFormatBadge = (post: AggregatedPostizPost) => {
    if (post.isStory) {
      return (
        <Badge
          variant="outline"
          className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px] font-semibold flex items-center gap-1"
        >
          <Sparkles className="w-2.5 h-2.5" /> Story
        </Badge>
      );
    }
    if (post.contentType === 'REEL') {
      return (
        <Badge
          variant="outline"
          className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-[10px] font-semibold flex items-center gap-1"
        >
          <Film className="w-2.5 h-2.5" /> Reel
        </Badge>
      );
    }
    if (post.contentType === 'CAROUSEL' || post.mediaType === 'CAROUSEL') {
      return (
        <Badge
          variant="outline"
          className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-semibold flex items-center gap-1"
        >
          <Layers className="w-2.5 h-2.5" /> Carrossel
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] font-semibold flex items-center gap-1"
      >
        <ImageIcon className="w-2.5 h-2.5" /> Feed
      </Badge>
    );
  };

  const renderPlatformBadge = (platform?: string) => {
    const p = (platform || '').toLowerCase();
    let label = platform || 'Social';
    let colorClass = 'bg-zinc-800 text-zinc-300 border-white/10';

    if (p.includes('instagram')) {
      label = 'Instagram';
      colorClass = 'bg-pink-500/10 text-pink-400 border-pink-500/20';
    } else if (p.includes('linkedin')) {
      label = 'LinkedIn';
      colorClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    } else if (p.includes('youtube')) {
      label = 'YouTube';
      colorClass = 'bg-red-500/10 text-red-400 border-red-500/20';
    } else if (p.includes('tiktok')) {
      label = 'TikTok';
      colorClass = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    } else if (p.includes('facebook')) {
      label = 'Facebook';
      colorClass = 'bg-blue-600/10 text-blue-400 border-blue-600/20';
    }

    return (
      <span
        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border ${colorClass}`}
      >
        {label}
      </span>
    );
  };

  // Construção dos dias para a grade mensal do calendário
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Domingo, 1 = Segunda...

    // Ajusta para semana iniciando na Segunda-feira (0 = Segunda, 6 = Domingo)
    const startOffset = (firstDayOfWeek + 6) % 7;

    const days: Array<{
      date: Date | null;
      dayNumber: number | null;
      isToday: boolean;
      posts: AggregatedPostizPost[];
    }> = [];

    // Preenchimento de dias vazios antes do dia 1
    for (let i = 0; i < startOffset; i++) {
      days.push({
        date: null,
        dayNumber: null,
        isToday: false,
        posts: [],
      });
    }

    const today = new Date();
    const isCurrentYearAndMonth =
      today.getFullYear() === year && today.getMonth() === month;

    // Preenchimento dos dias reais
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const isToday = isCurrentYearAndMonth && today.getDate() === day;

      // Filtra os posts deste dia
      const dayPosts = posts.filter((p) => {
        const rawDate = p.publishedAt || p.scheduledAt || p.createdAt;
        if (!rawDate) return false;
        const pDate = new Date(rawDate);
        return (
          pDate.getFullYear() === year &&
          pDate.getMonth() === month &&
          pDate.getDate() === day
        );
      });

      // Ordena posts do dia por horário crescente
      dayPosts.sort((a, b) => {
        const tA = new Date(a.publishedAt || a.scheduledAt || a.createdAt || 0).getTime();
        const tB = new Date(b.publishedAt || b.scheduledAt || b.createdAt || 0).getTime();
        return tA - tB;
      });

      days.push({
        date,
        dayNumber: day,
        isToday,
        posts: dayPosts,
      });
    }

    return days;
  }, [currentDate, posts]);

  // Lista paginada para o modo Lista
  const pagedListPosts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return posts.slice(start, start + pageSize);
  }, [posts, currentPage, pageSize]);

  const totalListPages = Math.ceil(posts.length / pageSize) || 1;

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-12 max-w-7xl mx-auto">
        {/* ========================================================================= */}
        {/* CABEÇALHO OPERACIONAL */}
        {/* ========================================================================= */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/5 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Conteúdos & Agenda
                </h1>
                <p className="text-sm text-zinc-400">
                  Acompanhe o planejamento e as entregas de conteúdo da agência.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="bg-zinc-900 border-white/10 hover:bg-zinc-800 text-zinc-200 gap-2 h-9 px-3.5"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-purple-400' : ''}`} />
              <span>Atualizar</span>
            </Button>

            {canCreate && (
              <Button
                size="sm"
                onClick={() => setCompositorOpen(true)}
                className="bg-purple-600 hover:bg-purple-500 text-white gap-2 h-9 px-4 font-semibold shadow-md shadow-purple-600/20"
              >
                <Plus className="w-4 h-4" />
                <span>Criar conteúdo</span>
              </Button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* CARDS DE RESUMO OPERACIONAL DO PERÍODO */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Agendados */}
          <Card className="bg-zinc-900/60 border-white/10 backdrop-blur-md">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Agendados / Fila
                </p>
                <div className="text-2xl font-bold text-white tracking-tight">
                  {loading ? (
                    <div className="h-7 w-12 bg-white/10 animate-pulse rounded" />
                  ) : (
                    summary.scheduledCount
                  )}
                </div>
                <p className="text-[11px] text-zinc-500">No período selecionado</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Clock className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          {/* 2. Publicados */}
          <Card className="bg-zinc-900/60 border-white/10 backdrop-blur-md">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Publicados
                </p>
                <div className="text-2xl font-bold text-emerald-400 tracking-tight">
                  {loading ? (
                    <div className="h-7 w-12 bg-white/10 animate-pulse rounded" />
                  ) : (
                    summary.publishedCount
                  )}
                </div>
                <p className="text-[11px] text-zinc-500">Publicações confirmadas</p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          {/* 3. Próxima Publicação */}
          <Card className="bg-zinc-900/60 border-white/10 backdrop-blur-md">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1 min-w-0 pr-2">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Próxima Publicação
                </p>
                {loading ? (
                  <div className="h-7 w-28 bg-white/10 animate-pulse rounded" />
                ) : summary.nextPost ? (
                  <div
                    onClick={() => handlePostClick(summary.nextPost!)}
                    className="cursor-pointer group"
                  >
                    <div className="text-sm font-semibold text-purple-400 group-hover:underline truncate">
                      {formatDateFull(summary.nextPost.scheduledAt || summary.nextPost.createdAt)}
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate">
                      {summary.nextPost.clientName} • {summary.nextPost.accountName}
                    </p>
                  </div>
                ) : (
                  <div>
                    <div className="text-sm font-medium text-zinc-400">Nenhum agendamento</div>
                    <p className="text-[11px] text-zinc-500">Sem post na fila</p>
                  </div>
                )}
              </div>
              <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          {/* 4. Atenção necessária / Falhas */}
          <Card
            className={`bg-zinc-900/60 border-white/10 backdrop-blur-md ${
              summary.errorCount > 0 ? 'border-red-500/30 bg-red-950/10' : ''
            }`}
          >
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Atenção / Falhas
                </p>
                <div
                  className={`text-2xl font-bold tracking-tight ${
                    summary.errorCount > 0 ? 'text-red-400' : 'text-zinc-300'
                  }`}
                >
                  {loading ? (
                    <div className="h-7 w-12 bg-white/10 animate-pulse rounded" />
                  ) : (
                    summary.errorCount
                  )}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {summary.errorCount > 0 ? 'Requer atenção operacional' : 'Nenhuma falha ativa'}
                </p>
              </div>
              <div
                className={`p-3 rounded-xl border ${
                  summary.errorCount > 0
                    ? 'bg-red-500/20 text-red-400 border-red-500/30'
                    : 'bg-zinc-800/80 text-zinc-400 border-white/5'
                }`}
              >
                <AlertCircle className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ========================================================================= */}
        {/* BARRA DE NAVEGAÇÃO TEMPORAL E FILTROS */}
        {/* ========================================================================= */}
        <Card className="bg-zinc-900/70 border-white/10 backdrop-blur-md">
          <CardContent className="p-4 space-y-4">
            {/* Linha superior: Navegação de Mês + Alternador Calendário/Lista */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handlePrevMonth}
                  className="h-8 w-8 bg-zinc-800 border-white/10 hover:bg-zinc-700 text-zinc-300"
                  title="Mês anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="px-3 py-1 bg-zinc-800/80 rounded-md border border-white/10 text-sm font-semibold text-white min-w-[160px] text-center">
                  {monthName} de {year}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleNextMonth}
                  className="h-8 w-8 bg-zinc-800 border-white/10 hover:bg-zinc-700 text-zinc-300"
                  title="Próximo mês"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleTodayMonth}
                  className="h-8 text-xs text-zinc-400 hover:text-white"
                >
                  Hoje
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <div className="bg-zinc-800/90 p-1 rounded-lg border border-white/10 flex items-center">
                  <Button
                    variant={viewMode === 'calendar' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('calendar')}
                    className={`h-7 px-3 text-xs gap-1.5 ${
                      viewMode === 'calendar'
                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Calendário
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={`h-7 px-3 text-xs gap-1.5 ${
                      viewMode === 'list'
                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <ListIcon className="w-3.5 h-3.5" />
                    Lista
                  </Button>
                </div>
              </div>
            </div>

            {/* Linha de Filtros Combináveis */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Filtro: Cliente */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Cliente
                </label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger className="bg-zinc-800/80 border-white/10 text-xs h-9">
                    <SelectValue placeholder="Todos os clientes" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    <SelectItem value="ALL">Todos os clientes</SelectItem>
                    {clientsList.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro: Conta / Canal */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Conta Social
                </label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger className="bg-zinc-800/80 border-white/10 text-xs h-9">
                    <SelectValue placeholder="Todas as contas" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    <SelectItem value="ALL">Todas as contas</SelectItem>
                    {accountsList.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name} ({acc.platform || 'Social'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro: Status */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Status
                </label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="bg-zinc-800/80 border-white/10 text-xs h-9">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    <SelectItem value="ALL">Todos os status</SelectItem>
                    <SelectItem value="QUEUE">Agendados / Na fila</SelectItem>
                    <SelectItem value="PUBLISHED">Publicados</SelectItem>
                    <SelectItem value="DRAFT">Rascunhos</SelectItem>
                    <SelectItem value="ERROR">Falhas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro: Formato */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Formato
                </label>
                <Select value={selectedFormat} onValueChange={setSelectedFormat}>
                  <SelectTrigger className="bg-zinc-800/80 border-white/10 text-xs h-9">
                    <SelectValue placeholder="Todos os formatos" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    <SelectItem value="ALL">Todos os formatos</SelectItem>
                    <SelectItem value="STORY">Story</SelectItem>
                    <SelectItem value="REEL">Reel</SelectItem>
                    <SelectItem value="FEED">Feed</SelectItem>
                    <SelectItem value="CAROUSEL">Carrossel</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro: Busca */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Busca
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                  <Input
                    placeholder="Legenda, cliente..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 bg-zinc-800/80 border-white/10 text-xs h-9 text-white placeholder:text-zinc-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ========================================================================= */}
        {/* CONTEÚDO PRINCIPAL: CALENDÁRIO OU LISTA */}
        {/* ========================================================================= */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-4 bg-zinc-900/30 rounded-2xl border border-white/5">
            <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
            <p className="text-sm text-zinc-400">Carregando conteúdos e agenda...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-2xl bg-red-950/20 border border-red-500/20 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-sm font-semibold text-red-300">Falha na sincronização dos conteúdos</p>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(true)}
              className="bg-zinc-900 border-red-500/30 text-red-300 hover:bg-zinc-800 mt-2"
            >
              Tentar novamente
            </Button>
          </div>
        ) : posts.length === 0 ? (
          <div className="p-16 rounded-2xl bg-zinc-900/40 border border-white/5 text-center space-y-4">
            <div className="p-3 bg-zinc-800/80 rounded-full w-fit mx-auto text-zinc-400 border border-white/5">
              <CalendarDays className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-white">Nenhum conteúdo encontrado</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                Não há publicações cadastradas para o período ou filtros selecionados nas contas Postiz vinculadas.
              </p>
            </div>
            {(selectedClientId !== 'ALL' ||
              selectedAccountId !== 'ALL' ||
              selectedStatus !== 'ALL' ||
              selectedFormat !== 'ALL' ||
              searchQuery.trim()) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedClientId('ALL');
                  setSelectedAccountId('ALL');
                  setSelectedStatus('ALL');
                  setSelectedFormat('ALL');
                  setSearchQuery('');
                }}
                className="bg-zinc-800 border-white/10 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Limpar filtros
              </Button>
            )}
          </div>
        ) : viewMode === 'calendar' ? (
          /* ----------------------------------------------------------------------- */
          /* MODO CALENDÁRIO */
          /* ----------------------------------------------------------------------- */
          <div className="space-y-2">
            {/* Dias da semana */}
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-zinc-400 uppercase tracking-wider py-1">
              <div>Seg</div>
              <div>Ter</div>
              <div>Qua</div>
              <div>Qui</div>
              <div>Sex</div>
              <div className="text-purple-400">Sáb</div>
              <div className="text-purple-400">Dom</div>
            </div>

            {/* Grade de dias */}
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((cell, idx) => {
                if (!cell.dayNumber) {
                  return (
                    <div
                      key={`empty-${idx}`}
                      className="min-h-[120px] rounded-xl bg-zinc-900/10 border border-white/[0.02]"
                    />
                  );
                }

                const hasPosts = cell.posts.length > 0;
                const visiblePosts = cell.posts.slice(0, 3);
                const remainingCount = cell.posts.length - visiblePosts.length;

                return (
                  <div
                    key={`day-${cell.dayNumber}`}
                    className={`min-h-[120px] p-2 rounded-xl border flex flex-col justify-between transition-colors ${
                      cell.isToday
                        ? 'bg-purple-950/20 border-purple-500/40 shadow-sm shadow-purple-500/5'
                        : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
                    }`}
                  >
                    {/* Cabeçalho do dia */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          cell.isToday
                            ? 'bg-purple-500 text-white'
                            : 'text-zinc-400'
                        }`}
                      >
                        {cell.dayNumber}
                      </span>
                      {hasPosts && (
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {cell.posts.length} {cell.posts.length === 1 ? 'post' : 'posts'}
                        </span>
                      )}
                    </div>

                    {/* Lista de cards compactos */}
                    <div className="space-y-1.5 flex-1">
                      {visiblePosts.map((post) => (
                        <div
                          key={post.id}
                          onClick={() => handlePostClick(post)}
                          className="group p-1.5 rounded-md bg-zinc-800/80 hover:bg-zinc-700/90 border border-white/5 hover:border-purple-500/40 cursor-pointer transition-all space-y-1"
                          title={`${post.clientName} • ${post.accountName}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] font-mono font-medium text-zinc-300">
                              {formatTime(post.scheduledAt || post.publishedAt || post.createdAt)}
                            </span>
                            {renderFormatBadge(post)}
                          </div>
                          <div className="text-[11px] font-semibold text-white truncate group-hover:text-purple-300">
                            {post.clientName}
                          </div>
                          <div className="flex items-center justify-between gap-1 pt-0.5">
                            {renderPlatformBadge(post.platform)}
                            {renderStatusBadge(post.status)}
                          </div>
                        </div>
                      ))}

                      {/* Botão +X para dias com muitos conteúdos */}
                      {remainingCount > 0 && (
                        <button
                          onClick={() =>
                            setSelectedDayPosts({
                              date: cell.date!,
                              posts: cell.posts,
                            })
                          }
                          className="w-full py-1 text-[11px] text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded border border-purple-500/20 font-medium transition-colors"
                        >
                          +{remainingCount} mais
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ----------------------------------------------------------------------- */
          /* MODO LISTA */
          /* ----------------------------------------------------------------------- */
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-zinc-900/60 overflow-hidden backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-zinc-800/50 text-zinc-400 uppercase tracking-wider font-semibold">
                      <th className="p-3 w-14 text-center">Prévia</th>
                      <th className="p-3">Data / Horário</th>
                      <th className="p-3">Cliente</th>
                      <th className="p-3">Conta Social</th>
                      <th className="p-3">Formato</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 max-w-xs">Legenda</th>
                      <th className="p-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {pagedListPosts.map((post) => (
                      <tr
                        key={post.id}
                        onClick={() => handlePostClick(post)}
                        className="hover:bg-zinc-800/40 cursor-pointer transition-colors group"
                      >
                        {/* Prévia / Miniatura */}
                        <td className="p-3 text-center">
                          <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-white/10 overflow-hidden flex items-center justify-center relative mx-auto">
                            {post.mediaThumbnailUrl ? (
                              <img
                                src={post.mediaThumbnailUrl}
                                alt="Thumb"
                                className="w-full h-full object-cover"
                              />
                            ) : post.mediaType === 'VIDEO' || post.contentType === 'REEL' ? (
                              <Film className="w-4 h-4 text-rose-400" />
                            ) : post.contentType === 'CAROUSEL' ? (
                              <Layers className="w-4 h-4 text-emerald-400" />
                            ) : post.isStory ? (
                              <Sparkles className="w-4 h-4 text-purple-400" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-zinc-500" />
                            )}
                          </div>
                        </td>

                        {/* Data e Horário */}
                        <td className="p-3 whitespace-nowrap">
                          <div className="font-semibold text-white group-hover:text-purple-300">
                            {post.status === 'DRAFT'
                              ? 'Sem agendamento'
                              : formatDateFull(post.scheduledAt || post.publishedAt || post.createdAt)}
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            {post.status === 'PUBLISHED'
                              ? 'Publicado'
                              : post.status === 'DRAFT'
                              ? 'Rascunho'
                              : post.status === 'ERROR'
                              ? 'Falha'
                              : 'Agendado'}
                          </span>
                        </td>

                        {/* Cliente */}
                        <td className="p-3 font-semibold text-white whitespace-nowrap">
                          {post.clientName}
                        </td>

                        {/* Conta e Plataforma */}
                        <td className="p-3 whitespace-nowrap space-y-1">
                          <div className="text-zinc-300 font-medium">{post.accountName}</div>
                          {renderPlatformBadge(post.platform)}
                        </td>

                        {/* Formato */}
                        <td className="p-3 whitespace-nowrap">
                          {renderFormatBadge(post)}
                        </td>

                        {/* Status */}
                        <td className="p-3 whitespace-nowrap">
                          {renderStatusBadge(post.status)}
                        </td>

                        {/* Legenda (exceto para Story conforme regra explícita) */}
                        <td className="p-3 max-w-xs text-zinc-300">
                          {post.isStory ? (
                            <span className="text-zinc-500 italic text-[11px]">
                              Story (sem legenda)
                            </span>
                          ) : (
                            <p className="line-clamp-2 text-[11px] leading-relaxed">
                              {post.content}
                            </p>
                          )}
                        </td>

                        {/* Ação */}
                        <td className="p-3 text-right whitespace-nowrap">
                          {post.status === 'PUBLISHED' && post.releaseUrl ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 gap-1.5"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Ver post
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 gap-1.5"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Prévia
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Paginação da lista */}
            {totalListPages > 1 && (
              <div className="flex items-center justify-between text-xs text-zinc-400 px-2">
                <div>
                  Mostrando {(currentPage - 1) * pageSize + 1} a{' '}
                  {Math.min(currentPage * pageSize, posts.length)} de {posts.length} conteúdos
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="h-8 bg-zinc-800 border-white/10 hover:bg-zinc-700 text-zinc-300"
                  >
                    Anterior
                  </Button>
                  <span className="px-2 font-medium text-white">
                    Página {currentPage} de {totalListPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalListPages, p + 1))}
                    disabled={currentPage === totalListPages}
                    className="h-8 bg-zinc-800 border-white/10 hover:bg-zinc-700 text-zinc-300"
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL PARA DETALHE DE CONTEÚDOS DO DIA (+X) */}
        {/* ========================================================================= */}
        {/* Modal de Detalhes do Dia */}
        <Dialog
          open={!!selectedDayPosts}
          onOpenChange={(open) => !open && setSelectedDayPosts(null)}
        >
          <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-purple-400" />
                Conteúdos de{' '}
                {selectedDayPosts?.date
                  ? new Intl.DateTimeFormat('pt-BR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    }).format(selectedDayPosts.date)
                  : ''}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {selectedDayPosts?.posts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => {
                    setSelectedDayPosts(null);
                    handlePostClick(post);
                  }}
                  className="p-3 rounded-xl bg-zinc-900 border border-white/5 hover:border-purple-500/40 cursor-pointer transition-all flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-xs font-mono font-semibold text-purple-400">
                      {formatTime(post.scheduledAt || post.publishedAt || post.createdAt)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white group-hover:text-purple-300 truncate">
                        {post.clientName}
                      </div>
                      <div className="text-xs text-zinc-400 truncate">
                        {post.accountName}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {renderFormatBadge(post)}
                    {renderStatusBadge(post.status)}
                    {post.status === 'PUBLISHED' && post.releaseUrl ? (
                      <ExternalLink className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-purple-400" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Compositor Zafira de Conteúdo (Admin & Manager) */}
        <CompositorZafiraModal
          open={compositorOpen}
          onOpenChange={setCompositorOpen}
          clientsList={clientsList}
          initialClientId={selectedClientId !== 'ALL' ? selectedClientId : undefined}
          onSuccess={() => {
            loadData(true);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
