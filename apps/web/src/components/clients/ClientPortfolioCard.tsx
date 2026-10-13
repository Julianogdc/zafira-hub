import React from 'react';
import { ClientPortfolioItem, statusLabels } from '@/services/clients';
import { Badge } from '@/components/ui/ds';
import { ClientIdentityCell } from './ClientIdentityCell';
import styles from './ClientPortfolio.module.css';

interface ClientPortfolioCardProps {
  client: ClientPortfolioItem;
  onClick?: () => void;
}

export function ClientPortfolioCard({ client, onClick }: ClientPortfolioCardProps) {
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

  const isInteractive = Boolean(onClick);

  return (
    <article
      className={`${styles.mobileCard} ${isInteractive ? styles.mobileCardInteractive : ''}`.trim()}
      aria-label={`Cliente ${client.name}`}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
    >
      <div className={styles.mobileCardTop}>
        <ClientIdentityCell name={client.name} legalName={client.legalName} />
        <Badge variant={getBadgeVariant(client.status)}>
          {statusLabels[client.status] || client.status}
        </Badge>
      </div>

      <div className={styles.mobileCardGrid}>
        <div className={styles.mobileMetaItem}>
          <span className={styles.mobileMetaLabel}>Responsável</span>
          <span className={styles.mobileMetaValue}>
            {client.responsibleUser?.name || '—'}
          </span>
        </div>

        <div className={styles.mobileMetaItem}>
          <span className={styles.mobileMetaLabel}>Início</span>
          <span className={styles.mobileMetaValue}>
            {formatDate(client.startDate)}
          </span>
        </div>

        <div className={styles.mobileMetaItem}>
          <span className={styles.mobileMetaLabel}>Squad(s)</span>
          <span className={styles.mobileMetaValue}>
            {client.squads && client.squads.length > 0
              ? client.squads.map((s) => s.name).join(', ')
              : '—'}
          </span>
        </div>

        <div className={styles.mobileMetaItem}>
          <span className={styles.mobileMetaLabel}>Contato Principal</span>
          <span className={styles.mobileMetaValue}>
            {client.primaryContact?.name ? (
              <>
                <div>{client.primaryContact.name}</div>
                {(client.primaryContact.email || client.primaryContact.phone) && (
                  <span className={styles.contactSubtext}>
                    {client.primaryContact.email || client.primaryContact.phone}
                  </span>
                )}
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
