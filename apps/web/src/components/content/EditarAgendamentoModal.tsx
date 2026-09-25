import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Calendar as CalendarIcon,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  SocialPost,
  socialPublisherService,
  getSocialErrorMessage,
} from '@/services/social-publisher';

interface EditarAgendamentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: SocialPost;
  clientId: string;
  clientName?: string;
  accountName?: string;
  onSuccess: (updatedPost: SocialPost) => void;
}

/**
 * Converte uma data UTC para componentes de data e horário no fuso de Campo Grande (MS) (America/Campo_Grande).
 */
function getCampoGrandeParts(dateObj: Date): { dateStr: string; timeStr: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Campo_Grande',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(dateObj);
    const getVal = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const year = getVal('year');
    const month = getVal('month');
    const day = getVal('day');
    let hour = getVal('hour');
    if (hour === '24') hour = '00';
    const minute = getVal('minute');

    return {
      dateStr: `${year}-${month}-${day}`,
      timeStr: `${hour}:${minute}`,
    };
  } catch {
    const iso = dateObj.toISOString();
    return {
      dateStr: iso.split('T')[0],
      timeStr: iso.split('T')[1].slice(0, 5),
    };
  }
}

export default function EditarAgendamentoModal({
  isOpen,
  onClose,
  post,
  clientId,
  clientName,
  accountName,
  onSuccess,
}: EditarAgendamentoModalProps) {
  const isDraft = post.status === 'DRAFT';
  const isScheduled = post.status === 'SCHEDULED';
  const canSchedule = isDraft || isScheduled;

  // Inicialização de data e hora
  const [dateStr, setDateStr] = useState<string>('');
  const [timeStr, setTimeStr] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    if (post.scheduledAt) {
      const parts = getCampoGrandeParts(new Date(post.scheduledAt));
      setDateStr(parts.dateStr);
      setTimeStr(parts.timeStr);
    } else {
      // Para rascunhos sem agendamento prévio: sugere amanhã às 10:00 no fuso de Campo Grande
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const parts = getCampoGrandeParts(tomorrow);
      setDateStr(parts.dateStr);
      setTimeStr('10:00');
    }
  }, [isOpen, post.scheduledAt]);

  // Monta a data alvo respeitando o offset de Campo Grande (MS) (UTC-4)
  const targetDate = useMemo(() => {
    if (!dateStr || !timeStr) return null;
    try {
      const isoCandidate = `${dateStr}T${timeStr}:00-04:00`;
      const d = new Date(isoCandidate);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }, [dateStr, timeStr]);

  // Validação se a data/hora é estritamente futura
  const isFuture = useMemo(() => {
    if (!targetDate) return false;
    return targetDate.getTime() > Date.now();
  }, [targetDate]);

  // Formato legível do post
  const formatLabel = useMemo(() => {
    const fmt = post.format || 'FEED';
    if (fmt === 'STORY_IMAGE' || fmt === 'STORY_VIDEO') return 'Story';
    if (fmt === 'REEL') return 'Reel';
    if (fmt === 'CAROUSEL') return 'Carrossel';
    return 'Feed';
  }, [post.format]);

  const platform = post.platformStates?.[0]?.platform || 'Social';

  const handleSave = async () => {
    if (!canSchedule) {
      toast.error('Publicações neste estado não podem ser agendadas ou retemporizadas.');
      return;
    }

    if (!targetDate || !isFuture) {
      toast.error('Selecione uma data e horário futuros para a publicação.');
      return;
    }

    try {
      setIsSaving(true);
      const isoWithOffset = `${dateStr}T${timeStr}:00-04:00`;
      const updatedPost = await socialPublisherService.schedulePost(clientId, post.id, isoWithOffset);

      toast.success(
        isDraft ? 'Rascunho agendado com sucesso.' : 'Agendamento atualizado com sucesso.'
      );
      onSuccess(updatedPost);
      onClose();
    } catch (err: any) {
      console.error('[EditarAgendamentoModal] Erro ao atualizar agendamento:', err);
      const msg = getSocialErrorMessage(
        err,
        'Não foi possível atualizar o agendamento. Revise os dados e tente novamente.'
      );
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="max-w-md bg-zinc-950/95 border-white/10 text-white shadow-2xl backdrop-blur-xl">
        <DialogHeader className="space-y-1.5 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <CalendarIcon className="w-4 h-4" />
            </span>
            <DialogTitle className="text-base font-bold text-white tracking-tight">
              {isDraft ? 'Agendar rascunho' : 'Editar agendamento'}
            </DialogTitle>
          </div>
          <p className="text-xs text-zinc-400">
            {isDraft
              ? 'Defina a data e o horário para programar a publicação automática deste rascunho.'
              : 'Altere a data e o horário previstos para a publicação ser disparada.'}
          </p>
        </DialogHeader>

        {/* Resumo do Conteúdo */}
        <div className="space-y-4 pt-2">
          {!canSchedule && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Publicações com status {post.status} não podem ser retemporizadas.</span>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 truncate max-w-[200px]">
                {clientName || 'Cliente Zafira'}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="bg-purple-500/10 text-purple-300 border-purple-500/20 text-[10px] px-2 py-0.5"
                >
                  {formatLabel}
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-zinc-800 text-zinc-300 border-white/10 text-[10px] px-2 py-0.5 uppercase"
                >
                  {platform}
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-400 pt-1 border-t border-white/5">
              <span className="truncate max-w-[220px]">
                Conta: <strong className="text-zinc-200">{accountName || 'Social'}</strong>
              </span>
              <span className="text-[11px] text-zinc-500 font-mono">
                {isDraft ? 'Status: Rascunho' : `Status: ${post.status}`}
              </span>
            </div>
          </div>

          {/* Seletores de Data e Horário */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5 text-zinc-400" /> Data
              </label>
              <Input
                type="date"
                value={dateStr}
                disabled={isSaving || !canSchedule}
                onChange={(e) => setDateStr(e.target.value)}
                className="bg-zinc-900 border-white/10 text-white text-xs h-9 focus-visible:ring-purple-500 [color-scheme:dark]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-400" /> Horário
              </label>
              <Input
                type="time"
                value={timeStr}
                disabled={isSaving || !canSchedule}
                onChange={(e) => setTimeStr(e.target.value)}
                className="bg-zinc-900 border-white/10 text-white text-xs h-9 focus-visible:ring-purple-500 [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Destaque do Fuso Horário de Campo Grande (MS) */}
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-purple-500/5 border border-purple-500/15 text-xs text-purple-300">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="font-medium">Horário de Campo Grande (MS)</span>
            </div>
            <span className="text-[11px] font-mono text-purple-400/80">UTC-4</span>
          </div>

          {/* Validação de data no passado */}
          {!isFuture && dateStr && timeStr && canSchedule && (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>A data e o horário selecionados devem estar no futuro.</span>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-white/10 pt-4 flex flex-row items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
            className="text-zinc-400 hover:text-white text-xs hover:bg-white/5"
          >
            Cancelar
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !isFuture || !canSchedule}
            className="bg-purple-600 hover:bg-purple-500 text-white text-xs gap-1.5 font-medium shadow-md shadow-purple-600/20 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Salvar agendamento</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
