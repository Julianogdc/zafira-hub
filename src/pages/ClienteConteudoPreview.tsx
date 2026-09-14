import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  Layers,
  Play,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ClientPostizPost,
  postizIntegrationService,
  cleanPostContent,
  PostizMediaItem,
} from '@/services/postiz';
import { clientsService, HubClient } from '@/services/clients';

export default function ClienteConteudoPreview() {
  const { id: routeClientId, postId } = useParams<{ id: string; postId: string }>();
  const clientId = routeClientId || '';
  const navigate = useNavigate();
  const location = useLocation();

  // Se o post foi passado pelo state da rota, usa imediatamente para renderização instantânea
  const statePost = (location.state as any)?.post as ClientPostizPost | undefined;

  const [post, setPost] = useState<ClientPostizPost | null>(statePost || null);
  const [client, setClient] = useState<HubClient | null>(null);
  const [loading, setLoading] = useState<boolean>(!statePost);
  const [error, setError] = useState<string | null>(null);
  const [selectedCarouselIndex, setSelectedCarouselIndex] = useState(0);

  // Bloco técnico de detalhes da conta social (recolhido por padrão)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Carrega os dados garantindo revalidação obrigatória com a API do Hub mesmo se houver state prévio
  const loadData = useCallback(async () => {
    if (!clientId || !postId) return;

    try {
      setError(null);
      // Sempre consulta o endpoint oficial da API para obter formato e settings fidedignos
      const [postRes, clientData] = await Promise.allSettled([
        postizIntegrationService.getClientPost(clientId, postId),
        clientsService.getClientById(clientId).catch(() => null),
      ]);

      if (postRes.status === 'fulfilled' && postRes.value?.post) {
        setPost(postRes.value.post);
      } else if (!post) {
        const reason = (postRes as any).reason;
        const msg =
          reason?.data?.message ||
          reason?.message ||
          'Publicação não encontrada ou sem permissão de acesso.';
        setError(msg);
      }

      if (clientData.status === 'fulfilled' && clientData.value) {
        setClient(clientData.value);
      }
    } catch (err: any) {
      if (!post) {
        setError(err?.message || 'Erro ao carregar prévia do conteúdo.');
      }
    } finally {
      setLoading(false);
    }
  }, [clientId, postId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Formatação de data e hora em pt-BR
  const rawDate = post?.publishedAt || post?.scheduledAt || post?.createdAt;
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Sem data definida';
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  const renderStatusBadge = (status?: string) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs px-2.5 py-1 gap-1.5 font-medium"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Publicado
          </Badge>
        );
      case 'QUEUE':
      case 'SCHEDULED':
        return (
          <Badge
            variant="outline"
            className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs px-2.5 py-1 gap-1.5 font-medium"
          >
            <Clock className="w-3.5 h-3.5" /> Agendado / Fila
          </Badge>
        );
      case 'DRAFT':
        return (
          <Badge
            variant="outline"
            className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 text-xs px-2.5 py-1 gap-1.5 font-medium"
          >
            <FileText className="w-3.5 h-3.5" /> Rascunho
          </Badge>
        );
      case 'ERROR':
        return (
          <Badge
            variant="outline"
            className="bg-red-500/10 text-red-400 border-red-500/20 text-xs px-2.5 py-1 gap-1.5 font-medium"
          >
            <AlertCircle className="w-3.5 h-3.5" /> Falhou
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-zinc-800 text-zinc-300 border-white/10 text-xs px-2.5 py-1">
            {status || 'Desconhecido'}
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
      colorClass = 'bg-zinc-900 text-cyan-300 border-cyan-500/20';
    } else if (p.includes('facebook')) {
      label = 'Facebook';
      colorClass = 'bg-blue-600/10 text-blue-400 border-blue-600/20';
    }

    return (
      <Badge variant="outline" className={`text-xs px-2.5 py-1 font-semibold uppercase tracking-wider ${colorClass}`}>
        {label}
      </Badge>
    );
  };

  // Identifica se a URL é arquivo de vídeo
  const isVideoFile = (url?: string | null): boolean => {
    if (!url || typeof url !== 'string') return false;
    const clean = url.split('?')[0].toLowerCase();
    return /\.(mp4|mov|webm|m4v|avi|mkv|ogv)$/i.test(clean);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        <p className="text-sm text-zinc-400">Carregando visualização do conteúdo...</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-6">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white">Publicação não disponível</h2>
          <p className="text-sm text-zinc-400">{error || 'Não foi possível encontrar os dados desta publicação.'}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(`/clientes/${clientId}?tab=conteudo`)}
          className="border-white/10 hover:bg-white/5 text-zinc-300 gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar para o Cliente 360
        </Button>
      </div>
    );
  }

  // Resolução de Mídia e Formato estrito conforme regras de apresentação da Etapa 3F
  const mediaItems: PostizMediaItem[] = post.mediaItems || [];
  const currentItem = mediaItems[selectedCarouselIndex] || null;
  const currentMediaUrl = currentItem?.url || post.mediaThumbnailUrl;
  const isVideo = post.mediaType === 'VIDEO' || isVideoFile(currentMediaUrl);

  // Priorização estrita do backend:
  // Se o backend marcou isStory ou contentType STORY_VIDEO / STORY_IMAGE, é estritamente STORY.
  // Em hipótese alguma um vídeo é reclassificado como Reel se for Story.
  const isStory = Boolean(
    post.isStory ||
    post.contentType === 'STORY_VIDEO' ||
    post.contentType === 'STORY_IMAGE'
  );

  const isStoryVideo = post.contentType === 'STORY_VIDEO' || (isStory && isVideo);
  const isStoryImage = post.contentType === 'STORY_IMAGE' || (isStory && !isVideo);
  const isCarousel = (post.contentType === 'CAROUSEL' || post.mediaType === 'CAROUSEL') && !isStory;
  const isReel = (post.contentType === 'REEL' || (!isStory && isVideo)) && !isCarousel;
  const isFeedImage = (post.contentType === 'FEED_IMAGE' || (!isStory && !isVideo && !isCarousel)) && !!currentMediaUrl;
  const isNone = post.contentType === 'NONE' || (!currentMediaUrl && post.mediaCount === 0);

  // Título rigoroso conforme regras de apresentação
  const getFormatHeaderTitle = () => {
    if (isStoryVideo) return 'Prévia de Story em vídeo';
    if (isStoryImage) return 'Prévia de Story';
    if (isReel) return 'Prévia de Reel';
    if (isCarousel) return `Prévia de carrossel (${selectedCarouselIndex + 1}/${mediaItems.length || 1})`;
    if (isFeedImage) return 'Prévia de publicação';
    return 'Prévia indisponível';
  };

  // Badge do formato conforme especificação estrita da Etapa 3F (Story, Reel, etc.)
  const getFormatBadge = () => {
    if (isStory) {
      return (
        <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/20 text-xs px-2.5 py-1">
          Story
        </Badge>
      );
    }
    if (isReel) {
      return (
        <Badge variant="outline" className="bg-rose-500/10 text-rose-300 border-rose-500/20 text-xs px-2.5 py-1">
          Reel
        </Badge>
      );
    }
    if (isCarousel) {
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-xs px-2.5 py-1">
          Carrossel
        </Badge>
      );
    }
    if (isFeedImage) {
      return (
        <Badge variant="outline" className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20 text-xs px-2.5 py-1">
          Feed
        </Badge>
      );
    }
    return null;
  };

  const displayLegend = cleanPostContent(post.content);
  const isDefaultEmpty = displayLegend === 'Sem legenda';

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12 animate-in fade-in duration-300">
      {/* 1. BARRA SUPERIOR DE NAVEGAÇÃO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/clientes/${clientId}?tab=conteudo`)}
            className="text-zinc-400 hover:text-white gap-2 px-2.5 hover:bg-white/5"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar para o Cliente 360
          </Button>
          <span className="text-zinc-600 hidden sm:inline">/</span>
          <span className="text-xs font-medium text-zinc-400 truncate max-w-[200px] sm:max-w-xs">
            {client?.name ? `${client.name} · Preview` : 'Preview Zafira'}
          </span>
        </div>

        {post.releaseUrl && (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 gap-2 text-xs"
          >
            <a href={post.releaseUrl} target="_blank" rel="noopener noreferrer">
              <span>Abrir post na rede social</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Button>
        )}
      </div>

      {/* 2. CABEÇALHO DO CONTEÚDO */}
      <div className="p-6 rounded-xl bg-zinc-950/40 border border-white/10 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {renderPlatformBadge(post.platform)}
            {getFormatBadge()}
            {renderStatusBadge(post.status)}
            <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/20 text-xs px-2.5 py-0.5 gap-1">
              <Sparkles className="w-3 h-3 text-purple-400" /> Modo Leitura Zafira
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <Avatar className="w-9 h-9 border border-white/10 shrink-0">
              {post.accountPicture && <AvatarImage src={post.accountPicture} alt={post.accountName} />}
              <AvatarFallback className="text-xs bg-zinc-800 text-zinc-300 font-bold">
                {post.accountName?.slice(0, 2).toUpperCase() || 'PZ'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-white truncate">{post.accountName || 'Conta social'}</h1>
              <p className="text-xs text-zinc-400 truncate">
                Cliente: <span className="text-zinc-200 font-medium">{client?.name || 'Cliente 360'}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Data e Hora / Status de Agendamento */}
        <div className="flex flex-col md:items-end justify-center text-xs text-zinc-400 bg-zinc-900/50 p-3.5 rounded-lg border border-white/5 space-y-1">
          {post.status === 'DRAFT' ? (
            <>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="text-zinc-300 font-semibold text-sm">Rascunho — sem agendamento</span>
              </div>
              <span className="text-xs text-zinc-500">Salvo na fila de rascunhos da Zafira</span>
            </>
          ) : post.status === 'PUBLISHED' ? (
            <>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-zinc-300 font-medium">Publicado em:</span>
              </div>
              <span className="text-sm font-semibold text-white">{formatDate(rawDate)}</span>
            </>
          ) : post.status === 'ERROR' ? (
            <>
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-red-400 font-medium">Falha na publicação</span>
              </div>
              {rawDate && (
                <span className="text-xs text-zinc-500">
                  Data prevista: {formatDate(rawDate)}
                </span>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-zinc-300 font-medium">Programado para:</span>
              </div>
              <span className="text-sm font-semibold text-white">{formatDate(rawDate)}</span>
            </>
          )}
        </div>
      </div>

      {/* 3. CONTEÚDO PRINCIPAL (LAYOUT RESPONSIVO DINÂMICO CONFORME O FORMATO) */}
      <div className={`grid grid-cols-1 ${isStory ? 'lg:grid-cols-12' : 'lg:grid-cols-12'} gap-6`}>
        {/* COLUNA: MÍDIA EM DESTAQUE */}
        <div className={isStory ? 'lg:col-span-7 xl:col-span-6 flex flex-col space-y-4 mx-auto w-full' : 'lg:col-span-6 xl:col-span-5 flex flex-col space-y-4'}>
          <Card className="bg-zinc-950/40 border-white/10 overflow-hidden shadow-2xl">
            <CardHeader className="pb-3 border-b border-white/5 bg-zinc-900/30 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold text-zinc-300 tracking-wide flex items-center gap-2">
                {isStoryVideo ? (
                  <Play className="w-3.5 h-3.5 text-purple-400" />
                ) : isStoryImage ? (
                  <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                ) : isReel ? (
                  <Play className="w-3.5 h-3.5 text-rose-400" />
                ) : isCarousel ? (
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>{getFormatHeaderTitle()}</span>
              </CardTitle>

              {isCarousel && mediaItems.length > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={selectedCarouselIndex === 0}
                    onClick={() => setSelectedCarouselIndex((prev) => Math.max(0, prev - 1))}
                    className="h-7 w-7 text-zinc-400 hover:text-white"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={selectedCarouselIndex >= mediaItems.length - 1}
                    onClick={() => setSelectedCarouselIndex((prev) => Math.min(mediaItems.length - 1, prev + 1))}
                    className="h-7 w-7 text-zinc-400 hover:text-white"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </CardHeader>

            <CardContent className="p-0 flex items-center justify-center bg-black/60 min-h-[420px] max-h-[620px] relative">
              {currentMediaUrl ? (
                isVideo ? (
                  <div className={`w-full flex items-center justify-center ${isStory || isReel ? 'aspect-[9/16] max-h-[580px]' : 'max-h-[560px]'}`}>
                    <video
                      src={currentMediaUrl}
                      controls
                      muted
                      playsInline
                      preload="metadata"
                      className={`max-h-[580px] w-auto h-full object-contain mx-auto bg-black ${isStory ? 'rounded-lg' : ''}`}
                    />
                  </div>
                ) : (
                  <div className={`w-full flex items-center justify-center ${isStory ? 'aspect-[9/16] max-h-[580px]' : 'max-h-[560px]'}`}>
                    <img
                      src={currentMediaUrl}
                      alt="Mídia da publicação"
                      className={`max-h-[580px] w-auto h-full object-contain mx-auto ${isStory ? 'rounded-lg' : ''}`}
                    />
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-300">Conteúdo sem mídia</p>
                    <p className="text-xs text-zinc-500 mt-1">Esta publicação não possui anexos de imagem ou vídeo.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Miniaturas do carrossel (se houver mais de 1 item) */}
          {isCarousel && mediaItems.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto p-2 bg-zinc-950/40 border border-white/10 rounded-lg">
              {mediaItems.map((item, idx) => {
                const thumb = item.thumbnailUrl || item.url;
                const isSelected = idx === selectedCarouselIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedCarouselIndex(idx)}
                    className={`w-14 h-14 rounded-md overflow-hidden shrink-0 border-2 transition-all relative ${
                      isSelected ? 'border-purple-500 ring-2 ring-purple-500/30 scale-105' : 'border-white/10 opacity-70 hover:opacity-100'
                    }`}
                  >
                    {item.type === 'VIDEO' ? (
                      <div className="w-full h-full bg-zinc-900 flex items-center justify-center relative">
                        <video src={thumb} className="w-full h-full object-cover pointer-events-none" muted preload="metadata" />
                        <Play className="w-3.5 h-3.5 text-white absolute inset-auto fill-white" />
                      </div>
                    ) : (
                      <img src={thumb} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* COLUNA: INFORMAÇÕES, LEGENDA (SE APLICÁVEL) E DETALHES TÉCNICOS */}
        <div className={isStory ? 'lg:col-span-5 xl:col-span-6 flex flex-col space-y-6' : 'lg:col-span-6 xl:col-span-7 flex flex-col space-y-6'}>
          {/* Card da Legenda — OMITIDO PARA STORIES CONFORME REGRA DE NEGÓCIO */}
          {!isStory && (
            <Card className="bg-zinc-950/40 border-white/10 flex-1 flex flex-col shadow-xl">
              <CardHeader className="pb-3 border-b border-white/5 bg-zinc-900/20">
                <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-400" /> Legenda do Conteúdo
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 flex-1">
                <div className="bg-zinc-900/60 rounded-xl p-5 border border-white/5 h-full">
                  <p
                    className={`text-sm leading-relaxed whitespace-pre-wrap select-text ${
                      isDefaultEmpty ? 'text-zinc-500 italic' : 'text-zinc-200'
                    }`}
                  >
                    {displayLegend}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* DADOS DA CONTA SOCIAL — BLOCO RECOLHIDO POR PADRÃO */}
          <Card className="bg-zinc-950/40 border-white/10 overflow-hidden shadow-md">
            <button
              type="button"
              onClick={() => setIsDetailsOpen((prev) => !prev)}
              aria-expanded={isDetailsOpen}
              className="w-full flex items-center justify-between p-4 bg-zinc-900/40 hover:bg-zinc-900/70 border-b border-white/5 transition-colors text-left select-none focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Detalhes da conta social
                </span>
                <span className="text-[11px] text-zinc-500 font-normal">
                  ({post.platform || 'Social'})
                </span>
              </div>
              <div className="text-zinc-400 hover:text-white transition-transform">
                {isDetailsOpen ? (
                  <ChevronDown className="w-4 h-4 text-zinc-300" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-400" />
                )}
              </div>
            </button>

            {isDetailsOpen && (
              <CardContent className="p-5 space-y-3 text-xs animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-400">Conta:</span>
                  <span className="text-zinc-200 font-medium">{post.accountName}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-400">Plataforma:</span>
                  <span className="text-zinc-200 font-medium capitalize">{post.platform}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-400">Formato:</span>
                  <span className="text-zinc-200 font-medium">
                    {isStoryVideo
                      ? 'Story em vídeo'
                      : isStoryImage
                      ? 'Story com imagem'
                      : isReel
                      ? 'Reel'
                      : isCarousel
                      ? 'Carrossel'
                      : isFeedImage
                      ? 'Publicação (Feed)'
                      : 'Sem mídia'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                  <span className="text-zinc-400">Status Operacional:</span>
                  <span className="text-zinc-200 font-medium">{post.status}</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-zinc-400">ID da Publicação:</span>
                  <span className="font-mono text-zinc-300 text-[11px]">{post.id}</span>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
