import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  DollarSign,
  Activity,
  User as UserIcon,
  Link2,
  Mail,
  Phone,
  Calendar,
  Building2,
  FileText,
  Clock,
  Layers,
  BarChart3,
  TrendingUp,
  FolderGit2,
  Share2,
  History,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  HubClient,
  clientsService,
  statusLabels,
  statusColors,
  ApiClientStatus,
  UpdateClientDTO,
} from '@/services/clients';
import { useAuthStore } from '@/store/useAuthStore';
import { Cliente360Projetos } from '@/components/clients/Cliente360Projetos';
import { Cliente360Conteudo } from '@/components/clients/Cliente360Conteudo';
import { ManagePostizIntegrationsModal } from '@/components/clients/ManagePostizIntegrationsModal';
import { Badge } from '@/components/ui/badge';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function Cliente360() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'visao-geral';
  const { user } = useAuthStore();
  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const [client, setClient] = useState<HubClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado do Modal de Edição
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<UpdateClientDTO>({});

  // Estado do Modal de Integrações Postiz
  const [isManagePostizOpen, setIsManagePostizOpen] = useState(false);
  const [contentRefreshKey, setContentRefreshKey] = useState(0);

  const handleIntegrationsChanged = () => {
    fetchClient();
    setContentRefreshKey((prev) => prev + 1);
  };

  const fetchClient = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await clientsService.getClientById(id);
      setClient(data);
    } catch (err: any) {
      console.error('Erro ao buscar cliente:', err);
      setError(err?.message || 'Não foi possível carregar os dados do cliente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClient();
  }, [id]);

  const openEditModal = () => {
    if (!client) return;
    setFormData({
      name: client.name,
      legalName: client.legalName || '',
      document: client.document || '',
      email: client.email || '',
      phone: client.phone || '',
      status: client.status,
      contractValue: client.contractValue ? Number(client.contractValue) : 0,
      startDate: client.startDate ? client.startDate.split('T')[0] : '',
      endDate: client.endDate ? client.endDate.split('T')[0] : '',
      notes: client.notes || '',
    });
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !id) return;

    if (!formData.name?.trim()) {
      toast.error('O nome do cliente é obrigatório.');
      return;
    }

    try {
      setIsSaving(true);
      const updated = await clientsService.updateClient(id, {
        ...formData,
        contractValue: formData.contractValue ? Number(formData.contractValue) : null,
        startDate: formData.startDate ? new Date(formData.startDate).toISOString() : null,
        endDate: formData.endDate ? new Date(formData.endDate).toISOString() : null,
      });

      setClient(updated);
      setIsEditDialogOpen(false);
      toast.success('Cliente atualizado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao atualizar cliente:', err);
      toast.error(err?.data?.message || err?.message || 'Erro ao atualizar dados do cliente.');
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (val?: number | string | null) => {
    if (val === null || val === undefined || isNaN(Number(val))) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(Number(val));
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Não definida';
    return new Date(dateStr).toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[450px] gap-3">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        <span className="text-sm text-zinc-400">Carregando visão 360° do cliente...</span>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-semibold text-white">Cliente não encontrado</h2>
        <p className="text-sm text-zinc-400">{error || 'O cliente solicitado não existe ou foi removido.'}</p>
        <Button onClick={() => navigate('/clientes')} variant="outline" className="border-white/10 gap-2">
          <ArrowLeft className="w-4 h-4" /> Voltar para lista de clientes
        </Button>
      </div>
    );
  }

  const badgeStyle = statusColors[client.status] || statusColors.ACTIVE;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {/* Barra superior de navegação */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/clientes')}
          className="text-zinc-400 hover:text-white gap-2 px-2.5"
        >
          <ArrowLeft className="w-4 h-4" /> Clientes
        </Button>
        <span className="text-zinc-600">/</span>
        <span className="text-sm text-zinc-400 font-medium truncate max-w-md">{client.name}</span>
      </div>

      {/* CABEÇALHO DO CLIENTE 360 */}
      <div className="p-6 rounded-xl bg-zinc-950/40 border border-white/10 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">{client.name}</h1>
            <Badge variant="outline" className={`${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border} px-2.5 py-0.5 text-xs font-semibold`}>
              {statusLabels[client.status] || client.status}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-400">
            {client.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-zinc-500" />
                <span>{client.email}</span>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-zinc-500" />
                <span>{client.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-zinc-500" />
              <span>Responsável: {client.responsibleUser?.name || 'Não atribuído'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
              <span>Início: {formatDate(client.startDate)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button
            onClick={openEditModal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm shadow-emerald-900/20"
            size="sm"
          >
            <Edit2 className="w-4 h-4" /> Editar cliente
          </Button>
        </div>
      </div>

      {/* CARDS DE RESUMO (KPIs) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Valor do Contrato</CardTitle>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">{formatCurrency(client.contractValue)}</div>
            <p className="text-[11px] text-zinc-500 mt-1">Recorrência mensal</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Status Cadastral</CardTitle>
            <Activity className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white capitalize">{statusLabels[client.status] || client.status}</div>
            <p className="text-[11px] text-zinc-500 mt-1">Situação na carteira</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Responsável</CardTitle>
            <UserIcon className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-base font-semibold text-white truncate">
              {client.responsibleUser?.name || 'Não atribuído'}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1 truncate">{client.responsibleUser?.email || 'Membro Zafira'}</p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-950/40 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-zinc-400">Integrações Conectadas</CardTitle>
            <Link2 className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">
              {client.integrations?.length || 0}
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">Fontes vinculadas</p>
          </CardContent>
        </Card>
      </div>

      {/* ABAS DO CLIENTE 360 */}
      <Tabs
        value={currentTab}
        onValueChange={(val) => setSearchParams({ tab: val }, { replace: true })}
        className="space-y-6"
      >
        <TabsList className="bg-zinc-900/60 p-1 border border-white/10 rounded-lg flex flex-wrap h-auto gap-1">
          <TabsTrigger value="visao-geral" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <Layers className="w-3.5 h-3.5" /> Visão Geral
          </TabsTrigger>
          <TabsTrigger value="financeiro" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Financeiro
          </TabsTrigger>
          <TabsTrigger value="crm" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> CRM
          </TabsTrigger>
          <TabsTrigger value="projetos" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <FolderGit2 className="w-3.5 h-3.5" /> Projetos
          </TabsTrigger>
          <TabsTrigger value="conteudo" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <Share2 className="w-3.5 h-3.5" /> Conteúdo
          </TabsTrigger>
          <TabsTrigger value="performance" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Performance
          </TabsTrigger>
          <TabsTrigger value="relatorios" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Relatórios
          </TabsTrigger>
          <TabsTrigger value="historico" className="data-[state=on]:bg-emerald-600 data-[state=on]:text-white text-xs gap-1.5 py-1.5">
            <History className="w-3.5 h-3.5" /> Histórico
          </TabsTrigger>
        </TabsList>

        {/* 1. ABA: VISÃO GERAL (DADOS REAIS + INTEGRAÇÕES) */}
        <TabsContent value="visao-geral" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Informações Cadastrais */}
            <Card className="lg:col-span-2 bg-zinc-950/40 border-white/10">
              <CardHeader>
                <CardTitle className="text-base font-medium text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-400" /> Dados Cadastrais & Contratuais
                </CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                  Parâmetros consolidados do cliente no Zafira Hub 2.0
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Nome Fantasia</span>
                    <p className="text-zinc-200 font-medium">{client.name}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Razão Social</span>
                    <p className="text-zinc-200">{client.legalName || 'Não informada'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Documento (CNPJ/CPF)</span>
                    <p className="text-zinc-200">{client.document || 'Não informado'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">E-mail de Contato</span>
                    <p className="text-zinc-200">{client.email || 'Não informado'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Telefone / WhatsApp</span>
                    <p className="text-zinc-200">{client.phone || 'Não informado'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Vigência Inicial</span>
                    <p className="text-zinc-200">{formatDate(client.startDate)}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Vigência Final / Renovação</span>
                    <p className="text-zinc-200">{formatDate(client.endDate)}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-zinc-500 font-medium">Última Atualização</span>
                    <p className="text-zinc-200">{new Date(client.updatedAt).toLocaleString('pt-BR')}</p>
                  </div>
                </div>

                {client.notes && (
                  <div className="pt-4 border-t border-white/5 space-y-1">
                    <span className="text-xs text-zinc-500 font-medium flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Observações Internas
                    </span>
                    <p className="text-xs text-zinc-300 bg-zinc-900/40 p-3 rounded-md border border-white/5 whitespace-pre-wrap">
                      {client.notes}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Seção de Integrações */}
            <Card className="bg-zinc-950/40 border-white/10">
              <CardHeader className="flex flex-row items-start justify-between pb-3 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="text-base font-medium text-white flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-emerald-400" /> Integrações Conectadas
                  </CardTitle>
                  <CardDescription className="text-xs text-zinc-500">
                    Pontes de dados externas do Cliente 360
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsManagePostizOpen(true)}
                  className="border-white/10 hover:bg-white/5 text-xs text-zinc-300 gap-1.5 h-8 shrink-0"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                  Gerenciar Postiz
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {client.integrations && client.integrations.length > 0 ? (
                  client.integrations.map((integ) => (
                    <div
                      key={integ.id}
                      className="p-3 rounded-lg bg-zinc-900/60 border border-white/5 space-y-1 hover:border-white/15 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] font-semibold">
                          {integ.provider}
                        </Badge>
                        <span className="text-[10px] text-zinc-500">{new Date(integ.createdAt).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <p className="text-xs text-zinc-300 font-mono mt-1">ID Externo: {integ.externalId}</p>
                      {integ.metadata && (
                        <pre className="text-[10px] text-zinc-500 bg-black/30 p-1.5 rounded overflow-x-auto mt-1 font-mono">
                          {JSON.stringify(integ.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-8 text-center space-y-3">
                    <Link2 className="w-8 h-8 text-zinc-600 mx-auto opacity-40" />
                    <p className="text-xs text-zinc-500">Nenhuma integração conectada a este cliente.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsManagePostizOpen(true)}
                      className="border-white/10 hover:bg-white/5 text-xs text-emerald-400 gap-1.5 mx-auto"
                    >
                      <Plus className="w-3.5 h-3.5" /> Conectar Postiz
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 2. ABA: FINANCEIRO (PLACEHOLDER) */}
        <TabsContent value="financeiro" className="outline-none">
          <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
            <DollarSign className="w-10 h-10 text-zinc-600 mx-auto opacity-50" />
            <h3 className="text-base font-semibold text-white">Módulo Financeiro</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Financeiro será conectado ao módulo financeiro do Hub 2.0.
            </p>
          </Card>
        </TabsContent>

        {/* 3. ABA: CRM (PLACEHOLDER) */}
        <TabsContent value="crm" className="outline-none">
          <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
            <TrendingUp className="w-10 h-10 text-zinc-600 mx-auto opacity-50" />
            <h3 className="text-base font-semibold text-white">Funil & Oportunidades CRM</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              CRM será integrado ao Twenty.
            </p>
          </Card>
        </TabsContent>

        {/* 4. ABA: PROJETOS (INTEGRAÇÃO ASANA REAL) */}
        <TabsContent value="projetos" className="outline-none">
          <Cliente360Projetos clientId={client.id} canManage={canManage} />
        </TabsContent>

        {/* 5. ABA: CONTEÚDO (POSTIZ REAL) */}
        <TabsContent value="conteudo" className="outline-none">
          <Cliente360Conteudo
            clientId={client.id}
            refreshTrigger={contentRefreshKey}
            onManageIntegrations={() => setIsManagePostizOpen(true)}
          />
        </TabsContent>

        {/* 6. ABA: PERFORMANCE (PLACEHOLDER) */}
        <TabsContent value="performance" className="outline-none">

          <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
            <BarChart3 className="w-10 h-10 text-zinc-600 mx-auto opacity-50" />
            <h3 className="text-base font-semibold text-white">Métricas & Mídia Paga</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Performance será integrada às fontes Meta Ads e Google Ads.
            </p>
          </Card>
        </TabsContent>

        {/* 7. ABA: RELATÓRIOS (PLACEHOLDER) */}
        <TabsContent value="relatorios" className="outline-none">
          <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
            <FileSpreadsheet className="w-10 h-10 text-zinc-600 mx-auto opacity-50" />
            <h3 className="text-base font-semibold text-white">Dashboards Analíticos</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Relatórios será conectado ao Metabase.
            </p>
          </Card>
        </TabsContent>

        {/* 8. ABA: HISTÓRICO (PLACEHOLDER) */}
        <TabsContent value="historico" className="outline-none">
          <Card className="bg-zinc-950/40 border-white/10 p-12 text-center space-y-3">
            <History className="w-10 h-10 text-zinc-600 mx-auto opacity-50" />
            <h3 className="text-base font-semibold text-white">Trilha de Auditoria</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Histórico consolidará ações, alterações e eventos deste cliente.
            </p>
          </Card>
        </TabsContent>
      </Tabs>

      {/* MODAL DE EDIÇÃO DO CLIENTE */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-zinc-950 border border-white/10 text-white sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg text-white">Editar Cliente</DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Atualize as informações cadastrais e contratuais do cliente.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEdit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Nome Fantasia *</Label>
              <Input
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-zinc-900/60 border-white/10 text-sm focus-visible:ring-emerald-500"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Razão Social</Label>
                <Input
                  value={formData.legalName || ''}
                  onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                  className="bg-zinc-900/60 border-white/10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">CNPJ / CPF</Label>
                <Input
                  value={formData.document || ''}
                  onChange={(e) => setFormData({ ...formData, document: e.target.value })}
                  className="bg-zinc-900/60 border-white/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">E-mail</Label>
                <Input
                  type="email"
                  value={formData.email || ''}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="bg-zinc-900/60 border-white/10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Telefone / WhatsApp</Label>
                <Input
                  value={formData.phone || ''}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="bg-zinc-900/60 border-white/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Status</Label>
                <Select
                  value={formData.status || 'ACTIVE'}
                  onValueChange={(val: ApiClientStatus) => setFormData({ ...formData, status: val })}
                >
                  <SelectTrigger className="bg-zinc-900/60 border-white/10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-zinc-200">
                    <SelectItem value="ACTIVE" className="text-emerald-400">Ativo</SelectItem>
                    <SelectItem value="PAUSED" className="text-amber-400">Pausado</SelectItem>
                    <SelectItem value="INACTIVE" className="text-zinc-400">Inativo</SelectItem>
                    <SelectItem value="LEAD" className="text-blue-400">Lead</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Valor do Contrato (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.contractValue !== undefined && formData.contractValue !== null ? formData.contractValue : ''}
                  onChange={(e) => setFormData({ ...formData, contractValue: e.target.value ? parseFloat(e.target.value) : 0 })}
                  className="bg-zinc-900/60 border-white/10 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Data de Início</Label>
                <Input
                  type="date"
                  value={formData.startDate || ''}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="bg-zinc-900/60 border-white/10 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-300">Data de Término / Renovação</Label>
                <Input
                  type="date"
                  value={formData.endDate || ''}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="bg-zinc-900/60 border-white/10 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Observações</Label>
              <Textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="bg-zinc-900/60 border-white/10 text-sm min-h-[80px]"
                placeholder="Detalhes adicionais sobre o contrato ou alinhamentos..."
              />
            </div>

            <DialogFooter className="pt-4 border-t border-white/10 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                className="border-white/10 hover:bg-zinc-900"
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...
                  </>
                ) : (
                  'Salvar Alterações'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Gestão de Integrações Postiz */}
      {client && (
        <ManagePostizIntegrationsModal
          open={isManagePostizOpen}
          onOpenChange={setIsManagePostizOpen}
          clientId={client.id}
          clientName={client.name}
          canManage={canManage}
          onIntegrationsChanged={handleIntegrationsChanged}
        />
      )}
    </div>
  );
}

