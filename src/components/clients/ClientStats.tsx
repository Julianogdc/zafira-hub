import React from 'react';
import { Users, Activity, Ghost, Wallet, UserPlus } from 'lucide-react';
import { ClientStats } from '../../types/client';

interface ClientStatsProps {
  stats: ClientStats;
}

export function ClientStatsDisplay({ stats }: ClientStatsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">

      {/* Card 1: Total */}
      <div className="p-6 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-400">Total de Clientes</h3>
          <Users className="w-4 h-4 text-zinc-500" />
        </div>
        <div className="text-2xl font-bold text-white">{stats.totalClients}</div>
      </div>

      {/* Card 2: Ativos */}
      <div className="p-6 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-emerald-500/80">Ativos</h3>
          <Activity className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="text-2xl font-bold text-white">{stats.activeClients}</div>
      </div>

      {/* Card 3: Churn Rate */}
      <div className="p-6 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-red-400/80">Churn Rate</h3>
          <Ghost className="w-4 h-4 text-red-500" />
        </div>
        <div className="text-2xl font-bold text-white">{stats.churnRate}%</div>
        <p className="text-xs text-zinc-500 mt-1">{stats.inactiveClients} inativos</p>
      </div>

      {/* Card 4: Novos no Mês */}
      <div className="p-6 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-purple-400/80">Novos (Mês)</h3>
          <UserPlus className="w-4 h-4 text-purple-400" />
        </div>
        <div className="text-2xl font-bold text-white">{stats.newClientsThisMonth}</div>
        <p className="text-xs text-zinc-500 mt-1">Iniciados este mês</p>
      </div>

      {/* Card 5: Receita */}
      <div className="p-6 rounded-xl border border-white/10 bg-zinc-950/50 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-blue-400/80">Valor em Contratos</h3>
          <Wallet className="w-4 h-4 text-blue-400" />
        </div>
        <div className="text-2xl font-bold text-white">
          {formatCurrency(stats.totalContractValue)}
        </div>
        <p className="text-xs text-zinc-500 mt-1">Recorrência mensal</p>
      </div>

    </div>
  );
}