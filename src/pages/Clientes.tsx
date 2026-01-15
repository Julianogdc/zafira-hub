import React, { useState, useEffect } from 'react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  BarChart2,
  Calendar as CalendarIcon,
  LayoutList,
  Users2,
  Filter,
  Search,
  Download
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useClientStore } from '../store/useClientStore';
import { useAuthStore } from '../store/useAuthStore';
import { Client } from '../types/client';
import { ClientStatsDisplay } from '../components/clients/ClientStats';
import { ClientList } from '../components/clients/ClientList';
import { ClientForm } from '../components/clients/ClientForm';
import { ClientHistorySheet } from '../components/clients/ClientHistorySheet';
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

  // Filter clients: Show all accessible clients (RLS handles security)
  const clients = allClients;

  // Controle do Modal (Sheet)
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // Controle do Histórico (Sheet)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [viewingHistoryClient, setViewingHistoryClient] = useState<Client | null>(null);

  // Navegação Temporal
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'monthly' | 'annual'>('monthly');

  const selectedMonth = currentDate.getMonth();
  const selectedYear = currentDate.getFullYear();

  // HELPER: Verifica apenas se as datas conferem com o período
  const isContractInPeriod = (client: Client, month: number, year: number) => {
    const periodStart = new Date(year, month, 1);
    const periodEnd = new Date(year, month + 1, 0);

    const start = client.contractStart ? new Date(client.contractStart + 'T00:00:00') : new Date(client.createdAt);
    // If no end date, assume active forever unless status says otherwise - but for "overlap", infinite end.
    const end = client.contractEnd ? new Date(client.contractEnd + 'T00:00:00') : new Date('2100-01-01');

    return start <= periodEnd && end >= periodStart;
  };

  // HELPER: Verifica se está ativo (Datas + Status Active)
  const isClientActiveInPeriod = (client: Client, month: number, year: number) => {
    return isContractInPeriod(client, month, year) && client.status === 'active';
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
  const activeClientsCount = clients.filter(c => isClientActiveInPeriod(c, selectedMonth, selectedYear)).length;
  // Inactive count: Clients who match the PERIOD (overlap) but are NOT active
  const inactiveClientsCount = clients.filter(c => isContractInPeriod(c, selectedMonth, selectedYear) && c.status !== 'active').length;

  const totalRevenue = calculateRevenue(selectedMonth, selectedYear);

  const dynamicStats = {
    totalClients: clients.length, // Total DB
    activeClients: activeClientsCount,
    inactiveClients: inactiveClientsCount,
    totalContractValue: totalRevenue,
    averageTicket: activeClientsCount > 0 ? totalRevenue / activeClientsCount : 0,

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

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'pending'>('all');

  // --- LISTA FILTRADA P/ MÊS ---
  const monthlyClients = clients.filter(c => {
    // 0. Search Term
    if (searchTerm && !c.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;

    // 1. Period check (Date overlap only)
    const inPeriod = isContractInPeriod(c, selectedMonth, selectedYear);
    if (!inPeriod) return false;

    // 2. Status Filter
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;

    // 3. Payment Filter
    if (paymentFilter !== 'all') {
      const currentMonthKey = `${(selectedMonth + 1).toString().padStart(2, '0')}/${selectedYear}`;
      const isPaid = c.paymentHistory?.some(p => p.month === currentMonthKey && p.status === 'paid');

      if (paymentFilter === 'paid' && !isPaid) return false;
      if (paymentFilter === 'pending' && isPaid) return false;
    }

    return true;
  });

  const handleExportCSV = () => {
    const headers = ['Nome', 'Status', 'Valor Contrato', 'Início', 'Fim', 'Dia Pagamento'];
    const rows = monthlyClients.map(c => [
      c.name,
      c.status === 'active' ? 'Ativo' : 'Inativo',
      c.contractValue.toString().replace('.', ','),
      c.contractStart || '-',
      c.contractEnd || '-',
      c.paymentDay || '-'
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(r => r.join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clientes_${selectedMonth + 1}_${selectedYear}.csv`;
    link.click();
  };

  const handleCreateNew = () => {
    setEditingClient(null);
    setIsSheetOpen(true);
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setIsSheetOpen(true);
  };

  const handleViewHistory = (client: Client) => {
    setViewingHistoryClient(client);
    setIsHistoryOpen(true);
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

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input
              placeholder="Buscar cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 w-full sm:w-[280px] pl-9 bg-zinc-950/50 border-white/10 text-sm text-zinc-300 placeholder:text-zinc-500 focus-visible:ring-emerald-500/20"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-9 w-[130px] bg-zinc-950/50 border-white/10 text-sm text-zinc-300 hover:bg-white/5 focus:ring-0">
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-zinc-500" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>

          <Select value={paymentFilter} onValueChange={(v) => setPaymentFilter(v as any)}>
            <SelectTrigger className="h-9 w-[130px] bg-zinc-950/50 border-white/10 text-sm text-zinc-300 hover:bg-white/5 focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Pagam.</SelectItem>
              <SelectItem value="paid">Pagos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="icon" onClick={handleExportCSV} title="Exportar CSV" className="h-9 w-9 border-white/10 bg-zinc-950/50 text-zinc-400 hover:text-white hover:bg-white/5">
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-[400px]">
        {viewMode === 'monthly' ? (
          <div className="animate-in slide-in-from-left-4 duration-500">
            <ClientList
              clients={monthlyClients}
              onEdit={handleEdit}
              onViewHistory={handleViewHistory}
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

      <ClientHistorySheet
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        client={viewingHistoryClient}
      />
    </div>
  );
}