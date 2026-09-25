import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  socialPublisherService,
  AvailableSocialAccount,
  getSocialErrorMessage,
} from '@/services/social-publisher';
import {
  Share2,
  RefreshCw,
  CheckCircle2,
  Lock,
  Plus,
  Trash2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

interface ManageSocialAccountsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  canManage: boolean;
  onIntegrationsChanged?: () => void;
}

export function ManageSocialAccountsModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  canManage,
  onIntegrationsChanged,
}: ManageSocialAccountsModalProps) {
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<AvailableSocialAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [accountToUnlink, setAccountToUnlink] = useState<AvailableSocialAccount | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await socialPublisherService.getClientAvailableAccounts(clientId);
      setAccounts(res || []);
    } catch (err: any) {
      console.error('Erro ao carregar contas sociais:', err);
      const msg = getSocialErrorMessage(err, 'Falha ao carregar contas sociais disponíveis.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (open) {
      loadAccounts();
    }
  }, [open, loadAccounts]);

  const handleLink = async (account: AvailableSocialAccount) => {
    if (!canManage) {
      toast.error('Você não tem permissão para vincular contas sociais.');
      return;
    }
    setLinkingId(account.id);
    try {
      await socialPublisherService.linkAccount(clientId, account.id);
      toast.success(`Conta "${account.accountName}" vinculada com sucesso!`);
      await loadAccounts();
      if (onIntegrationsChanged) {
        onIntegrationsChanged();
      }
    } catch (err: any) {
      console.error('Erro ao vincular conta:', err);
      const msg = getSocialErrorMessage(err, 'Falha ao vincular conta social.');
      toast.error(msg);
    } finally {
      setLinkingId(null);
    }
  };

  const handleConfirmUnlink = async () => {
    if (!accountToUnlink || !canManage) return;
    const account = accountToUnlink;
    setUnlinkingId(account.id);
    try {
      await socialPublisherService.unlinkAccount(clientId, account.id);
      toast.success(`Conta "${account.accountName}" desvinculada com sucesso!`);
      setAccountToUnlink(null);
      await loadAccounts();
      if (onIntegrationsChanged) {
        onIntegrationsChanged();
      }
    } catch (err: any) {
      console.error('Erro ao desvincular conta:', err);
      const msg = getSocialErrorMessage(err, 'Falha ao desvincular conta social.');
      toast.error(msg);
    } finally {
      setUnlinkingId(null);
    }
  };

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-white p-6 shadow-2xl">
          <DialogHeader className="space-y-1.5 pb-3 border-b border-white/10">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-semibold flex items-center gap-2 text-white">
                <Share2 className="w-5 h-5 text-emerald-400" />
                Gerenciar contas sociais — {clientName}
              </DialogTitle>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                Integração social
              </Badge>
            </div>
            <DialogDescription className="text-xs text-zinc-400">
              Selecione as contas sociais disponíveis na organização para associar a este cliente.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3">
            {/* Status / Ações topo */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-zinc-400">
                {accounts.length} {accounts.length === 1 ? 'conta detectada' : 'contas detectadas'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadAccounts}
                disabled={loading}
                className="text-xs text-zinc-400 hover:text-white h-8 px-2.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Atualizar lista
              </Button>
            </div>

            {/* Loading */}
            {loading && (
              <div className="py-12 text-center space-y-3">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto opacity-80" />
                <p className="text-xs text-zinc-400">Consultando contas sociais disponíveis...</p>
              </div>
            )}

            {/* Erro */}
            {!loading && error && (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-center space-y-2">
                <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
                <p className="text-xs text-red-300">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadAccounts}
                  className="border-red-500/30 text-red-300 text-xs mt-2"
                >
                  Tentar novamente
                </Button>
              </div>
            )}

            {/* Vazio */}
            {!loading && !error && accounts.length === 0 && (
              <div className="py-10 text-center space-y-3 rounded-lg border border-dashed border-white/10 bg-zinc-900/30 p-6">
                <Share2 className="w-10 h-10 text-zinc-600 mx-auto opacity-40" />
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-white">Nenhuma conta social encontrada</h4>
                  <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                    Conecte canais sociais nas integrações da organização primeiro para que apareçam disponíveis para vinculação aqui.
                  </p>
                </div>
              </div>
            )}

            {/* Lista de contas */}
            {!loading && !error && accounts.length > 0 && (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {accounts.map((account) => {
                  const isCurrentClient = account.linkedClientId === clientId;
                  const isOtherClient = account.isLinked && account.linkedClientId !== clientId;
                  const isBusy = linkingId === account.id || unlinkingId === account.id;

                  return (
                    <div
                      key={account.id}
                      className={`p-3.5 rounded-lg border transition-all flex items-center justify-between gap-4 ${
                        isCurrentClient
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : isOtherClient
                          ? 'bg-zinc-900/30 border-white/5 opacity-80'
                          : 'bg-zinc-900/60 border-white/10 hover:border-white/20'
                      }`}
                    >
                      {/* Avatar e Detalhes */}
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="w-10 h-10 border border-white/10 shrink-0">
                          {account.accountPicture ? (
                            <AvatarImage src={account.accountPicture} alt={account.accountName} />
                          ) : null}
                          <AvatarFallback className="bg-zinc-800 text-zinc-300 font-semibold text-xs">
                            {account.accountName?.slice(0, 2).toUpperCase() || 'SO'}
                          </AvatarFallback>
                        </Avatar>

                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-white truncate max-w-[200px]">
                              {account.accountName}
                            </span>
                            {renderPlatformBadge(account.platform)}
                          </div>
                          {account.accountHandle && (
                            <p className="text-[11px] text-zinc-400 truncate">
                              @{account.accountHandle}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Status e Ação */}
                      <div className="flex items-center gap-3 shrink-0">
                        {isCurrentClient ? (
                          <>
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Vinculada
                            </Badge>
                            {canManage && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => setAccountToUnlink(account)}
                                className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              >
                                {unlinkingId === account.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Desvincular conta
                                  </>
                                )}
                              </Button>
                            )}
                          </>
                        ) : isOtherClient ? (
                          <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <Lock className="w-3.5 h-3.5 text-zinc-400" />
                            <span>
                              {account.linkedClientName
                                ? `Vinculada a ${account.linkedClientName}`
                                : 'Vinculada a outro cliente'}
                            </span>
                          </div>
                        ) : (
                          canManage && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => handleLink(account)}
                              className="h-8 text-xs border-white/20 text-white hover:bg-white/10 hover:border-white/30"
                            >
                              {linkingId === account.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5 mr-1" /> Conectar conta
                                </>
                              )}
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de Desvinculação */}
      <AlertDialog
        open={!!accountToUnlink}
        onOpenChange={(open) => !open && setAccountToUnlink(null)}
      >
        <AlertDialogContent className="bg-zinc-950 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Desvincular conta social?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400 text-xs leading-relaxed">
              Você está desvinculando a conta{' '}
              <strong className="text-white">{accountToUnlink?.accountName}</strong> do cliente{' '}
              <strong className="text-white">{clientName}</strong>. As publicações associadas não
              serão mais exibidas no painel deste cliente até que o canal seja reconectado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 text-white border-white/10 hover:bg-zinc-700 text-xs">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmUnlink}
              className="bg-red-600 text-white hover:bg-red-700 text-xs font-medium"
            >
              Desvincular conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
