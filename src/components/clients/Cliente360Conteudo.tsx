import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Share2,
  Calendar,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Radio,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  postizIntegrationService,
  ClientPostizPost,
  ClientLinkedPostizAccount,
} from '@/services/postiz';
import { toast } from 'sonner';

interface Cliente360ConteudoProps {
  clientId: string;
  refreshTrigger?: number;
  onManageIntegrations?: () => void;
}

export function Cliente360Conteudo({
  clientId,
  refreshTrigger,
  onManageIntegrations,
}: Cliente360ConteudoProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ClientLinkedPostizAccount[]>([]);
  const [posts, setPosts] = useState<ClientPostizPost[]>([]);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PUBLISHED' | 'QUEUE'>('ALL');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Busca contas vinculadas ao cliente
      const accountsRes = await postizIntegrationService.getClientAccounts(clientId);
      const linkedAccounts = accountsRes.accounts || [];
      setAccounts(linkedAccounts);

      // 2. Se houver contas vinculadas, busca as publicações
      if (linkedAccounts.length > 0) {
        const contentRes = await postizIntegrationService.getClientContent(clientId);
        setPosts(contentRes.posts || []);
      } else {
        setPosts([]);
      }
    } catch (err: any) {
      const msg = err?.data?.message || err?.message || 'Falha ao carregar conteúdo do Postiz';
      setError(msg);
      if (isRefresh) {
        toast.error(`Erro ao atualizar dados: ${msg}`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);


  // Filtragem local por status
  const filteredPosts = useMemo(() => {
    if (filterStatus === 'ALL') return posts;
    if (filterStatus === 'PUBLISHED') {
      return posts.filter((p) => p.status === 'PUBLISHED');
    }
    if (filterStatus === 'QUEUE') {
      return posts.filter((p) => p.status === 'QUEUE' || p.status === 'SCHEDULED');
    }
    return posts;
  }, [posts, filterStatus]);

  // Formatação de data
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Sem data';
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  // Badge de status visual
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] gap-1 font-medium">
            <CheckCircle2 className="w-3 h-3" /> Publicado
          </Badge>
        );
      case 'QUEUE':
      case 'SCHEDULED':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] gap-1 font-medium">
            <Clock className="w-3 h-3" /> Agendado / Fila
          </Badge>
        );
      case 'DRAFT':
        return (
          <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 text-[11px] gap-1 font-medium">
            <FileText className="w-3 h-3" /> Rascunho
          </Badge>
        );
      case 'ERROR':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] gap-1 font-medium">
            <AlertCircle className="w-3 h-3" /> Falha no envio
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-zinc-800 text-zinc-300 border-white/10 text-[11px]">
            {status}
          </Badge>
        );
    }
  };

  // Badge da rede social
  const renderPlatformBadge = (platform: string) => {
    const p = (platform || '').toLowerCase();
    let label = platform;
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
      colorClass = 'bg-zinc-900 text-cyan-300 border-cyan-500/20';
    } else if (p.includes('facebook')) {
      label = 'Facebook';
      colorClass = 'bg-blue-600/10 text-blue-400 border-blue-600/20';
    }

    return (
      <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wider ${colorClass}`}>
        {label}
      </Badge>
    );
  };

  // 1. ESTADO DE LOADING
  if (loading) {
    return (
      <div className="space-y-4 py-6">
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 bg-zinc-800/60 rounded animate-pulse" />
          <div className="h-8 w-24 bg-zinc-800/60 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-zinc-950/40 border-white/10 p-5 space-y-3 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="h-4 w-20 bg-zinc-800/60 rounded" />
                <div className="h-4 w-16 bg-zinc-800/60 rounded" />
              </div>
              <div className="h-16 w-full bg-zinc-800/40 rounded" />
              <div className="h-3 w-32 bg-zinc-800/60 rounded" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // 2. ESTADO DE ERRO TRATADO
  if (error) {
    return (
      <Card className="bg-red-500/5 border-red-500/20 p-8 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 text-red-400 mx-auto opacity-80" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-white">Não foi possível carregar o conteúdo do Postiz</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">{error}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchData()}
          className="border-red-500/30 text-red-300 hover:bg-red-500/10"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> Tentar novamente
        </Button>
      </Card>
    );
  }

  // 3. ESTADO VAZIO: NENHUMA CONTA VINCULADA
  if (accounts.length === 0) {
    return (
      <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-4">
        <Share2 className="w-10 h-10 text-zinc-600 mx-auto opacity-50" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-white">Nenhuma conta do Postiz vinculada a este cliente.</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Vincule as contas sociais do Postiz para que as publicações sejam visualizadas diretamente nesta aba.
          </p>
        </div>
        <div className="pt-2 flex items-center justify-center gap-3">
          <Badge variant="outline" className="text-xs text-zinc-400 border-zinc-800">
            Postiz Lab Operacional
          </Badge>
          {onManageIntegrations && (
            <Button
              size="sm"
              onClick={onManageIntegrations}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm"
            >
              <Share2 className="w-3.5 h-3.5" /> Vincular Conta Postiz
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER DA ABA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Share2 className="w-4 h-4 text-emerald-400" />
            Publicações & Conteúdo Social
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {accounts.length} {accounts.length === 1 ? 'conta vinculada' : 'contas vinculadas'} • Modo somente leitura via Postiz Lab
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onManageIntegrations && (
            <Button
              variant="outline"
              size="sm"
              onClick={onManageIntegrations}
              className="border-white/10 hover:bg-white/5 text-xs text-zinc-300 gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5 text-emerald-400" />
              Gerenciar Contas
            </Button>
          )}
          {/* Botão de Atualizar */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="border-white/10 hover:bg-white/5 text-xs text-zinc-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* CONTAS VINCULADAS */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 font-medium mr-1 flex items-center gap-1">
          <Radio className="w-3 h-3 text-zinc-500" /> Contas:
        </span>
        {accounts.map((acc) => {
          const meta = acc.metadata || {};
          const displayName = meta.name || acc.name || acc.externalId;
          const profile = meta.profile;
          return (
            <div
              key={acc.id}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-900 border border-white/10 text-xs text-zinc-300"
            >
              {meta.picture ? (
                <img src={meta.picture} alt={displayName} className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-medium text-white">{displayName}</span>
              {profile && <span className="text-zinc-500 text-[11px]">{profile}</span>}
              {meta.providerIdentifier && renderPlatformBadge(meta.providerIdentifier)}
            </div>
          );
        })}
      </div>

      {/* FILTROS RÁPIDOS */}
      {posts.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Button
            variant={filterStatus === 'ALL' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterStatus('ALL')}
            className="text-xs h-7 px-3"
          >
            Todas ({posts.length})
          </Button>
          <Button
            variant={filterStatus === 'PUBLISHED' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterStatus('PUBLISHED')}
            className="text-xs h-7 px-3 text-emerald-400 hover:text-emerald-300"
          >
            Publicadas ({posts.filter((p) => p.status === 'PUBLISHED').length})
          </Button>
          <Button
            variant={filterStatus === 'QUEUE' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterStatus('QUEUE')}
            className="text-xs h-7 px-3 text-amber-400 hover:text-amber-300"
          >
            Agendadas ({posts.filter((p) => p.status === 'QUEUE' || p.status === 'SCHEDULED').length})
          </Button>
        </div>
      )}

      {/* 4. ESTADO VAZIO: COM CONTAS, MAS SEM POSTS */}
      {posts.length === 0 ? (
        <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
          <Layers className="w-9 h-9 text-zinc-600 mx-auto opacity-50" />
          <h4 className="text-sm font-semibold text-white">Nenhum conteúdo do Postiz disponível para este cliente.</h4>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Não há publicações recentes ou agendadas para as contas vinculadas a este cliente no Postiz.
          </p>
        </Card>
      ) : filteredPosts.length === 0 ? (
        <Card className="bg-zinc-950/40 border-white/10 p-8 text-center space-y-2">
          <p className="text-xs text-zinc-400">Nenhuma publicação encontrada para o filtro selecionado.</p>
        </Card>
      ) : (
        /* 5. GRID DE PUBLICAÇÕES */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPosts.map((post) => {
            const displayDate = post.publishedAt || post.scheduledAt || post.createdAt;
            return (
              <Card
                key={post.id}
                className="bg-zinc-950/40 border-white/10 flex flex-col justify-between hover:border-white/20 transition-colors"
              >
                <CardHeader className="p-4 pb-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {renderPlatformBadge(post.platform)}
                      <span className="text-xs text-zinc-400 truncate max-w-[120px]">{post.accountName}</span>
                    </div>
                    {renderStatusBadge(post.status)}
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-1 flex-1 flex flex-col justify-between space-y-3">
                  <div className="text-xs text-zinc-200 line-clamp-4 whitespace-pre-wrap font-sans bg-black/20 p-2.5 rounded border border-white/5">
                    {post.content || <span className="italic text-zinc-500">Publicação sem texto (mídia)</span>}
                  </div>

                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-zinc-500" />
                      {formatDate(displayDate)}
                    </span>

                    {post.releaseUrl && (
                      <a
                        href={post.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-emerald-400 hover:underline font-medium ml-2"
                      >
                        Abrir <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
