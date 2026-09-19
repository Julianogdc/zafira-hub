import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Users2,
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  DollarSign,
  Activity,
  Users,
  Clock,
} from 'lucide-react';
import {
  HubClient,
  ApiClientStatus,
  clientsService,
  statusLabels,
} from '@/services/clients';
import { ClientList } from '@/components/clients/ClientList';
import { ClientForm } from '@/components/clients/ClientForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Clientes() {
  const [clients, setClients] = useState<HubClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Modal de Criação / Edição
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<HubClient | null>(null);

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await clientsService.listClients({
        status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
        search: searchTerm.trim() || undefined,
      });
      setClients(data);
    } catch (err: any) {
      console.error('Erro ao buscar clientes:', err);
      setError(err?.message || 'Falha ao carregar a lista de clientes da API.');
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, searchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchClients();
    }, 250);

    return () => clearTimeout(timer);
  }, [fetchClients]);

  // Cálculos de Resumo (KPIs)
  const totalClients = clients.length;
  const activeClients = clients.filter((c) => c.status === 'ACTIVE').length;
  const pausedClients = clients.filter((c) => c.status === 'PAUSED').length;
  const leadClients = clients.filter((c) => c.status === 'LEAD').length;
  const totalContractValue = clients
    .filter((c) => c.status === 'ACTIVE')
    .reduce((acc, curr) => {
      const val = typeof curr.contractValue === 'string' ? parseFloat(curr.contractValue) : curr.contractValue;
      return acc + (val || 0);
    }, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const handleCreateNew = () => {
    setEditingClient(null);
    setIsSheetOpen(true);
  };

  const handleEdit = (client: HubClient) => {
    setEditingClient(client);
    setIsSheetOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Gestão de Clientes"
          description="Gerencie a carteira, acompanhe contratos e acerte integrações no Hub 2.0."
          icon={Users2}
        />

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchClients}
            disabled={loading}
            className="border-white/10 text-zinc-400 hover:text-white hover:bg-white/5"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            onClick={handleCreateNew}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm shadow-emerald-900/20"
          >
            <Plus className="w-4 h-4" />
            Novo Cliente
          </Button>
        </div>
      </div>

      {/* CARDS DE RESUMO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Total de Clientes</CardTitle>
            <Users className="w-4 h-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalClients}</div>
            <p className="text-[11px] text-zinc-500 mt-1">Cadastrados na organização</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-emerald-400/90">Clientes Ativos</CardTitle>
            <Activity className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{activeClients}</div>
            <p className="text-[11px] text-zinc-500 mt-1">Contratos vigentes</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-amber-400/90">Pausados / Leads</CardTitle>
            <Clock className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {pausedClients + leadClients}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">{pausedClients} pausados • {leadClients} leads</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-blue-400/90">Receita Recorrente</CardTitle>
            <DollarSign className="w-4 h-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {formatCurrency(totalContractValue)}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">Total de ativos no mês</p>
          </CardContent>
        </Card>
      </div>

      {/* BARRA DE FILTROS E BUSCA */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-950/40 p-3 rounded-xl border border-white/10 backdrop-blur-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome, documento ou e-mail..."
            className="pl-9 bg-zinc-900/60 border-white/10 text-white placeholder:text-zinc-500 focus-visible:ring-emerald-500 h-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 shrink-0">Status:</span>
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[140px] bg-zinc-900/60 border-white/10 text-white text-xs h-9">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-white/10 text-white">
              <SelectItem value="ALL">Todos os status</SelectItem>
              <SelectItem value="ACTIVE">{statusLabels.ACTIVE}</SelectItem>
              <SelectItem value="PAUSED">{statusLabels.PAUSED}</SelectItem>
              <SelectItem value="INACTIVE">{statusLabels.INACTIVE}</SelectItem>
              <SelectItem value="LEAD">{statusLabels.LEAD}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* LISTAGEM, LOADING OU ERRO */}
      <div className="min-h-[360px]">
        {loading && clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            <p className="text-sm">Carregando clientes do Hub 2.0...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-xl border border-red-500/20 bg-red-500/5 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
            <h3 className="text-base font-semibold text-white">Erro ao carregar clientes</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchClients}
              className="border-red-500/30 text-red-300 hover:bg-red-500/10"
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <ClientList clients={clients} onEdit={handleEdit} />
        )}
      </div>

      {/* Modal/Sheet de Criação e Edição */}
      <ClientForm
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        editingClient={editingClient}
        onSuccess={fetchClients}
      />
    </div>
  );
}