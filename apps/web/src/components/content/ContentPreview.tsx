import React, { useState } from 'react';
import { truncateCaption } from '@/lib/content-view';
import styles from './ContentPreview.module.css';

export type PreviewFormat = 'FEED_IMAGE' | 'CAROUSEL' | 'REEL' | 'STORY';

export interface PreviewMedia {
  /** URL ja autorizada (blob local ou URL curta assinada). Nunca uma chave de armazenamento. */
  url: string;
  kind: 'IMAGE' | 'VIDEO';
  alt?: string;
}

export interface ContentPreviewProps {
  format: PreviewFormat;
  brandName: string;
  caption: string;
  media: PreviewMedia[];
  /** Quantos caracteres da legenda antes de "mais" (padrao 125, como no Instagram). */
  captionLimit?: number;
}

const KIND_LABEL: Record<PreviewFormat, string> = {
  FEED_IMAGE: 'Feed',
  CAROUSEL: 'Carrossel',
  REEL: 'Reel',
  STORY: 'Story',
};

/**
 * Pre-visualizacao ILUSTRATIVA inspirada no Instagram (nao garante a renderizacao real da rede).
 * Componente de apresentacao puro: sem rede, sem sessao; reutilizado na pagina publica (F8-2) e no
 * painel interno, e destinado ao portal autenticado da F16.
 */
export function ContentPreview({ format, brandName, caption, media, captionLimit = 125 }: ContentPreviewProps) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const shown = format === 'CAROUSEL' ? media : media.slice(0, 1);
  const current = shown[Math.min(index, Math.max(0, shown.length - 1))];
  const cap = truncateCaption(caption, captionLimit);
  const initial = (brandName.trim()[0] ?? '?').toUpperCase();

  return (
    <div data-testid="content-preview" data-format={format}>
      <div className={styles.frame}>
        <div className={styles.header}>
          <span className={styles.avatar} aria-hidden="true">{initial}</span>
          <span className={styles.brand}>{brandName}</span>
          <span className={styles.kind}>{KIND_LABEL[format]}</span>
        </div>
        <div className={styles.stage} data-format={format}>
          {format === 'STORY' && shown.length > 0 ? (
            <div className={styles.bars} aria-hidden="true"><span className={`${styles.bar} ${styles.barOn}`} /></div>
          ) : null}
          {!current ? (
            <p className={styles.empty}>Nenhum arquivo para exibir.</p>
          ) : current.kind === 'VIDEO' ? (
            <video key={current.url} className={styles.media} src={current.url} controls playsInline preload="metadata" data-testid="preview-video" />
          ) : (
            <img key={current.url} className={styles.media} src={current.url} alt={current.alt ?? `Arquivo ${index + 1}`} data-testid="preview-image" />
          )}
          {format === 'CAROUSEL' && shown.length > 1 ? (
            <>
              <button type="button" className={`${styles.nav} ${styles.prev}`} aria-label="Arquivo anterior" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))} data-testid="preview-prev">‹</button>
              <button type="button" className={`${styles.nav} ${styles.next}`} aria-label="Próximo arquivo" disabled={index >= shown.length - 1} onClick={() => setIndex((i) => Math.min(shown.length - 1, i + 1))} data-testid="preview-next">›</button>
            </>
          ) : null}
        </div>
        {format === 'CAROUSEL' && shown.length > 1 ? (
          <div className={styles.dots} aria-label={`Arquivo ${index + 1} de ${shown.length}`}>
            {shown.map((_, i) => (
              <span key={i} className={`${styles.dot} ${i === index ? styles.dotOn : ''}`} />
            ))}
          </div>
        ) : null}
        {format !== 'STORY' ? (
          <div className={styles.actions} aria-hidden="true"><span>♡</span><span>💬</span><span>➤</span></div>
        ) : null}
        {caption ? (
          <p className={styles.caption} data-testid="preview-caption">
            <strong>{brandName}</strong>
            {expanded || !cap.truncated ? caption : `${cap.text}… `}
            {cap.truncated && !expanded ? (
              <button type="button" className={styles.more} onClick={() => setExpanded(true)}>mais</button>
            ) : null}
          </p>
        ) : null}
      </div>
      <p className={styles.note}>Pré-visualização ilustrativa: a aparência final na rede pode variar.</p>
    </div>
  );
}
