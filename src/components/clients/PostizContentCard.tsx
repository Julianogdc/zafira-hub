import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  Layers,
  Play,
  Image as ImageIcon,
  Share2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ClientPostizPost, cleanPostContent } from '@/services/postiz';

interface PostizContentCardProps {
  post: ClientPostizPost;
}

export function PostizContentCard({ post }: PostizContentCardProps) {
  const [imageError, setImageError] = useState(false);

  // Sanitização garantida da legenda
  const displayLegend = cleanPostContent(post.content);
  const isDefaultEmpty = displayLegend === 'Sem legenda';

  // Informações de mídia normalizadas
  const mediaType = post.mediaType || 'NONE';
  const thumbnailUrl = post.mediaThumbnailUrl || null;
  const mediaCount = post.mediaCount || 0;
  const hasValidMedia = !!thumbnailUrl && !imageError;

  // Formatação de data e hora em pt-BR
  const rawDate = post.publishedAt || post.scheduledAt || post.createdAt;
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Sem data definida';
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

  // Badge de status
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <Badge
            variant="outline"
            className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[11px] gap-1 font-medium"
          >
            <CheckCircle2 className="w-3 h-3" /> Publicado
          </Badge>
        );
      case 'QUEUE':
      case 'SCHEDULED':
        return (
          <Badge
            variant="outline"
            className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[11px] gap-1 font-medium"
          >
            <Clock className="w-3 h-3" /> Agendado / Fila
          </Badge>
        );
      case 'DRAFT':
        return (
          <Badge
            variant="outline"
            className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 text-[11px] gap-1 font-medium"
          >
            <FileText className="w-3 h-3" /> Rascunho
          </Badge>
        );
      case 'ERROR':
        return (
          <Badge
            variant="outline"
            className="bg-red-500/10 text-red-400 border-red-500/20 text-[11px] gap-1 font-medium"
          >
            <AlertCircle className="w-3 h-3" /> Falhou
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
      <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wider ${colorClass}`}>
        {label}
      </Badge>
    );
  };

  // Auxiliar para identificar se a URL aponta diretamente para um arquivo de vídeo
  const isVideoFile = (url?: string | null): boolean => {
    if (!url || typeof url !== 'string') return false;
    const clean = url.split('?')[0].toLowerCase();
    return /\.(mp4|mov|webm|m4v|avi|mkv|ogv)$/i.test(clean);
  };

  const isDirectVideo = mediaType === 'VIDEO' && isVideoFile(thumbnailUrl);

  return (
    <div className="bg-zinc-950/40 border border-white/10 rounded-xl hover:border-white/20 transition-all overflow-hidden flex flex-col sm:flex-row group">
      {/* 1. MINIATURA VISUAL (4:5) */}
      <div
        style={{ aspectRatio: '4/5' }}
        className="w-full sm:w-40 sm:min-w-[160px] sm:max-w-[170px] aspect-[4/5] shrink-0 relative bg-zinc-900/80 border-b sm:border-b-0 sm:border-r border-white/5 overflow-hidden flex items-center justify-center"
      >
        {hasValidMedia ? (
          <>
            {isDirectVideo ? (
              <video
                src={thumbnailUrl!}
                muted
                playsInline
                preload="metadata"
                className="w-full h-full object-cover pointer-events-none transition-transform duration-300 group-hover:scale-[1.02]"
                onError={() => setImageError(true)}
              />
            ) : (
              <img
                src={thumbnailUrl!}
                alt="Prévia do post"
                onError={() => setImageError(true)}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                loading="lazy"
              />
            )}

            {/* Selo de Carrossel */}
            {mediaType === 'CAROUSEL' && (
              <div className="absolute top-2 left-2 z-10">
                <span className="bg-black/75 backdrop-blur-md text-white text-[10px] font-semibold px-2 py-0.5 rounded-full border border-white/15 flex items-center gap-1 shadow-md">
                  <Layers className="w-3 h-3 text-emerald-400" />
                  {mediaCount > 1 ? `1/${mediaCount}` : 'Carrossel'}
                </span>
              </div>
            )}

            {/* Indicador de Vídeo / Reel com Play central */}
            {mediaType === 'VIDEO' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm border border-white/25 flex items-center justify-center text-white shadow-xl">
                  <Play className="w-4 h-4 fill-white ml-0.5" />
                </div>
              </div>
            )}
          </>
        ) : (
          /* Fallback visual premium */
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-zinc-900/60 select-none">
            <div className="w-10 h-10 rounded-full bg-zinc-800/80 border border-white/10 flex items-center justify-center mb-2 text-zinc-400">
              {mediaType === 'VIDEO' ? (
                <Play className="w-4 h-4 fill-zinc-400 text-zinc-400 ml-0.5" />
              ) : (
                <ImageIcon className="w-4 h-4" />
              )}
            </div>
            <span className="text-[11px] font-medium text-zinc-400">Prévia indisponível</span>
            <span className="text-[9px] text-zinc-600 mt-0.5 uppercase tracking-wide">
              {mediaType === 'VIDEO' ? 'Vídeo / Reel' : mediaType === 'CAROUSEL' ? 'Carrossel' : 'Sem imagem'}
            </span>
          </div>
        )}
      </div>

      {/* 2. ÁREA DE INFORMAÇÕES OPERACIONAIS */}
      <div className="flex-1 p-4 flex flex-col justify-between min-w-0 space-y-3">
        <div className="space-y-2.5 min-w-0">
          {/* Linha 1: Status e Plataforma */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              {renderPlatformBadge(post.platform)}
              {mediaType === 'CAROUSEL' && (
                <span className="text-[10px] text-zinc-400 hidden sm:inline-block">
                  Carrossel · {mediaCount} itens
                </span>
              )}
            </div>
            {renderStatusBadge(post.status)}
          </div>

          {/* Linha 2: Conta Vinculada */}
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="w-5 h-5 border border-white/10 shrink-0">
              {post.accountPicture && (
                <AvatarImage src={post.accountPicture} alt={post.accountName} />
              )}
              <AvatarFallback className="text-[9px] bg-zinc-800 text-zinc-300 font-bold">
                {post.accountName?.slice(0, 2).toUpperCase() || 'PZ'}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium text-zinc-300 truncate" title={post.accountName}>
              {post.accountName || 'Conta conectada'}
            </span>
          </div>

          {/* Linha 3: Legenda limpa e resumida */}
          <div className="bg-zinc-900/50 rounded-lg p-2.5 border border-white/5">
            <p
              className={`text-xs leading-relaxed break-words line-clamp-3 ${
                isDefaultEmpty ? 'text-zinc-500 italic' : 'text-zinc-200'
              }`}
              title={displayLegend}
            >
              {displayLegend}
            </p>
          </div>
        </div>

        {/* Linha 4: Rodapé com data, horário e ação externa */}
        <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            {post.status === 'PUBLISHED' ? (
              <>
                <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">Publicado em: {formatDate(rawDate)}</span>
              </>
            ) : (
              <>
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Programado para: {formatDate(rawDate)}</span>
              </>
            )}
          </div>

          {post.releaseUrl && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-7 px-2 text-xs text-zinc-400 hover:text-white hover:bg-white/5 shrink-0 gap-1"
            >
              <a href={post.releaseUrl} target="_blank" rel="noopener noreferrer">
                <span>Ver post</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
