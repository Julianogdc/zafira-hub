import React from 'react';
import { ClientPortfolioItem, statusLabels } from '@/services/clients';
import { DataTable, Column, Badge } from '@/components/ui/ds';
import { ClientIdentityCell } from './ClientIdentityCell';
import { ClientPortfolioCard } from './ClientPortfolioCard';
import styles from './ClientPortfolio.module.css';

interface ClientListProps {
  clients: ClientPortfolioItem[];
  onClientOpen?: (clientId: string) => void;
}

export function ClientList({ clients, onClientOpen }: ClientListProps) {
  const getBadgeVariant = (status: string): 'success' | 'warning' | 'neutral' | 'info' => {
    switch (status) {
      case 'ACTIVE':
        return 'success';
      case 'PAUSED':
        return 'warning';
      case 'LEAD':
        return 'info';
      case 'INACTIVE':
      default:
        return 'neutral';
    }
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR');
    } catch {
      return '—';
    }
  };

  const columns: Column<ClientPortfolioItem>[] = [
    {
      key: 'name',
      header: 'Cliente',
      render: (client) => (
        <button
          type="button"
          className={styles.clientIdentityButton}
          onClick={(e) => {
            e.stopPropagation();
            onClientOpen && onClientOpen(client.id);
          }}
          aria-label={`Abrir visualização rápida de ${client.name}`}
        >
          <ClientIdentityCell name={client.name} legalName={client.legalName} />
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (client) => (
        <Badge variant={getBadgeVariant(client.status)}>
          {statusLabels[client.status] || client.status}
        </Badge>
      ),
    },
    {
      key: 'responsibleUser',
      header: 'Responsável',
      render: (client) =>
        client.responsibleUser?.name ? (
          <span>{client.responsibleUser.name}</span>
        ) : (
          <span className={styles.neutralDash}>—</span>
        ),
    },
    {
      key: 'squads',
      header: 'Squad(s)',
      render: (client) =>
        client.squads && client.squads.length > 0 ? (
          <div className={styles.squadsWrapper}>
            {client.squads.map((squad) => (
              <span key={squad.id} className={styles.squadBadge}>
                {squad.name}
              </span>
            ))}
          </div>
        ) : (
          <span className={styles.neutralDash}>—</span>
        ),
    },
    {
      key: 'primaryContact',
      header: 'Contato principal',
      render: (client) =>
        client.primaryContact?.name ? (
          <div className={styles.contactText}>
            <span>{client.primaryContact.name}</span>
            {(client.primaryContact.email || client.primaryContact.phone) && (
              <span className={styles.contactSubtext}>
                {client.primaryContact.email || client.primaryContact.phone}
              </span>
            )}
          </div>
        ) : (
          <span className={styles.neutralDash}>—</span>
        ),
    },
    {
      key: 'startDate',
      header: 'Início',
      width: 110,
      render: (client) =>
        client.startDate ? (
          <span>{formatDate(client.startDate)}</span>
        ) : (
          <span className={styles.neutralDash}>—</span>
        ),
    },
  ];

  return (
    <>
      {/* Tabela operacional para desktop e tablet (>= 641px) */}
      <div className={styles.desktopContainer}>
        <DataTable
          data={clients}
          columns={columns}
          keyExtractor={(item) => item.id}
          emptyMessage="Nenhum cliente disponível."
          onRowClick={(item) => onClientOpen && onClientOpen(item.id)}
        />
      </div>

      {/* Cards densos e verticais para mobile (<= 640px) */}
      <div className={styles.mobileContainer}>
        {clients.map((client) => (
          <ClientPortfolioCard
            key={client.id}
            client={client}
            onClick={() => onClientOpen && onClientOpen(client.id)}
          />
        ))}
      </div>
    </>
  );
}