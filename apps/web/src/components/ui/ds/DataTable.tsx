import React from 'react';
import styles from './ds.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelect?: (selectedKeys: string[]) => void;
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  selectable = false,
  selectedKeys = [],
  onSelect,
  loading = false,
  emptyMessage = 'Nenhum registro encontrado.',
  onRowClick,
  className = '',
}: DataTableProps<T>) {
  const toggleSelect = (key: string) => {
    if (!onSelect) return;
    if (selectedKeys.includes(key)) {
      onSelect(selectedKeys.filter((k) => k !== key));
    } else {
      onSelect([...selectedKeys, key]);
    }
  };

  const toggleAll = () => {
    if (!onSelect) return;
    if (selectedKeys.length === data.length && data.length > 0) {
      onSelect([]);
    } else {
      onSelect(data.map(keyExtractor));
    }
  };

  const isAllSelected = data.length > 0 && selectedKeys.length === data.length;

  if (loading) {
    return (
      <div className={`${styles.tableContainer} ${className}`.trim()} aria-busy="true">
        <table className={styles.table}>
          <thead>
            <tr>
              {selectable && <th style={{ width: 40 }} aria-label="Seleção" />}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ textAlign: col.align || 'left', width: col.width }}
                  scope="col"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((i) => (
              <tr key={i}>
                {selectable && (
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ width: 16, height: 16, backgroundColor: 'var(--z-surface-secondary)', borderRadius: 3, margin: '0 auto' }} />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                    <div
                      style={{
                        width: '70%',
                        height: 14,
                        borderRadius: 4,
                        backgroundColor: 'var(--z-surface-secondary)',
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`${styles.tableContainer} ${className}`.trim()}>
      <table className={styles.table}>
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 40, textAlign: 'center' }} scope="col">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleAll}
                  aria-label="Selecionar todas as linhas"
                  style={{ cursor: 'pointer' }}
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ textAlign: col.align || 'left', width: col.width }}
                scope="col"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={selectable ? columns.length + 1 : columns.length}
                className={styles.emptyCell}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item) => {
              const key = keyExtractor(item);
              const isSelected = selectedKeys.includes(key);

              return (
                <tr
                  key={key}
                  className={[
                    isSelected ? styles.selected : '',
                    onRowClick ? styles.tableRowClickable : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onRowClick && onRowClick(item)}
                >
                  {selectable && (
                    <td
                      style={{ textAlign: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(key)}
                        aria-label={`Selecionar linha ${key}`}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{ textAlign: col.align || 'left' }}
                    >
                      {col.render ? col.render(item) : (item as Record<string, unknown>)[col.key] as React.ReactNode}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
