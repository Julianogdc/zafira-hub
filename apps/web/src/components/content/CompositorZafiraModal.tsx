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
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  socialPublisherService,
  SocialPost,
  SocialAccount,
  SocialContentFormat,
  createIdempotencyKey,
  getSocialErrorMessage,
} from '@/services/social-publisher';
import { clientsService } from '@/services/clients';

export type PostFormat = SocialContentFormat;

interface CompositorZafiraModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newPost: SocialPost) => void;
  initialClientId?: string;
  clientsList?: { id: string; name: string }[];
}

interface UploadedItem {
  id: string;
  url: string;
  mimeType: string;
  mediaType: 'IMAGE' | 'VIDEO';
  fileName: string;
  idempotencyKey: string;
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
  const [loadingClients, setLoadingClients] = useState<boolean>(false);
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || '');
  const [clientAccounts, setClientAccounts] = useState<SocialAccount[]>([]);
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
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  });

  // Idempotência do CreatePost (cache de fingerprint para retentativas de timeout)
  const createPostFingerprintRef = useRef<{ fingerprint: string; key: string } | null>(null);

  // Idempotência de Upload (cache de fingerprint para retentativas de timeout/erro)
  const pendingUploadOperationsRef = useRef<Map<string, { idempotencyKey: string; createdAt: number }>>(new Map());

  // Limpa estados transitórios e chaves de idempotência ao fechar modal
  useEffect(() => {
    if (!open) {
      pendingUploadOperationsRef.current.clear();
      createPostFingerprintRef.current = null;
    }
  }, [open]);

  // Envio / Carregamento
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sincroniza se providedClients for alterado externamente
  useEffect(() => {
    if (providedClients && providedClients.length > 0) {
      setClients(providedClients);
      if (!selectedClientId) {
        const defaultId =
          initialClientId && providedClients.some((c) => c.id === initialClientId)
            ? initialClientId
            : providedClients[0].id;
        setSelectedClientId(defaultId);
      }
    }
  }, [providedClients, initialClientId, selectedClientId]);

  // Carrega lista de clientes caso não tenha sido fornecida
  useEffect(() => {
    if (!open) return;

    if (providedClients && providedClients.length > 0) {
      setClients(providedClients);
      if (initialClientId && providedClients.some((c) => c.id === initialClientId)) {
        setSelectedClientId(initialClientId);
      } else if (!selectedClientId) {
        setSelectedClientId(providedClients[0].id);
      }
      return;
    }

    if (clients.length === 0) {
      let isMounted = true;
      setLoadingClients(true);
      clientsService
        .listClients()
        .then((res) => {
          if (!isMounted) return;
          const list = res.clients.map((c) => ({ id: c.id, name: c.name }));
          setClients(list);
          if (list.length > 0) {
            setSelectedClientId((prev) => {
              if (initialClientId && list.some((c) => c.id === initialClientId)) {
                return initialClientId;
              }
              if (prev && list.some((c) => c.id === prev)) {
                return prev;
              }
              return list[0].id;
            });
          }
        })
        .catch((err) => {
          console.error('Falha ao carregar lista de clientes:', err);
        })
        .finally(() => {
          if (isMounted) setLoadingClients(false);
        });

      return () => {
        isMounted = false;
      };
    } else if (initialClientId && clients.some((c) => c.id === initialClientId)) {
      setSelectedClientId(initialClientId);
    }
  }, [open, providedClients, initialClientId]);

  // Carrega contas sociais vinculadas ao cliente selecionado
  useEffect(() => {
    if (!open || !selectedClientId || loadingClients) {
      if (!selectedClientId) {
        setClientAccounts([]);
        setSelectedAccountId('');
      }
      return;
    }

    let isMounted = true;
    setLoadingAccounts(true);
    socialPublisherService
      .getClientAccounts(selectedClientId)
      .then((accs) => {
        if (!isMounted) return;
        const safeAccs = accs || [];
        setClientAccounts(safeAccs);
        if (safeAccs.length > 0) {
          setSelectedAccountId(safeAccs[0].id);
        } else {
          setSelectedAccountId('');
        }
      })
      .catch((err) => {
        console.error('Falha ao carregar contas sociais para o cliente:', err);
        if (isMounted) {
          setClientAccounts([]);
          setSelectedAccountId('');
        }
      })
      .finally(() => {
        if (isMounted) setLoadingAccounts(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, selectedClientId, loadingClients]);

  // Informações do cliente e conta selecionados para preview
  const selectedClientName = useMemo(() => {
    return clients.find((c) => c.id === selectedClientId)?.name || 'Cliente Selecionado';
  }, [clients, selectedClientId]);

  const selectedAccount = useMemo(() => {
    return clientAccounts.find((a) => a.id === selectedAccountId);
  }, [clientAccounts, selectedAccountId]);

  const selectedAccountName = selectedAccount?.accountName || 'Conta Social';
  const selectedPlatform = selectedAccount?.platform || 'INSTAGRAM';

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
    return 'image/jpeg,image/png,image/webp,image/jpg,video/mp4,video/quicktime';
  }, [format]);

  // Handler de upload de arquivos com idempotência estável
  const handleFileUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const toUpload = format === 'CAROUSEL' ? fileArray : [fileArray[0]];

    setUploading(true);
    setErrorMessage(null);

    try {
      for (const file of toUpload) {
        const isVid = file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name);
        if (isVideoFormat && !isVid) {
          throw new Error('O formato selecionado requer um arquivo de vídeo (.mp4, .mov, .webm).');
        }
        if ((format === 'FEED' || format === 'STORY_IMAGE') && isVid) {
          throw new Error('O formato selecionado requer uma imagem (.jpg, .png, .webp).');
        }

        // Chave de idempotência estável para a operação de upload deste arquivo (reutilizada em caso de retry)
        const fileFingerprint = `${file.name}-${file.size}-${file.type}-${file.lastModified}-${format}`;
        let uploadKey: string;
        const existingOp = pendingUploadOperationsRef.current.get(fileFingerprint);

        if (existingOp) {
          uploadKey = existingOp.idempotencyKey;
        } else {
          uploadKey = createIdempotencyKey();
          pendingUploadOperationsRef.current.set(fileFingerprint, {
            idempotencyKey: uploadKey,
            createdAt: Date.now(),
          });
        }

        const uploaded = await socialPublisherService.uploadMedia(file, uploadKey);

        // Upload confirmado com sucesso: remove a pendência daquele fingerprint
        pendingUploadOperationsRef.current.delete(fileFingerprint);

        const newItem: UploadedItem = {
          id: uploaded.id,
          url: uploaded.url,
          mimeType: uploaded.mimeType,
          mediaType: isVid ? 'VIDEO' : 'IMAGE',
          fileName: file.name,
          idempotencyKey: uploadKey,
        };

        // Proteção contra duplicação no state em retentativas
        setMediaItems((prev) => {
          if (prev.some((m) => m.id === newItem.id)) {
            return prev;
          }
          if (format === 'CAROUSEL') {
            return [...prev, newItem];
          }
          return [newItem];
        });
      }
      toast.success('Mídia enviada com sucesso!');
    } catch (err: any) {
      console.error('[Compositor Upload Error]:', err);
      const userMsg = getSocialErrorMessage(err, 'Não foi possível enviar o arquivo de mídia. Tente novamente.');
      setErrorMessage(userMsg);
      toast.error('Erro no upload', { description: userMsg });
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

    // Validações estritas de formato
    if (format === 'CAROUSEL' && mediaItems.length < 2) {
      toast.error('Formato Carrossel exige no mínimo 2 mídias.');
      return;
    }
    if (format === 'REEL' && (mediaItems.length !== 1 || mediaItems[0].mediaType !== 'VIDEO')) {
      toast.error('Formato Reel exige exatamente 1 mídia de vídeo.');
      return;
    }
    if (format === 'STORY_VIDEO' && (mediaItems.length !== 1 || mediaItems[0].mediaType !== 'VIDEO')) {
      toast.error('Formato Story em vídeo exige exatamente 1 vídeo.');
      return;
    }
    if (format === 'STORY_IMAGE' && (mediaItems.length !== 1 || mediaItems[0].mediaType !== 'IMAGE')) {
      toast.error('Formato Story com foto exige exatamente 1 imagem.');
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

    // Gestão de idempotência estável por fingerprint de formulário
    const currentFingerprint = JSON.stringify({
      selectedClientId,
      selectedAccountId,
      format,
      caption: isStory ? '' : caption,
      mediaIds: mediaItems.map((m) => m.id),
      isDraft,
      scheduledDateTime: isDraft ? null : scheduledDateTime,
    });

    let createKey: string;
    if (
      createPostFingerprintRef.current &&
      createPostFingerprintRef.current.fingerprint === currentFingerprint
    ) {
      createKey = createPostFingerprintRef.current.key;
    } else {
      createKey = createIdempotencyKey();
      createPostFingerprintRef.current = {
        fingerprint: currentFingerprint,
        key: createKey,
      };
    }

    try {
      const scheduledIso = !isDraft && scheduledDateTime ? new Date(scheduledDateTime).toISOString() : null;

      const res = await socialPublisherService.createPost(
        selectedClientId,
        {
          accountId: selectedAccountId,
          format,
          content: isStory ? '' : caption,
          mediaIds: mediaItems.map((m) => m.id),
          isDraft,
          scheduledAt: scheduledIso,
        },
        createKey
      );

      toast.success(
        isDraft ? 'Rascunho salvo com sucesso!' : 'Publicação agendada com sucesso!'
      );

      // Limpa dados de idempotência e fecha modal
      createPostFingerprintRef.current = null;
      pendingUploadOperationsRef.current.clear();
      setMediaItems([]);
      setCaption('');
      onSuccess(res);
      onOpenChange(false);
    } catch (err: any) {
      const msg = getSocialErrorMessage(
        err,
        'Não foi possível criar o conteúdo social. Verifique a integração e tente novamente.'
      );
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
          {/* COLUNA ESQUERDA: FORMULÁRIO OPERACIONAL (7 COLUNAS) */}
          <div className="lg:col-span-7 space-y-5">
            {/* 1. Cliente & Conta Social */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Cliente *
                </label>
                <Select
                  value={selectedClientId}
                  onValueChange={setSelectedClientId}
                  disabled={loadingClients || clients.length === 0}
                >
                  <SelectTrigger className="bg-zinc-900 border-white/10 text-xs h-10">
                    <SelectValue
                      placeholder={
                        loadingClients
                          ? 'Carregando clientes...'
                          : clients.length === 0
                          ? 'Nenhum cliente disponível'
                          : 'Selecione um cliente'
                      }
                    />
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
                  disabled={loadingClients || loadingAccounts || clientAccounts.length === 0 || !selectedClientId}
                >
                  <SelectTrigger className="bg-zinc-900 border-white/10 text-xs h-10">
                    <SelectValue
                      placeholder={
                        loadingClients
                          ? 'Aguardando clientes...'
                          : loadingAccounts
                          ? 'Carregando contas...'
                          : clientAccounts.length === 0
                          ? 'Nenhuma conta vinculada'
                          : 'Selecione a conta'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white text-xs">
                    {clientAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.accountName || acc.id} ({acc.platform || 'Social'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {clientAccounts.length === 0 && !loadingAccounts && !loadingClients && selectedClientId && (
                  <p className="text-[11px] text-amber-400/90">
                    Este cliente não possui contas sociais vinculadas no Cliente 360.
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

              {/* Área drag & drop */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/10 hover:border-purple-500/50 bg-zinc-900/40 hover:bg-zinc-900/60 rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedFileTypes}
                  multiple={format === 'CAROUSEL'}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFileUpload(e.target.files);
                  }}
                  disabled={uploading}
                />
                <div className="p-3 rounded-full bg-zinc-800/80 group-hover:bg-purple-500/10 text-zinc-400 group-hover:text-purple-400 transition-colors">
                  {uploading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <UploadCloud className="w-5 h-5" />
                  )}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-zinc-200">
                    {uploading
                      ? 'Processando e enviando mídia...'
                      : 'Clique ou arraste arquivos para enviar'}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Formatos aceitos para {format}: {acceptedFileTypes}
                  </p>
                </div>
              </div>

              {/* Lista de thumbnails de mídias enviadas */}
              {mediaItems.length > 0 && (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pt-1">
                  {mediaItems.map((item, index) => (
                    <div
                      key={item.id}
                      className={`relative aspect-square rounded-lg overflow-hidden border bg-zinc-900 group ${
                        activeCarouselIndex === index
                          ? 'border-purple-500 ring-1 ring-purple-500'
                          : 'border-white/10'
                      }`}
                      onClick={() => setActiveCarouselIndex(index)}
                    >
                      {item.mediaType === 'VIDEO' ? (
                        <video
                          src={item.url}
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt={item.fileName}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMedia(index);
                        }}
                        className="absolute top-1 right-1 p-1 rounded-md bg-black/70 hover:bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remover mídia"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Legenda (Oculta para Stories conforme regra de negócio) */}
            {!isStory ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Legenda da Publicação
                  </label>
                  <span className="text-[10px] text-zinc-500">{caption.length} caracteres</span>
                </div>
                <Textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Escreva a legenda para a publicação... Hashtags, emojis e quebras de linha são suportados."
                  className="bg-zinc-900 border-white/10 text-xs min-h-[110px] resize-y"
                />
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/10 flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                <p className="text-xs text-purple-300">
                  Formato Story não aceita legenda de texto. O conteúdo visual ocupa a tela inteira.
                </p>
              </div>
            )}

            {/* 5. Agendamento vs Rascunho */}
            <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-zinc-400" />
                  <span className="text-xs font-semibold text-zinc-200">
                    Programação de Publicação
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDraft(false)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      !isDraft
                        ? 'bg-purple-600 text-white font-medium'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Agendar
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDraft(true)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      isDraft
                        ? 'bg-zinc-700 text-white font-medium'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Rascunho
                  </button>
                </div>
              </div>

              {!isDraft ? (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-amber-400" /> Data e Horário de Envio
                  </label>
                  <Input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    className="bg-zinc-900 border-white/10 text-xs h-9 text-white"
                  />
                </div>
              ) : (
                <p className="text-xs text-zinc-400">
                  O post será salvo como rascunho e não será publicado automaticamente até que seja
                  agendado.
                </p>
              )}
            </div>

            {/* 6. Ações */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="text-xs text-zinc-400 hover:text-white h-9"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || uploading}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-9 px-4 gap-1.5 shadow-md shadow-purple-600/20 font-medium"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : isDraft ? (
                  <>
                    <FileText className="w-3.5 h-3.5" />
                    <span>Salvar Rascunho</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-3.5 h-3.5" />
                    <span>Agendar Publicação</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* COLUNA DIREITA: LIVE PREVIEW VISUAL (5 COLUNAS) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Prévia em Tempo Real
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {selectedPlatform.toUpperCase()}
              </span>
            </div>

            {/* Mock do dispositivo com aspect ratio 4:5 ou 9:16 para Stories */}
            <div className="mx-auto w-full max-w-[320px] bg-zinc-900 rounded-3xl p-3 border border-white/10 shadow-2xl shadow-black/60">
              <div
                style={{ aspectRatio: isStory ? '9/16' : '4/5' }}
                className="w-full relative rounded-2xl overflow-hidden border border-white/5 bg-zinc-950 flex flex-col justify-between"
              >
                {/* Header do mock */}
                <div className="p-3 flex items-center justify-between z-10 bg-gradient-to-b from-black/80 to-transparent">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px] font-bold">
                      {selectedClientName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-white leading-tight truncate max-w-[140px]">
                        {selectedClientName}
                      </p>
                      <p className="text-[9px] text-zinc-400 truncate max-w-[140px]">
                        {selectedAccountName}
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-zinc-300 font-semibold uppercase">
                    {format}
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

                      return currentItem.mediaType === 'VIDEO' ? (
                        <video
                          src={currentItem.url}
                          className="w-full h-full object-cover"
                          controls
                          playsInline
                          muted
                        />
                      ) : (
                        <img
                          src={currentItem.url}
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
