import React, { useState, useEffect } from 'react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  BarChart2,
  Calendar as CalendarIcon,
  LayoutList,
  Users2
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { useClientStore } from '../store/useClientStore';
import { useAuthStore } from '../store/useAuthStore';
import { Client } from '../types/client';
import { ClientStatsDisplay } from '../components/clients/ClientStats';
import { ClientList } from '../components/clients/ClientList';
import { ClientForm } from '../components/clients/ClientForm';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/ui/PageHeader";

export default function Clientes() {
  const { clients: allClients, fetchClients, initialized } = useClientStore();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!initialized) {
      fetchClients();
    }
  }, [initialized, fetchClients]);

  // Filter clients: Show owned clients OR legacy clients (no owner)
  const clients = allClients.filter(c => !c.ownerId || c.ownerId === user?.id);

  // Controle do Modal (Sheet)
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // Navegação Temporal
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'monthly' | 'annual'>('monthly');

  const selectedMonth = currentDate.getMonth();
  const selectedYear = currentDate.getFullYear();

  // HEPER: Verifica se cliente está ativo em um determinado mês/ano
  const isClientActiveInPeriod = (client: Client, month: number, year: number) => {
    // Data de referência (Início do mês selecionado)
    const periodStart = new Date(year, month, 1);
    // Data de referência (Fim do mês selecionado)
    const periodEnd = new Date(year, month + 1, 0);

    // Início do contrato
    const start = client.contractStart ? new Date(client.contractStart + 'T00:00:00') : new Date(client.createdAt);
    // Fim do contrato (ou muito distante se null)
    const end = client.contractEnd ? new Date(client.contractEnd + 'T00:00:00') : new Date('2100-01-01');

    // Lógica de overlap: O contrato começa antes do fim do período E termina depois do início do período
    return start <= periodEnd && end >= periodStart && client.status === 'active';
  };

  // Função refinada para cálculo de receita
  const calculateRevenue = (month: number, year: number) => {
    return clients
      .filter(c => {
        const start = c.contractStart ? new Date(c.contractStart + 'T00:00:00') : new Date(c.createdAt);
        const end = c.contractEnd ? new Date(c.contractEnd + 'T00:00:00') : null;
        const periodStart = new Date(year, month, 1);
        const periodEnd = new Date(year, month + 1, 0);

        // Verifica se existia contrato ATIVO neste mês
        const isDateActive = start <= periodEnd && (!end || end >= periodStart);
        return isDateActive;
      })
      .reduce((acc, curr) => acc + curr.contractValue, 0);
  };

  // --- ESTATÍSTICAS DINÂMICAS ---
  const dynamicStats = {
    totalClients: clients.length,
    activeClients: clients.filter(c => isClientActiveInPeriod(c, selectedMonth, selectedYear)).length,
    inactiveClients: clients.filter(c => !isClientActiveInPeriod(c, selectedMonth, selectedYear)).length,
    totalContractValue: calculateRevenue(selectedMonth, selectedYear),

    newClientsThisMonth: clients.filter(c => {
      const d = new Date(c.contractStart || c.createdAt);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    }).length,

    churnRate: '0.0'
  };

  // --- DADOS PARA GRÁFICO ANUAL ---
  const annualData = Array.from({ length: 12 }, (_, i) => {
    const revenue = calculateRevenue(i, selectedYear);
    const start = new Date(selectedYear, i, 1);
    const monthName = start.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
    return {
      name: monthName,
      revenue: revenue,
      clients: clients.filter(c => isClientActiveInPeriod(c, i, selectedYear)).length
    };
  });

  // --- HELPERS DE NAVEGAÇÃO ---
  const handlePrev = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'monthly') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setFullYear(newDate.getFullYear() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'monthly') {
      newDate.setMonth(newDate.getMonth() + 1);
    } else {
      newDate.setFullYear(newDate.getFullYear() + 1);
    }
    setCurrentDate(newDate);
  };

  // --- LISTA FILTRADA P/ MÊS ---
  const monthlyClients = clients.filter(c => isClientActiveInPeriod(c, selectedMonth, selectedYear));

  const handleCreateNew = () => {
    setEditingClient(null);
    setIsSheetOpen(true);
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setIsSheetOpen(true);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <PageHeader
          title="Gestão de Clientes"
          description="Gerencie contratos e acompanhe a receita recorrente."
          icon={Users2}
        />

        <div className="flex items-center gap-4 bg-zinc-900/50 p-1.5 rounded-lg border border-white/5">
          <div className="flex items-center gap-2 px-2">
            <Button variant="ghost" size="icon" onClick={handlePrev} className="h-8 w-8 text-zinc-400 hover:text-white">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium text-white min-w-[120px] text-center capitalize">
              {viewMode === 'monthly'
                ? currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                : currentDate.getFullYear()}
            </span>
            <Button variant="ghost" size="icon" onClick={handleNext} className="h-8 w-8 text-zinc-400 hover:text-white">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="h-6 w-px bg-white/10 mx-2" />

          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as any)}>
            <ToggleGroupItem value="monthly" aria-label="Visão Mensal" className="h-8 px-2 data-[state=on]:bg-emerald-600 data-[state=on]:text-white">
              <LayoutList className="w-4 h-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="annual" aria-label="Visão Anual" className="h-8 px-2 data-[state=on]:bg-emerald-600 data-[state=on]:text-white">
              <BarChart2 className="w-4 h-4" />
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="h-6 w-px bg-white/10 mx-2" />

          <Button
            onClick={handleCreateNew}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Novo
          </Button>
        </div>
      </div>

      <ClientStatsDisplay stats={dynamicStats} />

      <div className="min-h-[400px]">
        {viewMode === 'monthly' ? (
          <div className="animate-in slide-in-from-left-4 duration-500">
            <ClientList
              clients={monthlyClients}
              onEdit={handleEdit}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
            />
            {monthlyClients.length === 0 && (
              <div className="text-center py-12 text-zinc-500">
                Nenhum cliente ativo neste período.
              </div>
            )}
          </div>
        ) : (
          <div className="h-[400px] w-full bg-zinc-950/50 border border-white/10 rounded-xl p-6 animate-in zoom-in-95 duration-500">
            <h3 className="text-lg font-medium text-white mb-6">Fluxo de Clientes ({selectedYear})</h3>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={annualData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} opacity={0.5} />
                <XAxis
                  dataKey="name"
                  stroke="#71717a"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', color: '#fff' }}
                  itemStyle={{ color: '#10b981' }}
                  formatter={(value: number) => [value, 'Clientes Ativos']}
                />
                <Line
                  type="monotone"
                  dataKey="clients"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ fill: '#10b981', r: 4 }}
                  activeDot={{ r: 6, fill: '#fff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <ClientForm
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        editingClient={editingClient}
      />
    </div>
  );
}