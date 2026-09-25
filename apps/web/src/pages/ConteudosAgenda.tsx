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
  LayoutGrid,
  List as ListIcon,
  Sparkles,
  Plus,
  Loader2,
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
  TooltipProvider,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import {
  AggregatedSocialPost,
  SocialContentFormat,
  SocialPostStatus,
  socialPublisherService,
  getSocialErrorMessage,
} from '@/services/social-publisher';
import { clientsService } from '@/services/clients';
import { useAuthStore } from '@/store/useAuthStore';
import { CompositorZafiraModal } from '@/components/content/CompositorZafiraModal';

interface AgendaSummary {
  scheduledCount: number;
  publishedCount: number;
  errorCount: number;
  draftCount: number;
  nextPost: AggregatedSocialPost | null;
}

export default function ConteudosAgenda() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreate = user?.role === 'admin' || user?.role === 'manager';

  // Estado do Compositor Zafira
  const [compositorOpen, setCompositorOpen] = useState<boolean>(false);

  // MÃªs de navegaÃ§Ã£o (data de referÃªncia)
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // Modo de visualizaÃ§Ã£o: 'calendar' ou 'list'
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');

  // Filtros
  const [selectedClientId, setSelectedClientId] = useState<string>('ALL');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedFormat, setSelectedFormat] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Estados de dados
  const [posts, setPosts] = useState<AggregatedSocialPost[]>([]);
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [accountsList, setAccountsList] = useState<
    { id: string; name: string; platform: string; clientId: string }[]
  >([]);

  // Estados de controle
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // PaginaÃ§Ã£o da lista
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 15;

  // Modal para exibir todos os posts de um dia especÃ­fico
  const [selectedDayPosts, setSelectedDayPosts] = useState<{
    date: Date;
    posts: AggregatedSocialPost[];
  } | null>(null);

  // Calcula inÃ­cio e fim do mÃªs corrente em ISO
  const { startDateIso, endDateIso, monthName, year } = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();

    const start = new Date(y, m, 1, 0, 0, 0, 0);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);

    const mName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(currentDate);
    const capitalizedMonth = mName.charAt(0).toUpperCase() + mName.slice(1);

    return {
      startDateIso: start.toISOString(),
      endDateIso: end.toISOString(),
      monthName: capitalizedMonth,
      year: y,
    };
  }, [currentDate]);

  // Carrega dados da API canÃ´nica do Hub
  const loadData = useCallback(
    async (isForceRefresh = false) => {
      try {
        if (isForceRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const [contentPosts, clients, accounts] = await Promise.all([
          socialPublisherService.getAllAggregatedContent({
            startDate: startDateIso,
            endDate: endDateIso,
            clientId: selectedClientId !== 'ALL' ? selectedClientId : undefined,
            accountId: selectedAccountId !== 'ALL' ? selectedAccountId : undefined,
            status: selectedStatus !== 'ALL' ? (selectedStatus as SocialPostStatus) : undefined,
            format: selectedFormat !== 'ALL' ? (selectedFormat as SocialContentFormat) : undefined,
            search: searchQuery.trim() || undefined,
          }),
          clientsService.listClients().catch(() => []),
          socialPublisherService.getAvailableAccounts().catch(() => []),
        ]);

        setPosts(contentPosts);

        if (clients && clients.length > 0) {
          setClientsList(clients.map((c) => ({ id: c.id, name: c.name })));
        }
        if (accounts && accounts.length > 0) {
          const linkedAccounts = accounts.filter((a) => a.isLinked);
          setAccountsList(
            linkedAccounts.map((a) => ({
              id: a.id,
              name: a.displayName || a.username || 'Conta social',
              platform: a.platform,
              clientId: a.linkedClientId || '',
            }))
          );
        }

        if (isForceRefresh) {
          toast.success('ConteÃºdos sincronizados com sucesso!');
        }
      } catch (err: any) {
        const msg = getSocialErrorMessage(err, 'Falha ao carregar conteÃºdos da integraÃ§Ã£o social.');
        setError(msg);
        toast.error('Erro na sincronizaÃ§Ã£o', {
          description: 'NÃ£o foi possÃ­vel atualizar os conteÃºdos.',
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

  // Reset de pÃ¡gina quando filtros mudam
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedClientId, selectedAccountId, selectedStatus, selectedFormat, searchQuery]);

  // Contas filtradas conforme cliente selecionado
  const visibleAccounts = useMemo(() => {
    if (selectedClientId === 'ALL') return accountsList;
    return accountsList.filter((a) => a.clientId === selectedClientId);
  }, [accountsList, selectedClientId]);

  // Reset de conta caso mude o cliente e a conta selecionada nÃ£o pertenÃ§a mais a ele
  useEffect(() => {
    if (selectedClientId !== 'ALL' && selectedAccountId !== 'ALL') {
      const match = accountsList.find((a) => a.id === selectedAccountId);
      if (match && match.clientId !== selectedClientId) {
        setSelectedAccountId('ALL');
      }
    }
  }, [selectedClientId, selectedAccountId, accountsList]);

  // Resumo canÃ´nico calculado no frontend
  const summary: AgendaSummary = useMemo(() => {
    let scheduledCount = 0;
    let publishedCount = 0;
    let errorCount = 0;
    let draftCount = 0;
    let nextPost: AggregatedSocialPost | null = null;
    const nowTime = Date.now();

    for (const p of posts) {
      if (p.status === 'SCHEDULED') {
        scheduledCount++;
        if (p.scheduledAt) {
          const schedTime = new Date(p.scheduledAt).getTime();
          if (schedTime >= nowTime) {
            if (!nextPost || !nextPost.scheduledAt || schedTime < new Date(nextPost.scheduledAt).getTime()) {
              nextPost = p;
            }
          }
        }
      } else if (p.status === 'PUBLISHED') {
        publishedCount++;
      } else if (p.status === 'FAILED' || p.status === 'PARTIALLY_PUBLISHED') {
        errorCount++;
      } else if (p.status === 'DRAFT') {
        draftCount++;
      }
    }

    return {
      scheduledCount,
      publishedCount,
      errorCount,
      draftCount,
      nextPost,
    };
  }, [posts]);

  // NavegaÃ§Ã£o de mÃªs
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
  const handlePostClick = (post: AggregatedSocialPost) => {
    if (post.status === 'PUBLISHED' && post.releaseUrl && post.releaseUrl.trim() !== '') {
      window.open(post.releaseUrl, '_blank', 'noopener,noreferrer');
    } else {
      navigate(`/clientes/${post.clientId}/conteudo/${post.id}`, { state: { post } });
    }
  };

  // FormataÃ§Ã£o de data / hora
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

  // Helper de badges de status canÃ´nicos
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
      case 'PUBLISHING':
        return (
          <Badge
            variant="outline"
            className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] gap-1 font-medium"
          >
            <Loader2 className="w-3 h-3 animate-spin" /> Publicando
          </Badge>
        );
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
      case 'PARTIALLY_PUBLISHED':
        return (
          <Badge
            variant="outline"
            className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] gap-1 font-medium"
          >
            <AlertCircle className="w-3 h-3" /> Publicado parcialmente
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge
            variant="outline"
            className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] gap-1 font-medium"
          >
            <AlertCircle className="w-3 h-3" /> Falhou
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge
            variant="outline"
            className="bg-zinc-700/20 text-zinc-400 border-zinc-600/30 text-[10px] gap-1 font-medium"
          >
            <AlertCircle className="w-3 h-3" /> Cancelado
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

  // Helper de badges de formato canÃ´nicos
  const renderFormatBadge = (post: AggregatedSocialPost) => {
    switch (post.format) {
      case 'STORY_IMAGE':
      case 'STORY_VIDEO':
        return (
          <Badge
            variant="outline"
            className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px] font-semibold flex items-center gap-1"
          >
            <Sparkles className="w-2.5 h-2.5" /> Story
          </Badge>
        );
      case 'REEL':
        return (
          <Badge
            variant="outline"
            className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-[10px] font-semibold flex items-center gap-1"
          >
            <Film className="w-2.5 h-2.5" /> Reel
          </Badge>
        );
      case 'CAROUSEL':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-semibold flex items-center gap-1"
          >
            <Layers className="w-2.5 h-2.5" /> Carrossel
          </Badge>
        );
      case 'FEED':
      default:
        return (
          <Badge
            variant="outline"
            className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] font-semibold flex items-center gap-1"
          >
            <ImageIcon className="w-2.5 h-2.5" /> Feed
          </Badge>
        );
    }
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

  // ConstruÃ§Ã£o dos dias para a grade mensal do calendÃ¡rio
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(year, currentDate.getMonth() + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, currentDate.getMonth(), 1).getDay();

    // Ajusta para semana iniciando na Segunda-feira (0 = Segunda, 6 = Domingo)
    const startOffset = (firstDayOfWeek + 6) % 7;

    const days: Array<{
      date: Date | null;
      dayNumber: number | null;
      isToday: boolean;
      posts: AggregatedSocialPost[];
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
      today.getFullYear() === year && today.getMonth() === currentDate.getMonth();

    // Preenchimento dos dias reais
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, currentDate.getMonth(), day);
      const isToday = isCurrentYearAndMonth && today.getDate() === day;

      const dayPosts = posts.filter((p) => {
        const rawDate = p.publishedAt || p.scheduledAt || p.createdAt;
        if (!rawDate) return false;
        const pDate = new Date(rawDate);
        return (
          pDate.getFullYear() === year &&
          pDate.getMonth() === currentDate.getMonth() &&
          pDate.getDate() === day
        );
      });

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
  }, [currentDate, posts, year]);

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
        {/* CABEÃ‡ALHO OPERACIONAL */}
        {/* ========================================================================= */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-white/5 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <CalendarDays className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  ConteÃºdos & Agenda
                </h1>
                <p className="text-sm text-zinc-400">
                  Acompanhe o planejamento e as entregas de conteÃºdo da agÃªncia.
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
                <span>Criar conteÃºdo</span>
              </Button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* CARDS DE RESUMO OPERACIONAL DO PERÃODO */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Agendados */}
          <Card className="bg-zinc-900/60 border-white/10 backdrop-blur-md">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Agendados
                </p>
                <div className="text-2xl font-bold text-white tracking-tight">
                  {loading ? (
                    <div className="h-7 w-12 bg-white/10 animate-pulse rounded" />
                  ) : (
                    summary.scheduledCount
                  )}
                </div>
                <p className="text-[11px] text-zinc-500">No perÃ­odo selecionado</p>
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
                <p className="text-[11px] text-zinc-500">PublicaÃ§Ãµes confirmadas</p>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          {/* 3. PrÃ³xima PublicaÃ§Ã£o */}
          <Card className="bg-zinc-900/60 border-white/10 backdrop-blur-md">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1 min-w-0 pr-2">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  PrÃ³xima PublicaÃ§Ã£o
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
                      {summary.nextPost.clientName} â€¢ {summary.nextPost.accountName}
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

          {/* 4. Falhas e AtenÃ§Ã£o */}
          <Card
            className={`bg-zinc-900/60 border-white/10 backdrop-blur-md ${
              summary.errorCount > 0 ? 'border-red-500/30 bg-red-950/10' : ''
            }`}
          >
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  AtenÃ§Ã£o / Falhas
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
                  {summary.errorCount > 0 ? 'Requer atenÃ§Ã£o operacional' : 'Nenhuma falha ativa'}
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
        {/* BARRA DE NAVEGAÃ‡ÃƒO TEMPORAL E FILTROS */}
        {/* ========================================================================= */}
        <Card className="bg-zinc-900/70 border-white/10 backdrop-blur-md">
          <CardContent className="p-4 space-y-4">
            {/* Linha superior: NavegaÃ§Ã£o de MÃªs + Alternador CalendÃ¡rio/Lista */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handlePrevMonth}
                  className="h-8 w-8 bg-zinc-800 border-white/10 hover:bg-zinc-700 text-zinc-300"
                  title="MÃªs anterior"
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
                  title="PrÃ³ximo mÃªs"
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
                    CalendÃ¡rio
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

            {/* Linha de Filtros CombinÃ¡veis */}
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

              {/* Filtro: Conta Social */}
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
                    {visibleAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name} ({acc.platform || 'Social'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro: Status CanÃ´nico */}
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
                    <SelectItem value="SCHEDULED">Agendados</SelectItem>
                    <SelectItem value="PUBLISHED">Publicados</SelectItem>
                    <SelectItem value="PUBLISHING">Publicando</SelectItem>
                    <SelectItem value="DRAFT">Rascunhos</SelectItem>
                    <SelectItem value="PARTIALLY_PUBLISHED">Publicado parcialmente</SelectItem>
                    <SelectItem value="FAILED">Falhas</SelectItem>
                    <SelectItem value="CANCELLED">Cancelados</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Filtro: Formato CanÃ´nico */}
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
                    <SelectItem value="FEED">Feed</SelectItem>
                    <SelectItem value="REEL">Reel</SelectItem>
                    <SelectItem value="CAROUSEL">Carrossel</SelectItem>
                    <SelectItem value="STORY_IMAGE">Story (Imagem)</SelectItem>
                    <SelectItem value="STORY_VIDEO">Story (VÃ­deo)</SelectItem>
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
        {/* CONTEÃšDO PRINCIPAL: CALENDÃRIO OU LISTA */}
        {/* ========================================================================= */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-4 bg-zinc-900/30 rounded-2xl border border-white/5">
            <RefreshCw className="w-8 h-8 animate-spin text-purple-400" />
            <p className="text-sm text-zinc-400">Carregando conteÃºdos e agenda...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-2xl bg-red-950/20 border border-red-500/20 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-sm font-semibold text-red-300">Falha na sincronizaÃ§Ã£o dos conteÃºdos</p>
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
              <h3 className="text-base font-semibold text-white">Nenhum conteÃºdo encontrado</h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto">
                NÃ£o hÃ¡ publicaÃ§Ãµes cadastradas para o perÃ­odo ou filtros selecionados nas contas sociais vinculadas.
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
          /* MODO CALENDÃRIO */
          /* ----------------------------------------------------------------------- */
          <div className="space-y-2">
            {/* Dias da semana */}
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-zinc-400 uppercase tracking-wider py-1">
              <div>Seg</div>
              <div>Ter</div>
              <div>Qua</div>
              <div>Qui</div>
              <div>Sex</div>
              <div className="text-purple-400">SÃ¡b</div>
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
                    {/* CabeÃ§alho do dia */}
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
                          title={`${post.clientName} â€¢ ${post.accountName}`}
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

                      {/* BotÃ£o +X para dias com muitos conteÃºdos */}
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
                      <th className="p-3 w-14 text-center">PrÃ©via</th>
                      <th className="p-3">Data / HorÃ¡rio</th>
                      <th className="p-3">Cliente</th>
                      <th className="p-3">Conta Social</th>
                      <th className="p-3">Formato</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 max-w-xs">Legenda</th>
                      <th className="p-3 text-right">AÃ§Ã£o</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {pagedListPosts.map((post) => (
                      <tr
                        key={post.id}
                        onClick={() => handlePostClick(post)}
                        className="hover:bg-zinc-800/40 cursor-pointer transition-colors group"
                      >
                        {/* PrÃ©via / Miniatura */}
                        <td className="p-3 text-center">
                          <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-white/10 overflow-hidden flex items-center justify-center relative mx-auto">
                            {post.mediaThumbnailUrl ? (
                              <img
                                src={post.mediaThumbnailUrl}
                                alt="Thumb"
                                className="w-full h-full object-cover"
                              />
                            ) : post.format === 'REEL' ? (
                              <Film className="w-4 h-4 text-rose-400" />
                            ) : post.format === 'CAROUSEL' ? (
                              <Layers className="w-4 h-4 text-emerald-400" />
                            ) : post.format === 'STORY_IMAGE' || post.format === 'STORY_VIDEO' ? (
                              <Sparkles className="w-4 h-4 text-purple-400" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-zinc-500" />
                            )}
                          </div>
                        </td>

                        {/* Data e HorÃ¡rio */}
                        <td className="p-3 whitespace-nowrap">
                          <div className="font-semibold text-white group-hover:text-purple-300">
                            {post.status === 'DRAFT'
                              ? 'Sem agendamento'
                              : formatDateFull(post.scheduledAt || post.publishedAt || post.createdAt)}
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            {post.status === 'PUBLISHED'
                              ? 'Publicado'
                              : post.status === 'PUBLISHING'
                              ? 'Publicando'
                              : post.status === 'DRAFT'
                              ? 'Rascunho'
                              : post.status === 'FAILED'
                              ? 'Falha'
                              : post.status === 'PARTIALLY_PUBLISHED'
                              ? 'Parcial'
                              : post.status === 'CANCELLED'
                              ? 'Cancelado'
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

                        {/* Legenda (exceto para Story conforme regra explÃ­cita) */}
                        <td className="p-3 max-w-xs text-zinc-300">
                          {post.format === 'STORY_IMAGE' || post.format === 'STORY_VIDEO' ? (
                            <span className="text-zinc-500 italic text-[11px]">
                              Story (sem legenda)
                            </span>
                          ) : (
                            <p className="line-clamp-2 text-[11px] leading-relaxed">
                              {post.content}
                            </p>
                          )}
                        </td>

                        {/* AÃ§Ã£o */}
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
                              PrÃ©via
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PaginaÃ§Ã£o da lista */}
            {totalListPages > 1 && (
              <div className="flex items-center justify-between text-xs text-zinc-400 px-2">
                <div>
                  Mostrando {(currentPage - 1) * pageSize + 1} a{' '}
                  {Math.min(currentPage * pageSize, posts.length)} de {posts.length} conteÃºdos
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
                    PÃ¡gina {currentPage} de {totalListPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalListPages, p + 1))}
                    disabled={currentPage === totalListPages}
                    className="h-8 bg-zinc-800 border-white/10 hover:bg-zinc-700 text-zinc-300"
                  >
                    PrÃ³xima
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODAL PARA DETALHE DE CONTEÃšDOS DO DIA (+X) */}
        {/* ========================================================================= */}
        <Dialog
          open={!!selectedDayPosts}
          onOpenChange={(open) => !open && setSelectedDayPosts(null)}
        >
          <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-purple-400" />
                ConteÃºdos de{' '}
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

        {/* Compositor Zafira de ConteÃºdo (Admin & Manager) */}
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
