// C:\Projetos\zafira-hub-v2\src\components\ia\AISettingsDialog.tsx

import React from 'react';
import { useAIStore } from '@/store/useAIStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Settings2, Shield, Brain, Lock, MessageSquare } from 'lucide-react';
import { AIProvider } from '@/types/ai';

interface AISettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AISettingsDialog({ open, onOpenChange }: AISettingsDialogProps) {
  const { settings, updateSettings, togglePermission } = useAIStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-[#0A0A0A] border-white/10 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b border-white/5 pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Settings2 className="w-5 h-5 text-purple-400" />
            Configurações da Inteligência
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Ajuste a chave de API e as permissões de leitura.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">

          {/* --- BLOCO 1: INSIGHTS DO DASHBOARD (NOVO) --- */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Painel do Dashboard</h3>
            </div>
            
            <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-white">Exibir Insights Automáticos</label>
                <input 
                  type="checkbox" 
                  checked={settings.autoGenerateInsights} 
                  onChange={() => togglePermission('autoGenerateInsights')}
                  className="w-4 h-4 accent-purple-500 cursor-pointer" 
                />
              </div>
              
              {/* Só mostra as sub-opções se o principal estiver ativo */}
              {settings.autoGenerateInsights && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-white/10 mt-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={settings.canReadFinance} onChange={() => togglePermission('canReadFinance')} className="accent-emerald-500" />
                    Ler Financeiro
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={settings.canReadGoals} onChange={() => togglePermission('canReadGoals')} className="accent-emerald-500" />
                    Ler Metas
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={settings.canReadClients} onChange={() => togglePermission('canReadClients')} className="accent-emerald-500" />
                    Ler Clientes
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* --- BLOCO 2: CHAT (COMO ERA ANTES) --- */}
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Configuração do Chat</h3>
            </div>

            <div className="space-y-4">
               {/* Provedor (Visual apenas, a engine corrige se errar) */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">Provedor (Referência)</label>
                <select 
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                  value={settings.provider}
                  onChange={(e) => updateSettings({ provider: e.target.value as AIProvider })}
                >
                  <option value="openai">OpenAI</option>
                  <option value="google">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">API Key</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input 
                    type="password" 
                    value={settings.apiKey}
                    onChange={(e) => updateSettings({ apiKey: e.target.value })}
                    className="w-full pl-9 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500 font-mono"
                    placeholder="Cole sua chave aqui (AIza... ou sk-or...)"
                  />
                </div>
              </div>

               {/* Modelo */}
               <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">Modelo</label>
                <input 
                  type="text" 
                  value={settings.model}
                  onChange={(e) => updateSettings({ model: e.target.value })}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500 font-mono"
                  placeholder="Ex: gemini-1.5-flash"
                />
                <p className="text-[10px] text-slate-500">
                  Para Gemini use: <code>gemini-1.5-flash</code>
                </p>
              </div>

              {/* System Prompt */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">Personalidade (System Prompt)</label>
                <textarea 
                  value={settings.systemPrompt}
                  onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
                  className="w-full h-20 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500 resize-none"
                />
              </div>
            </div>
          </div>

        </div>

        <div className="flex justify-end pt-4 border-t border-white/5">
           <button 
             onClick={() => onOpenChange(false)}
             className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg text-sm transition-colors font-medium"
           >
             Salvar
           </button>
        </div>

      </DialogContent>
    </Dialog>
  );
}