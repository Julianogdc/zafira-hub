import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, Users, Activity, Clock, UserCheck } from 'lucide-react';
import {
  ClientPortfolioItem,
  clientsService,
} from '@/services/clients';
import { ClientList } from '@/components/clients/ClientList';
import { ClientQuickView } from '@/components/clients/ClientQuickView';
import {
  Button,
  KpiCard,
  LoadingState,
  EmptyState,
  ErrorState,
  PermissionState,
} from '@/components/ui/ds';
import styles from '@/components/clients/ClientPortfolio.module.css';

export default function Clientes() {
  // 1. Array canônico completo da carteira acessível
  const [portfolioClients, setPortfolioClients] = useState<ClientPortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  // 2. Filtros de visualização local da Carteira
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // 3. Estado contextual do Quick View (Drawer do Cliente)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  const handleOpenQuickView = useCallback((clientId: string) => {
    setSelectedClientId(clientId);
    setQuickViewOpen(true);
  }, []);

  const handleCloseQuickView = useCallback(() => {
    setQuickViewOpen(false);
  }, []);

  /**
   * Busca a carteira completa uma única vez por carregamento ou refresh manual.
   * Não realiza requests HTTP por tecla ou por troca de filtro.
   */
  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await clientsService.listClients();
      setPortfolioClients(data || []);
    } catch (err: any) {
      console.error('Erro ao buscar carteira de clientes:', err);
      setError({
        status: err?.status || err?.response?.status,
        message: err?.message || 'Falha ao carregar a carteira de clientes.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // 3. KPIs calculados exclusivamente sobre a CARTEIRA COMPLETA acessível ao usuário (não são afetados por filtros visuais)
  const totalClients = useMemo(() => portfolioClients.length, [portfolioClients]);
  const activeClients = useMemo(
    () => portfolioClients.filter((c) => c.status === 'ACTIVE').length,
    [portfolioClients]
  );
  const pausedClients = useMemo(
    () => portfolioClients.filter((c) => c.status === 'PAUSED').length,
    [portfolioClients]
  );
  const leadClients = useMemo(
    () => portfolioClients.filter((c) => c.status === 'LEAD').length,
    [portfolioClients]
  );

  // 4. Filtragem local da Carteira via useMemo
  const visibleClients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return portfolioClients.filter((client) => {
      // Filtro de status
      if (selectedStatus !== 'ALL' && client.status !== selectedStatus) {
        return false;
      }

      // Filtro de busca textual (utiliza somente campos permitidos do ClientPortfolioItem)
      if (!term) return true;

      const nameMatch = client.name.toLowerCase().includes(term);
      const legalNameMatch = client.legalName?.toLowerCase().includes(term) ?? false;
      const respUserMatch = client.responsibleUser?.name.toLowerCase().includes(term) ?? false;
      const squadsMatch = client.squads?.some((s) => s.name.toLowerCase().includes(term)) ?? false;
      const contactNameMatch = client.primaryContact?.name?.toLowerCase().includes(term) ?? false;
      const contactEmailMatch = client.primaryContact?.email?.toLowerCase().includes(term) ?? false;
      const contactPhoneMatch = client.primaryContact?.phone?.toLowerCase().includes(term) ?? false;

      return (
        nameMatch ||
        legalNameMatch ||
        respUserMatch ||
        squadsMatch ||
        contactNameMatch ||
        contactEmailMatch ||
        contactPhoneMatch
      );
    });
  }, [portfolioClients, selectedStatus, searchTerm]);

  const isFiltered = Boolean(searchTerm.trim() || selectedStatus !== 'ALL');

  return (
    <div className={styles.container}>
      {/* 1. CABEÇALHO DA CARTEIRA */}
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h1 className={styles.headerTitle}>Clientes</h1>
          <p className={styles.headerDescription}>
            Gerencie e acompanhe a carteira de clientes da Zafira.
          </p>
        </div>

        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchClients}
            disabled={loading}
            iconLeft={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
            aria-label="Atualizar lista de clientes"
          >
            Atualizar
          </Button>
        </div>
      </header>

      {/* 2. KPIS DA CARTEIRA (GLOBIAS, CALCULADOS SOBRE A CARTEIRA COMPLETA) */}
      <section className={styles.kpiGrid} aria-label="Indicadores da Carteira">
        <KpiCard
          title="Total da carteira"
          value={totalClients}
          loading={loading && portfolioClients.length === 0}
          icon={<Users size={16} />}
        />
        <KpiCard
          title="Ativos"
          value={activeClients}
          loading={loading && portfolioClients.length === 0}
          icon={<Activity size={16} />}
        />
        <KpiCard
          title="Pausados"
          value={pausedClients}
          loading={loading && portfolioClients.length === 0}
          icon={<Clock size={16} />}
        />
        <KpiCard
          title="Leads"
          value={leadClients}
          loading={loading && portfolioClients.length === 0}
          icon={<UserCheck size={16} />}
        />
      </section>

      {/* 3. TOOLBAR E FILTROS */}
      <div className={styles.toolbar} role="search">
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar clientes..."
            className={styles.searchInput}
            aria-label="Buscar clientes"
          />
        </div>

        <div className={styles.filterGroup}>
          <label htmlFor="client-status-select" className={styles.filterLabel}>
            Status:
          </label>
          <select
            id="client-status-select"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className={styles.selectInput}
          >
            <option value="ALL">Todos</option>
            <option value="ACTIVE">Ativo</option>
            <option value="PAUSED">Pausado</option>
            <option value="INACTIVE">Inativo</option>
            <option value="LEAD">Lead</option>
          </select>
        </div>
      </div>

      {/* 4. CONTEÚDO PRINCIPAL / ESTADOS */}
      <main aria-live="polite">
        {loading && portfolioClients.length === 0 ? (
          <LoadingState message="Carregando carteira de clientes..." />
        ) : error ? (
          error.status === 403 ? (
            <PermissionState
              title="Acesso Restrito"
              description="Você não possui permissão para visualizar a carteira de clientes."
            />
          ) : (
            <ErrorState
              title="Erro ao carregar clientes"
              description={error.message}
              onRetry={fetchClients}
            />
          )
        ) : portfolioClients.length === 0 ? (
          <EmptyState
            title="Nenhum cliente disponível"
            description="Os clientes aparecerão aqui quando estiverem disponíveis para o seu acesso."
          />
        ) : visibleClients.length === 0 ? (
          <EmptyState
            title="Nenhum cliente encontrado"
            description="Tente ajustar os filtros ou o termo de busca."
          />
        ) : (
          <ClientList clients={visibleClients} onClientOpen={handleOpenQuickView} />
        )}
      </main>

      {/* 5. QUICK VIEW / DRAWER CONTEXTUAL DO CLIENTE */}
      <ClientQuickView
        clientId={selectedClientId}
        open={quickViewOpen}
        onClose={handleCloseQuickView}
      />
    </div>
  );
}