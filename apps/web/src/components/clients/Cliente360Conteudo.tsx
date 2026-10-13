import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Share2,
  RefreshCw,
  AlertTriangle,
  Radio,
  Layers,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  socialPublisherService,
  SocialPost,
  SocialAccount,
  getSocialErrorMessage,
} from '@/services/social-publisher';
import { SocialContentCard } from './SocialContentCard';
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
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PUBLISHED' | 'SCHEDULED' | 'DRAFT'>('ALL');

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // 1. Busca contas vinculadas ao cliente
      const linkedAccounts = await socialPublisherService.getClientAccounts(clientId);
      setAccounts(linkedAccounts || []);

      // 2. Se houver contas vinculadas, busca as publicações do cliente
      if (linkedAccounts && linkedAccounts.length > 0) {
        const clientPosts = await socialPublisherService.getAllClientContent(clientId);
        setPosts(clientPosts || []);
      } else {
        setPosts([]);
      }
    } catch (err: any) {
      const msg = getSocialErrorMessage(err, 'Falha ao carregar conteúdos sociais do cliente.');
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

  // Mapa de accountId -> SocialAccount para enriquecimento dos cards
  const accountsMap = useMemo(() => {
    const map = new Map<string, SocialAccount>();
    accounts.forEach((acc) => {
      map.set(acc.id, acc);
    });
    return map;
  }, [accounts]);

  // Filtragem local por status canônico
  const filteredPosts = useMemo(() => {
    if (filterStatus === 'ALL') return posts;
    if (filterStatus === 'PUBLISHED') {
      return posts.filter((p) => p.status === 'PUBLISHED');
    }
    if (filterStatus === 'SCHEDULED') {
      return posts.filter((p) => p.status === 'SCHEDULED' || p.status === 'PUBLISHING');
    }
    if (filterStatus === 'DRAFT') {
      return posts.filter((p) => p.status === 'DRAFT');
    }
    return posts;
  }, [posts, filterStatus]);

  // Badge da rede social
  const renderPlatformBadge = (platformStr: string) => {
    const p = (platformStr || '').toLowerCase();
    let label = platformStr;
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
          <h3 className="text-base font-semibold text-white">Não foi possível carregar as publicações sociais</h3>
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
          <h3 className="text-base font-semibold text-white">Nenhuma conta social vinculada a este cliente.</h3>
          <p className="text-sm text-zinc-400 max-w-md mx-auto">
            Vincule as contas sociais para que as publicações e o histórico sejam visualizados diretamente nesta aba.
          </p>
        </div>
        <div className="pt-2 flex items-center justify-center gap-3">
          <Badge variant="outline" className="text-xs text-zinc-400 border-zinc-800">
            Integração social disponível
          </Badge>
          {onManageIntegrations && (
            <Button
              size="sm"
              onClick={onManageIntegrations}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm"
            >
              <Share2 className="w-3.5 h-3.5" /> Vincular Conta Social
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
            {accounts.length} {accounts.length === 1 ? 'conta vinculada' : 'contas vinculadas'} • Integração social ativa
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
          const displayName = acc.accountName || acc.id;
          return (
            <div
              key={acc.id}
              className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-900 border border-white/10 text-xs text-zinc-300"
            >
              {acc.accountPicture ? (
                <img src={acc.accountPicture} alt={displayName} className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-medium text-white">{displayName}</span>
              {acc.accountHandle && <span className="text-zinc-500 text-[11px]">@{acc.accountHandle}</span>}
              {renderPlatformBadge(acc.platform)}
            </div>
          );
        })}
      </div>

      {/* FILTROS RÁPIDOS */}
      {posts.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
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
            variant={filterStatus === 'SCHEDULED' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterStatus('SCHEDULED')}
            className="text-xs h-7 px-3 text-amber-400 hover:text-amber-300"
          >
            Agendadas ({posts.filter((p) => p.status === 'SCHEDULED' || p.status === 'PUBLISHING').length})
          </Button>
          <Button
            variant={filterStatus === 'DRAFT' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterStatus('DRAFT')}
            className="text-xs h-7 px-3 text-zinc-400 hover:text-zinc-300"
          >
            Rascunhos ({posts.filter((p) => p.status === 'DRAFT').length})
          </Button>
        </div>
      )}

      {/* 4. ESTADO VAZIO: COM CONTAS, MAS SEM POSTS */}
      {posts.length === 0 ? (
        <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
          <Layers className="w-9 h-9 text-zinc-600 mx-auto opacity-50" />
          <h4 className="text-sm font-semibold text-white">Nenhum conteúdo social disponível para este cliente.</h4>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Não há publicações recentes ou agendadas para as contas sociais vinculadas a este cliente.
          </p>
        </Card>
      ) : filteredPosts.length === 0 ? (
        <Card className="bg-zinc-950/40 border-white/10 p-8 text-center space-y-2">
          <p className="text-xs text-zinc-400">Nenhuma publicação encontrada para o filtro selecionado.</p>
        </Card>
      ) : (
        /* 5. GRID DE PUBLICAÇÕES (CARDS RICOS COM MINIATURA 4:5) */
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredPosts.map((post) => {
            const accountId = post.platformStates?.[0]?.accountId;
            const account = accountId ? accountsMap.get(accountId) : null;
            return (
              <SocialContentCard
                key={post.id}
                post={post}
                clientId={clientId}
                account={account}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
