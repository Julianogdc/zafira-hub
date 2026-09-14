import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sparkles,
  UploadCloud,
  Trash2,
  Film,
  Image as ImageIcon,
  Layers,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Eye,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  postizIntegrationService,
  PostizUploadedMedia,
  ClientLinkedPostizAccount,
  ClientPostizPost,
} from '@/services/postiz';
import { clientsService, HubClient } from '@/services/clients';

export type PostFormat = 'FEED' | 'REEL' | 'STORY_IMAGE' | 'STORY_VIDEO' | 'CAROUSEL';

interface CompositorZafiraModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newPost: ClientPostizPost) => void;
  initialClientId?: string;
  clientsList?: { id: string; name: string }[];
}

interface UploadedItem {
  id: string;
  path: string;
  name: string;
  localPreviewUrl: string;
  type: 'IMAGE' | 'VIDEO';
}

export function CompositorZafiraModal({
  open,
  onOpenChange,
  onSuccess,
  initialClientId,
  clientsList: providedClients,
}: CompositorZafiraModalProps) {
  // Clientes e contas
  const [clients, setClients] = useState<{ id: string; name: string }[]>(providedClients || []);
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || '');
  const [clientAccounts, setClientAccounts] = useState<ClientLinkedPostizAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false);

  // Formato
  const [format, setFormat] = useState<PostFormat>('FEED');

  // Mídias
  const [mediaItems, setMediaItems] = useState<UploadedItem[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [activeCarouselIndex, setActiveCarouselIndex] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Legenda
  const [caption, setCaption] = useState<string>('');

  // Agendamento vs Rascunho
  const [isDraft, setIsDraft] = useState<boolean>(false);
  const [scheduledDateTime, setScheduledDateTime] = useState<string>(() => {
    // Padrão: amanhã às 14:00
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    // Formato YYYY-MM-DDTHH:mm para input datetime-local
    const offset = d.getTimezoneOffset() * 60000;
    const localIso = new Date(d.getTime() - offset).toISOString().slice(0, 16);
    return localIso;
  });

  // Envio / Carregamento
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Carrega lista de clientes caso não tenha sido fornecida
  useEffect(() => {
    if (open && (!clients || clients.length === 0)) {
      clientsService
        .getClients()
        .then((res) => {
          const list = (res || []).map((c: any) => ({ id: c.id, name: c.name }));
          setClients(list);
          if (!selectedClientId && list.length > 0) {
            setSelectedClientId(list[0].id);
          }
        })
        .catch(() => {});
    }
  }, [open, clients, selectedClientId]);

  // Carrega contas sociais vinculadas ao cliente selecionado
  useEffect(() => {
    if (!selectedClientId) {
      setClientAccounts([]);
      setSelectedAccountId('');
      return;
    }

    let isMounted = true;
    setLoadingAccounts(true);
    postizIntegrationService
      .getClientAccounts(selectedClientId)
      .then((res) => {
        if (!isMounted) return;
        const accs = res.accounts || [];
        setClientAccounts(accs);
        if (accs.length > 0) {
          setSelectedAccountId(accs[0].externalId);
        } else {
          setSelectedAccountId('');
        }
      })
      .catch(() => {
        if (isMounted) setClientAccounts([]);
      })
      .finally(() => {
        if (isMounted) setLoadingAccounts(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedClientId]);

  // Informações do cliente e conta selecionados para preview
  const selectedClientName = useMemo(() => {
    return clients.find((c) => c.id === selectedClientId)?.name || 'Cliente Selecionado';
  }, [clients, selectedClientId]);

  const selectedAccount = useMemo(() => {
    return clientAccounts.find((a) => a.externalId === selectedAccountId);
  }, [clientAccounts, selectedAccountId]);

  const selectedAccountName = selectedAccount?.name || 'Conta Social';
  const selectedPlatform = selectedAccount?.metadata?.providerIdentifier || 'instagram';

  const isStory = format === 'STORY_IMAGE' || format === 'STORY_VIDEO';
  const isVideoFormat = format === 'REEL' || format === 'STORY_VIDEO';

  // Aceite de arquivos por formato
  const acceptedFileTypes = useMemo(() => {
    if (format === 'REEL' || format === 'STORY_VIDEO') {
      return 'video/mp4,video/quicktime,video/webm';
    }
    if (format === 'FEED' || format === 'STORY_IMAGE') {
      return 'image/jpeg,image/png,image/webp,image/jpg';
    }
    // Carrossel
    return 'image/jpeg,image/png,image/webp,image/jpg,video/mp4,video/quicktime';
  }, [format]);

  // Handler de upload de arquivos
  const handleFileUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Regra: se não for carrossel, aceita apenas 1 arquivo
    const toUpload = format === 'CAROUSEL' ? fileArray : [fileArray[0]];

    setUploading(true);
    setErrorMessage(null);

    try {
      for (const file of toUpload) {
        // Validação defensiva de formato
        const isVid = file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name);
        if (isVideoFormat && !isVid) {
          throw new Error('O formato selecionado requer um arquivo de vídeo (.mp4, .mov, .webm).');
        }
        if ((format === 'FEED' || format === 'STORY_IMAGE') && isVid) {
          throw new Error('O formato selecionado requer uma imagem (.jpg, .png, .webp).');
        }

        const uploaded: PostizUploadedMedia = await postizIntegrationService.uploadMedia(file);
        const localUrl = URL.createObjectURL(file);

        const newItem: UploadedItem = {
          id: uploaded.id,
          path: uploaded.path,
          name: uploaded.name || file.name,
          localPreviewUrl: localUrl,
          type: isVid ? 'VIDEO' : 'IMAGE',
        };

        setMediaItems((prev) => {
          if (format === 'CAROUSEL') {
            return [...prev, newItem];
          }
          // Substitui o item anterior se for formato único
          return [newItem];
        });
      }
      toast.success('Mídia enviada com sucesso!');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Falha no envio da mídia para o Postiz.';
      setErrorMessage(msg);
      toast.error('Erro no upload', { description: msg });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveMedia = (index: number) => {
    setMediaItems((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    if (activeCarouselIndex >= index && activeCarouselIndex > 0) {
      setActiveCarouselIndex((prev) => prev - 1);
    }
  };

  // Submissão do formulário
  const handleSubmit = async () => {
    if (!selectedClientId) {
      toast.error('Selecione um cliente.');
      return;
    }
    if (!selectedAccountId) {
      toast.error('Selecione uma conta social vinculada ao cliente.');
      return;
    }
    if (mediaItems.length === 0) {
      toast.error('Envie pelo menos uma mídia para criar a publicação.');
      return;
    }

    if (!isDraft) {
      if (!scheduledDateTime) {
        toast.error('Defina a data e horário para agendamento.');
        return;
      }
      const schedDate = new Date(scheduledDateTime);
      if (schedDate.getTime() <= Date.now()) {
        toast.error('A data de agendamento deve ser no futuro.');
        return;
      }
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const scheduledIso = scheduledDateTime ? new Date(scheduledDateTime).toISOString() : undefined;

      const payload = {
        integrationId: selectedAccountId,
        format,
        content: isStory ? '' : caption,
        mediaItems: mediaItems.map((m) => ({ id: m.id, path: m.path })),
        isDraft,
        scheduledDate: scheduledIso,
      };

      const res = await postizIntegrationService.createPost(selectedClientId, payload);

      toast.success(
        isDraft ? 'Rascunho salvo com sucesso!' : 'Publicação agendada com sucesso!'
      );

      // Limpa dados e fecha modal
      setMediaItems([]);
      setCaption('');
      onSuccess(res.post);
      onOpenChange(false);
    } catch (err: any) {
      // Preserva dados no formulário e exibe mensagem amigável sem expor chaves
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Não foi possível criar o conteúdo no Postiz. Tente novamente.';
      setErrorMessage(msg);
      toast.error('Falha na criação do conteúdo', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto bg-zinc-950 border-white/10 text-white p-0 gap-0">
        <DialogHeader className="p-5 border-b border-white/10 flex flex-row items-center justify-between sticky top-0 bg-zinc-950/95 backdrop-blur-md z-20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-white tracking-tight">
                Compositor Zafira de Conteúdo
              </DialogTitle>
              <p className="text-xs text-zinc-400">
                Crie, envie mídias e agende publicações nas contas sociais dos seus clientes.
              </p>
            </div>
          </div>
        </DialogHeader>

        {errorMessage && (
          <div className="m-5 p-3.5 rounded-xl bg-red-950/30 border border-red-500/30 flex items-center gap-3 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <div className="flex-1">{errorMessage}</div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
          {/* ================================================================= */}
          {/* COLUNA ESQUERDA: FORMULÁRIO OPERACIONAL (7 COLUNAS) */}
          {/* ================================================================= */}
          <div className="lg:col-span-7 space-y-5">
            {/* 1. Cliente & Conta Social */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Cliente *
                </label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger className="bg-zinc-900 border-white/10 text-xs h-10">
                    <SelectValue placeholder="Selecione um cliente" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Conta Social Vinculada *
                </label>
                <Select
                  value={selectedAccountId}
                  onValueChange={setSelectedAccountId}
                  disabled={loadingAccounts || clientAccounts.length === 0}
                >
                  <SelectTrigger className="bg-zinc-900 border-white/10 text-xs h-10">
                    <SelectValue
                      placeholder={
                        loadingAccounts
                          ? 'Carregando contas...'
                          : clientAccounts.length === 0
                          ? 'Nenhuma conta vinculada'
                          : 'Selecione a conta'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    {clientAccounts.map((acc) => (
                      <SelectItem key={acc.externalId} value={acc.externalId}>
                        {acc.name || acc.externalId} ({acc.metadata?.providerIdentifier || 'Social'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {clientAccounts.length === 0 && !loadingAccounts && selectedClientId && (
                  <p className="text-[11px] text-amber-400/90">
                    Este cliente não possui contas Postiz vinculadas no Cliente 360.
                  </p>
                )}
              </div>
            </div>

            {/* 2. Seleção de Formato */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Formato da Publicação *
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'FEED', label: 'Feed (Foto)', icon: ImageIcon, desc: 'Imagem única' },
                  { id: 'REEL', label: 'Reel (Vídeo)', icon: Film, desc: 'Vídeo vertical' },
                  { id: 'STORY_IMAGE', label: 'Story (Foto)', icon: Sparkles, desc: 'Sem legenda' },
                  { id: 'STORY_VIDEO', label: 'Story (Vídeo)', icon: Sparkles, desc: 'Sem legenda' },
                  { id: 'CAROUSEL', label: 'Carrossel', icon: Layers, desc: 'Múltiplas fotos/vídeos' },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = format === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setFormat(item.id as PostFormat);
                        // Se mudar de carrossel para formato único, mantém apenas o primeiro
                        if (item.id !== 'CAROUSEL' && mediaItems.length > 1) {
                          setMediaItems([mediaItems[0]]);
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                        isSelected
                          ? 'bg-purple-600/20 border-purple-500 text-white shadow-sm shadow-purple-500/10'
                          : 'bg-zinc-900 border-white/5 hover:border-white/10 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <div
                        className={`p-1.5 rounded-lg shrink-0 ${
                          isSelected ? 'bg-purple-500 text-white' : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold leading-tight text-white">
                          {item.label}
                        </div>
                        <div className="text-[10px] text-zinc-500">{item.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Upload de Mídia */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Mídia ({mediaItems.length} {mediaItems.length === 1 ? 'enviada' : 'enviadas'}) *
                </label>
                {format === 'CAROUSEL' && mediaItems.length > 0 && (
                  <span className="text-[11px] text-zinc-400">
                    Até 10 fotos ou vídeos no carrossel
                  </span>
                )}
              </div>

              {/* Área de dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/10 hover:border-purple-500/50 bg-zinc-900/50 hover:bg-zinc-900/80 rounded-2xl p-6 text-center cursor-pointer transition-all space-y-2 group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple={format === 'CAROUSEL'}
                  accept={acceptedFileTypes}
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  className="hidden"
                />

                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                    <p className="text-xs text-zinc-300 font-medium">
                      Enviando mídia com segurança ao Postiz...
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="p-3 bg-zinc-800 rounded-full w-fit mx-auto text-purple-400 group-hover:scale-105 transition-transform">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">
                        Clique para enviar ou arraste o arquivo aqui
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {isVideoFormat
                          ? 'Suporta vídeos MP4, MOV ou WebM'
                          : format === 'CAROUSEL'
                          ? 'Suporta múltiplas imagens e vídeos'
                          : 'Suporta imagens JPG, PNG ou WebP'}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Lista de mídias enviadas */}
              {mediaItems.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mediaItems.map((item, idx) => (
                    <div
                      key={item.id + idx}
                      className="relative w-16 h-16 rounded-xl border border-white/10 overflow-hidden bg-zinc-900 group shrink-0"
                    >
                      {item.type === 'VIDEO' ? (
                        <video
                          src={item.localPreviewUrl}
                          className="w-full h-full object-cover"
                          muted
                        />
                      ) : (
                        <img
                          src={item.localPreviewUrl}
                          alt={item.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMedia(idx);
                        }}
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-red-400 transition-opacity"
                        title="Remover mídia"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Campo de Legenda (apenas Feed, Reel e Carrossel) */}
            {!isStory ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Legenda da Publicação
                  </label>
                  <span className="text-[11px] text-zinc-500">{caption.length} caracteres</span>
                </div>
                <Textarea
                  placeholder="Escreva o texto e hashtags da publicação..."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="bg-zinc-900 border-white/10 text-xs min-h-[100px] text-white placeholder:text-zinc-500 resize-y"
                />
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-white/5 flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                <p className="text-xs text-zinc-400">
                  <span className="font-semibold text-white">Formato Story:</span> Não inclui legenda
                  de texto, em total conformidade com as regras do Instagram e Postiz.
                </p>
              </div>
            )}

            {/* 5. Salvar Rascunho vs. Agendar */}
            <div className="p-4 rounded-2xl bg-zinc-900/80 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-white">Tipo de Publicação</div>
                  <div className="text-[11px] text-zinc-400">
                    {isDraft
                      ? 'Salvar na fila de rascunhos para aprovação posterior'
                      : 'Agendar dia e horário para disparo automático'}
                  </div>
                </div>
                <div className="flex bg-zinc-800 p-1 rounded-lg border border-white/5">
                  <button
                    type="button"
                    onClick={() => setIsDraft(false)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      !isDraft
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Agendar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDraft(true)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      isDraft
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Rascunho
                  </button>
                </div>
              </div>

              {!isDraft && (
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-purple-400" />
                    Data e Horário do Agendamento *
                  </label>
                  <Input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    className="bg-zinc-800 border-white/10 text-xs h-9 text-white w-full sm:w-64"
                  />
                </div>
              )}
            </div>

            {/* Botões de Ação */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="bg-zinc-900 border-white/10 hover:bg-zinc-800 text-zinc-300 text-xs h-10 px-4"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || uploading || !selectedClientId || !selectedAccountId}
                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs h-10 px-5 gap-2 shadow-lg shadow-purple-600/20"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processando...
                  </>
                ) : isDraft ? (
                  <>
                    <FileText className="w-4 h-4" />
                    Salvar como Rascunho
                  </>
                ) : (
                  <>
                    <Clock className="w-4 h-4" />
                    Agendar Publicação
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* ================================================================= */}
          {/* COLUNA DIREITA: PREVIEW ZAFIRA AO VIVO (5 COLUNAS) */}
          {/* ================================================================= */}
          <div className="lg:col-span-5 bg-zinc-900/70 border border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Prévia Zafira ao Vivo
                </span>
              </div>
              <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[10px]">
                {format}
              </Badge>
            </div>

            {/* Container do Preview com Proporção Dinâmica */}
            <div className="flex items-center justify-center p-2 flex-1">
              <div
                className={`relative w-full max-w-[280px] rounded-2xl border border-white/10 bg-zinc-950 overflow-hidden shadow-2xl flex flex-col justify-between ${
                  isStory || format === 'REEL' ? 'aspect-[9/16]' : 'aspect-square'
                }`}
              >
                {/* Header do post na rede social */}
                <div className="p-2.5 flex items-center justify-between bg-black/40 backdrop-blur-sm z-10">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {selectedClientName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-white truncate">
                        {selectedClientName}
                      </div>
                      <div className="text-[9px] text-zinc-400 truncate">
                        {selectedAccountName}
                      </div>
                    </div>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-zinc-300 font-mono">
                    {selectedPlatform}
                  </span>
                </div>

                {/* Mídia Central */}
                <div className="relative flex-1 bg-zinc-900 flex items-center justify-center overflow-hidden">
                  {mediaItems.length === 0 ? (
                    <div className="p-4 text-center space-y-1 text-zinc-500">
                      <ImageIcon className="w-8 h-8 mx-auto stroke-1" />
                      <p className="text-[11px]">Nenhuma mídia enviada</p>
                    </div>
                  ) : (
                    (() => {
                      const currentItem =
                        format === 'CAROUSEL'
                          ? mediaItems[activeCarouselIndex] || mediaItems[0]
                          : mediaItems[0];

                      return currentItem.type === 'VIDEO' ? (
                        <video
                          src={currentItem.localPreviewUrl}
                          className="w-full h-full object-cover"
                          controls
                          playsInline
                          muted
                        />
                      ) : (
                        <img
                          src={currentItem.localPreviewUrl}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      );
                    })()
                  )}

                  {/* Controles de Carrossel */}
                  {format === 'CAROUSEL' && mediaItems.length > 1 && (
                    <>
                      <div className="absolute top-2 right-2 bg-black/70 px-2 py-0.5 rounded-full text-[10px] text-white font-mono z-10">
                        {activeCarouselIndex + 1}/{mediaItems.length}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveCarouselIndex((prev) => Math.max(0, prev - 1))}
                        disabled={activeCarouselIndex === 0}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 text-white disabled:opacity-30 z-10"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveCarouselIndex((prev) => Math.min(mediaItems.length - 1, prev + 1))
                        }
                        disabled={activeCarouselIndex === mediaItems.length - 1}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 text-white disabled:opacity-30 z-10"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>

                {/* Footer do preview: Legenda (exceto Story) */}
                {!isStory && (
                  <div className="p-2.5 bg-black/60 backdrop-blur-md text-left z-10">
                    <p className="text-[10px] text-zinc-200 line-clamp-2 leading-relaxed">
                      <span className="font-semibold text-white mr-1.5">
                        {selectedClientName}
                      </span>
                      {caption || 'Sem legenda'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Informações consolidadas */}
            <div className="text-[11px] text-zinc-400 bg-zinc-950/60 p-3 rounded-xl border border-white/5 space-y-1">
              <div className="flex justify-between">
                <span>Destino:</span>
                <span className="text-white font-semibold">{selectedAccountName}</span>
              </div>
              <div className="flex justify-between">
                <span>Disparo:</span>
                <span className="text-purple-400 font-semibold">
                  {isDraft
                    ? 'Rascunho (Sem data)'
                    : scheduledDateTime
                    ? new Date(scheduledDateTime).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'A definir'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
