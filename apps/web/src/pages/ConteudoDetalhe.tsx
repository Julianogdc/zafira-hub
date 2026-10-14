import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2, Upload } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { Banner } from '@/components/onboarding/OnboardingShell';
import { ContentPreview } from '@/components/content/ContentPreview';
import { PublicationPanel } from '@/components/content/PublicationPanel';
import { resolveTimeZone } from '@/lib/organization-time';
import {
  ApprovalOverview,
  CreatedApprovalLink,
  ContentDetail,
  ContentMediaView,
  contentErrorInfo,
  contentService,
  useContentCapabilities,
  type ContentFormat,
} from '@/services/content';
import {
  ACCEPTED_LABEL,
  ACCEPT_ATTR,
  APPROVAL_STATUS,
  CHANNEL_LABEL,
  approvalUrl,
  clampDays,
  FORMAT_OPTIONS,
  contentEventLabel,
  formatBytes,
  formatLabel,
  localFileProblem,
  mediaLimits,
  previewAspect,
} from '@/lib/content-view';
import styles from './Onboarding.module.css';

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Pre-visualizacao do arquivo via blob autorizado (sessao + carteira); nunca URL publica. */
function MediaThumb({ itemId, media, aspect }: { itemId: string; media: ContentMediaView; aspect: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    contentService
      .fileBlobUrl(itemId, media.id)
      .then((u) => {
        created = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [itemId, media.id]);
  const box: React.CSSProperties = {
    aspectRatio: aspect,
    width: '100%',
    maxWidth: 220,
    objectFit: 'cover',
    borderRadius: 8,
    background: 'var(--surface-2, rgba(127,127,127,0.12))',
  };
  if (failed) return <div style={{ ...box, display: 'grid', placeItems: 'center' }}><span className={styles.help}>Prévia indisponível</span></div>;
  if (!url) return <div style={box} aria-busy="true" />;
  return media.kind === 'VIDEO' ? (
    <video src={url} style={box} controls preload="metadata" />
  ) : (
    <img src={url} alt={media.originalFilename} style={box} />
  );
}

/** F8-1 - Detalhe do conteudo: dados, arquivos finais, versoes e historico. */
export default function ConteudoDetalhe() {
  const { id = '' } = useParams();
  const { currentOrganization } = useAuthStore();
  const caps = useContentCapabilities(currentOrganization?.id);

  const [detail, setDetail] = useState<ContentDetail | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ title: string; format: ContentFormat; caption: string; asanaTaskGid: string }>({
    title: '',
    format: 'FEED_IMAGE',
    caption: '',
    asanaTaskGid: '',
  });
  const [approval, setApproval] = useState<ApprovalOverview | null>(null);
  const [createdLink, setCreatedLink] = useState<CreatedApprovalLink | null>(null);
  const [linkDays, setLinkDays] = useState(7);
  const [linkChannel, setLinkChannel] = useState<'WHATSAPP' | 'EMAIL' | 'OTHER'>('WHATSAPP');
  const [linkLabel, setLinkLabel] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const sync = (d: ContentDetail) => {
    setDetail(d);
    const cur = d.versions[d.versions.length - 1];
    setForm({ title: d.title, format: d.format, caption: cur?.caption ?? '', asanaTaskGid: d.asanaTaskGid ?? '' });
  };

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      sync(await contentService.get(id));
    } catch (e) {
      const info = contentErrorInfo(e);
      setLoadError({ status: info.status, message: info.message });
      setDetail(null);
    }
  }, [id]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  const loadApproval = useCallback(async () => {
    try {
      setApproval(await contentService.approval(id));
    } catch {
      setApproval(null);
    }
  }, [id]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void loadApproval();
  }, [caps.loading, caps.view, loadApproval, detail?.updatedAt, detail?.versions.length]);

  const activeKey = detail
    ? detail.versions[detail.versions.length - 1].media.filter((m) => !m.removedAt).map((m) => m.id).join(',')
    : '';
  useEffect(() => {
    if (!detail || !activeKey) {
      setPreviewUrls({});
      return;
    }
    let alive = true;
    const created: string[] = [];
    const ids = activeKey.split(',');
    Promise.all(ids.map((mid) => contentService.fileBlobUrl(detail.id, mid).then((u) => [mid, u] as const).catch(() => null))).then((pairs) => {
      const map: Record<string, string> = {};
      for (const p of pairs) {
        if (!p) continue;
        created.push(p[1]);
        map[p[0]] = p[1];
      }
      if (alive) setPreviewUrls(map);
      else created.forEach((u) => URL.revokeObjectURL(u));
    });
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, activeKey]);

  const sendLink = async () => {
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    try {
      const out = await contentService.createApprovalLink(detail.id, {
        expiresInDays: clampDays(linkDays),
        recipientLabel: linkLabel.trim() || null,
        channel: linkChannel,
      });
      setCreatedLink(out);
      sync(await contentService.get(detail.id));
      // Gerar ou reemitir o link nao altera o conteudo (updatedAt/versoes), entao o painel de
      // aprovacao precisa ser recarregado aqui: status, lista de links e botao Revogar.
      await loadApproval();
      setNotice({ kind: 'ok', text: out.reissued ? 'Novo link gerado; o anterior foi revogado.' : 'Link de aprovação gerado.' });
    } catch (e) {
      const info = contentErrorInfo(e);
      setNotice({ kind: info.status === 409 ? 'warn' : 'danger', text: info.message });
    } finally {
      setBusy(false);
    }
  };

  const revokeLink = async (linkId: string) => {
    if (!detail) return;
    setBusy(true);
    setNotice(null);
    try {
      setApproval(await contentService.revokeApprovalLink(detail.id, linkId));
      setCreatedLink(null);
      setNotice({ kind: 'ok', text: 'Link revogado. Ele deixa de aceitar visualizações e respostas.' });
    } catch (e) {
      setNotice({ kind: 'danger', text: contentErrorInfo(e).message });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(approvalUrl(window.location.origin, createdLink.path));
      setNotice({ kind: 'ok', text: 'Link copiado.' });
    } catch {
      setNotice({ kind: 'warn', text: 'Não foi possível copiar automaticamente. Selecione o link e copie.' });
    }
  };

  const act = async (call: () => Promise<ContentDetail>, okText: string) => {
    setBusy(true);
    setNotice(null);
    try {
      sync(await call());
      setNotice({ kind: 'ok', text: okText });
    } catch (e) {
      const info = contentErrorInfo(e);
      setNotice({ kind: info.status === 409 ? 'warn' : 'danger', text: info.message });
      if (info.status === 409) void load();
    } finally {
      setBusy(false);
    }
  };

  if (caps.loading) {
    return (
      <div className={styles.container}>
        <LoadingState message="Carregando permissões..." />
      </div>
    );
  }
  if (!caps.view) {
    return (
      <div className={styles.container}>
        <PermissionState title="Sem permissão para ver conteúdos" description="Seu perfil não tem acesso aos conteúdos desta organização." />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className={styles.container}>
        <ErrorState
          title={loadError.status === 404 ? 'Conteúdo não encontrado' : 'Não foi possível carregar o conteúdo'}
          description={loadError.status === 404 ? 'Ele não existe ou não está na sua carteira.' : loadError.message}
          onRetry={loadError.status === 404 ? undefined : () => void load()}
        />
      </div>
    );
  }
  if (!detail) {
    return (
      <div className={styles.container}>
        <LoadingState message="Carregando conteúdo..." />
      </div>
    );
  }

  const current = detail.versions[detail.versions.length - 1];
  const active = current.media.filter((m) => !m.removedAt);
  const canEdit = caps.create && detail.editable;
  const limits = mediaLimits(detail.format);
  const full = active.length >= limits.max;
  const dirty =
    form.title !== detail.title ||
    form.format !== detail.format ||
    form.caption !== current.caption ||
    (form.asanaTaskGid || '') !== (detail.asanaTaskGid ?? '');

  const save = () =>
    act(
      () =>
        contentService.update(detail.id, {
          title: form.title.trim(),
          format: form.format,
          caption: form.caption,
          asanaTaskGid: form.asanaTaskGid.trim() || null,
          expectedUpdatedAt: current.updatedAt,
        }),
      'Alterações salvas.'
    );

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const replace = replaceTarget.current;
    e.target.value = '';
    replaceTarget.current = null;
    if (!file) return;
    const problem = localFileProblem(file);
    if (problem) {
      setNotice({ kind: 'danger', text: problem });
      return;
    }
    void act(() => contentService.upload(detail.id, file, replace ?? undefined), replace ? 'Arquivo substituído.' : 'Arquivo enviado.');
  };

  return (
    <div className={styles.container} data-testid="content-detail">
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div style={{ minWidth: 0 }}>
            <h1 className={styles.title}>{detail.title}</h1>
            <p className={styles.subtitle}>
              <Link to="/conteudo" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> Conteúdos</Link>
              {' · '}{detail.clientName} · {formatLabel(detail.format)} · versão {detail.currentVersionNumber}
            </p>
          </div>
          {caps.create && !detail.editable ? (
            <div className={styles.actions}>
              <Button onClick={() => void act(() => contentService.newVersion(detail.id), 'Nova versão criada.')} disabled={busy} data-testid="new-version">
                Criar nova versão
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {notice ? <Banner kind={notice.kind} testId="content-notice">{notice.text}</Banner> : null}
      {!detail.editable ? (
        <Banner kind="info" testId="frozen-banner">
          Esta versão foi enviada para aprovação e não pode mais ser alterada. Para ajustar, crie uma nova versão (as anteriores ficam preservadas).
        </Banner>
      ) : null}
      <Banner kind="info" testId="publish-note">{detail.publishCompatibilityNote}</Banner>

      <section className={styles.panel} aria-labelledby="data-title">
        <h2 id="data-title" className={styles.panelTitle}>Dados</h2>
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="c-title">Título</label>
            <input id="c-title" className={styles.input} value={form.title} maxLength={200} disabled={!canEdit} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={styles.label}>Formato</legend>
            <div className={styles.choices}>
              {FORMAT_OPTIONS.map((o) => (
                <label key={o.value} className={`${styles.choice} ${form.format === o.value ? styles.choiceOn : ''}`} title={o.hint}>
                  <input type="radio" name="c-format" value={o.value} checked={form.format === o.value} disabled={!canEdit} onChange={() => setForm({ ...form, format: o.value })} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="c-caption">Legenda</label>
            <textarea id="c-caption" className={styles.textarea} value={form.caption} maxLength={5000} disabled={!canEdit} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="c-asana">Tarefa do Asana (vínculo local)</label>
            <input id="c-asana" className={styles.input} inputMode="numeric" value={form.asanaTaskGid} disabled={!canEdit} onChange={(e) => setForm({ ...form, asanaTaskGid: e.target.value })} />
          </div>
          {canEdit ? (
            <div className={styles.actions}>
              <Button onClick={() => void save()} disabled={busy || !dirty || form.title.trim().length === 0} data-testid="save-content-data">
                Salvar alterações
              </Button>
            </div>
          ) : (
            <p className={styles.readOnlyNote}>{detail.editable ? 'Você pode consultar, mas não alterar este conteúdo.' : 'Versão congelada.'}</p>
          )}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="files-title" data-testid="files-panel">
        <h2 id="files-title" className={styles.panelTitle}>
          Arquivos finais ({active.length}/{limits.max}) · versão {current.number}
        </h2>
        {detail.problems.length > 0 ? (
          <ul className={styles.problems} data-testid="media-problems">
            {detail.problems.map((p) => (
              <li key={p.code} className={styles.problemItem}>{p.message}</li>
            ))}
          </ul>
        ) : null}
        {active.length === 0 ? (
          <p className={styles.readOnlyNote}>Nenhum arquivo enviado.</p>
        ) : (
          <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="media-list">
            {active.map((m) => (
              <li key={m.id} className={styles.card} data-testid="media-item" data-media-id={m.id}>
                <MediaThumb itemId={detail.id} media={m} aspect={previewAspect(detail.format)} />
                <div className={styles.cardText}>
                  <p className={styles.help} style={{ overflowWrap: 'anywhere' }}>{m.originalFilename}</p>
                  <div className={styles.badges}>
                    <Badge variant="neutral">{m.kind === 'VIDEO' ? 'Vídeo' : 'Imagem'}</Badge>
                    <Badge variant="neutral">{formatBytes(m.sizeBytes)}</Badge>
                    {m.widthPx && m.heightPx ? <Badge variant="neutral" data-testid="media-dimensions">{m.widthPx}×{m.heightPx}</Badge> : null}
                  </div>
                </div>
                {canEdit ? (
                  <div className={styles.cardActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      data-testid="replace-media"
                      onClick={() => {
                        replaceTarget.current = m.id;
                        fileInput.current?.click();
                      }}
                    >
                      Substituir
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} data-testid="remove-media" onClick={() => void act(() => contentService.removeMedia(detail.id, m.id), 'Arquivo removido da versão (o histórico permanece).')}>
                      <Trash2 size={14} /> Remover
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className={styles.form}>
            <input ref={fileInput} type="file" accept={ACCEPT_ATTR} onChange={onFile} style={{ display: 'none' }} data-testid="file-input" />
            <Button
              variant="secondary"
              disabled={busy || full}
              onClick={() => {
                replaceTarget.current = null;
                fileInput.current?.click();
              }}
              data-testid="add-file"
            >
              <Upload size={16} /> {full ? (limits.max === 1 ? 'Para trocar, use "Substituir"' : 'Limite de arquivos atingido') : 'Enviar arquivo'}
            </Button>
            <p className={styles.help}>Aceitos: {ACCEPTED_LABEL}. O tipo é conferido pelo conteúdo do arquivo, não pela extensão.</p>
          </div>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="preview-title" data-testid="preview-panel">
        <h2 id="preview-title" className={styles.panelTitle}>Pré-visualização</h2>
        <ContentPreview
          format={detail.format}
          brandName={detail.clientName}
          caption={current.caption}
          media={active.flatMap((m) => (previewUrls[m.id] ? [{ url: previewUrls[m.id], kind: m.kind }] : []))}
        />
      </section>

      <section className={styles.panel} aria-labelledby="approval-title" data-testid="approval-panel">
        <h2 id="approval-title" className={styles.panelTitle}>Aprovação do cliente</h2>
        {approval ? (
          <>
            <div className={styles.badges}>
              <Badge variant={APPROVAL_STATUS[approval.status].tone}>{APPROVAL_STATUS[approval.status].label}</Badge>
              <Badge variant="neutral">Versão {approval.currentVersionNumber}</Badge>
            </div>
            <p className={styles.help} data-testid="approval-help">{APPROVAL_STATUS[approval.status].help}</p>
            <p className={styles.help}>{approval.identificationNotice}</p>
          </>
        ) : null}

        {createdLink ? (
          <div className={styles.banner + ' ' + styles.bannerOk} role="status" data-testid="approval-link-created">
            <div className={styles.bannerText}>
              <strong>Link gerado.</strong> Ele aparece só agora: copie e envie ao cliente por WhatsApp ou e-mail.
              <input
                className={styles.input}
                readOnly
                value={approvalUrl(window.location.origin, createdLink.path)}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link de aprovação"
                data-testid="approval-link-url"
                style={{ marginTop: 8 }}
              />
              <p className={styles.help}>Válido até {fmtDateTime(createdLink.link.expiresAt)}. {createdLink.reissued ? 'O link anterior foi revogado.' : ''}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void copyLink()} data-testid="copy-approval-link">Copiar link</Button>
          </div>
        ) : null}

        {caps.send && approval && approval.status !== 'APPROVED' && approval.status !== 'CHANGES_REQUESTED' ? (
          <div className={styles.form} data-testid="approval-form">
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ap-days">Validade (dias, máx. 30)</label>
                <input id="ap-days" className={styles.input} type="number" min={1} max={30} value={linkDays} onChange={(e) => setLinkDays(Number(e.target.value))} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ap-channel">Canal</label>
                <select id="ap-channel" className={styles.select} value={linkChannel} onChange={(e) => setLinkChannel(e.target.value as 'WHATSAPP' | 'EMAIL' | 'OTHER')}>
                  {(Object.keys(CHANNEL_LABEL) as ('WHATSAPP' | 'EMAIL' | 'OTHER')[]).map((k) => (
                    <option key={k} value={k}>{CHANNEL_LABEL[k]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ap-label">Destinatário (opcional)</label>
              <input id="ap-label" className={styles.input} value={linkLabel} maxLength={120} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Ex.: Maria, marketing da marca" />
            </div>
            <div className={styles.actions}>
              <Button onClick={() => void sendLink()} disabled={busy || active.length === 0} data-testid="create-approval-link">
                {approval.links.some((l) => l.state === 'ACTIVE') ? 'Reemitir link (revoga o anterior)' : 'Gerar link de aprovação'}
              </Button>
            </div>
            <p className={styles.help}>Ao gerar o link, a versão é enviada para aprovação e deixa de ser editável.</p>
          </div>
        ) : null}
        {!caps.send && approval && approval.status === 'NOT_SENT' ? (
          <p className={styles.readOnlyNote} data-testid="approval-noperm">Gerar o link de aprovação exige a permissão de envio ao cliente.</p>
        ) : null}

        {approval && approval.links.length > 0 ? (
          <ul className={styles.history} data-testid="approval-links">
            {approval.links.map((l) => (
              <li key={l.id} className={styles.historyItem} data-link-state={l.state}>
                <Badge variant={l.state === 'ACTIVE' ? 'info' : 'neutral'}>
                  {l.state === 'ACTIVE' ? 'Ativo' : l.state === 'EXPIRED' ? 'Expirado' : 'Revogado'}
                </Badge>
                <span>
                  v{l.versionNumber ?? '?'} · {CHANNEL_LABEL[l.channel]}{l.recipientLabel ? ` · ${l.recipientLabel}` : ''} · válido até {fmtDateTime(l.expiresAt)} · {l.accessCount} acesso(s)
                </span>
                {caps.send && l.state === 'ACTIVE' ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void revokeLink(l.id)} data-testid="revoke-approval-link">
                    Revogar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {approval && approval.decisions.length > 0 ? (
          <ul className={styles.eventList} data-testid="approval-decisions">
            {approval.decisions.map((d) => (
              <li key={d.id} className={styles.event} data-decision={d.decision}>
                <span>
                  <strong>{d.decision === 'APPROVED' ? 'Aprovou' : 'Pediu alteração'}</strong> · v{d.versionNumber ?? '?'} · {d.approverName} ({d.approverContact})
                </span>
                {d.comment ? <span>Comentário: {d.comment}</span> : null}
                <span className={styles.eventMeta}>{fmtDateTime(d.createdAt)} · identificação declarada (N1), não verificada</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <PublicationPanel
        itemId={detail.id}
        approvalStatus={approval?.status ?? null}
        currentVersionNumber={current.number}
        canSchedule={caps.schedule}
        timeZone={resolveTimeZone(currentOrganization?.timezone)}
      />

      <section className={styles.panel} aria-labelledby="versions-title" data-testid="versions-panel">
        <h2 id="versions-title" className={styles.panelTitle}>Versões</h2>
        <ul className={styles.history}>
          {[...detail.versions].reverse().map((v) => (
            <li key={v.id} className={styles.historyItem} data-version={v.number}>
              <Badge variant={v.number === current.number ? 'info' : 'neutral'}>v{v.number}</Badge>
              <span>
                {v.media.filter((m) => !m.removedAt).length} arquivo(s)
                {v.media.some((m) => m.removedAt) ? ` · ${v.media.filter((m) => m.removedAt).length} removido(s)` : ''}
                {v.sentForApprovalAt ? ` · enviada para aprovação em ${fmtDateTime(v.sentForApprovalAt)}` : ' · editável'}
              </span>
              {v.caption ? <span style={{ overflowWrap: 'anywhere' }}>Legenda: {v.caption.slice(0, 160)}{v.caption.length > 160 ? '…' : ''}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="events-title" data-testid="content-history">
        <h2 id="events-title" className={styles.panelTitle}>Histórico</h2>
        <ul className={styles.eventList}>
          {detail.events.map((e) => (
            <li key={e.id} className={styles.event} data-event-type={e.type}>
              <span><strong>{contentEventLabel(e.type)}</strong></span>
              <span className={styles.eventMeta}>{fmtDateTime(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
