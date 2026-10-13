import React from 'react';
import styles from './ClientPortfolio.module.css';

interface ClientIdentityCellProps {
  name: string;
  legalName?: string | null;
}

/**
 * Extrai até 2 iniciais a partir do nome para o monograma determinístico.
 */
function getMonogram(name: string): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ClientIdentityCell({ name, legalName }: ClientIdentityCellProps) {
  const monogram = getMonogram(name);

  return (
    <div className={styles.identityWrapper}>
      <div className={styles.monogram} aria-hidden="true">
        {monogram}
      </div>
      <div className={styles.identityText}>
        <span className={styles.clientName} title={name}>
          {name}
        </span>
        {legalName && (
          <span className={styles.clientLegalName} title={legalName}>
            {legalName}
          </span>
        )}
      </div>
    </div>
  );
}
