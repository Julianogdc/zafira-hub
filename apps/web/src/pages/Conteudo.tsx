import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileImage, Plus } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, Button, EmptyState, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clientsService } from '@/services/clients';
import { ContentListItem, contentErrorInfo, contentService, useContentCapabilities, type ContentFormat } from '@/services/content';
import { APPROVAL_STATUS, FORMAT_OPTIONS, formatLabel } from '@/lib/content-view';
import styles from './Onboarding.module.css';

/**
 * F8-1 - Conteudos por cliente (arquivos finais). Pauta, revisao e aprovacao internas ficam no Asana.
 * Nada e enviado ao BrightBean nesta fatia.
 */
export default function Conteudo() {
  const { currentOrganization } = useAuthStore();
  const caps = useContentCapabilities(currentOrganization?.id);
  const navigate = useNavigate();

  const [items, setItems] = useState<ContentListItem[] | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientFilter, setClientFilter] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ clientId: string; title: string; format: ContentFormat; caption: string; asanaTaskGid: string }>({
    clientId: '',
    title: '',
    format: 'FEED_IMAGE',
    caption: '',
    asanaTaskGid: '',
  });

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await contentService.list(clientFilter || undefined));
    } catch (e) {
      setLoadError(contentErrorInfo(e).message);
      setItems(null);
    }
  }, [clientFilter]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    clientsService
      .listClients()
      .then((list) => setClients(list.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]));
  }, [caps.loading, caps.view]);

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await contentService.create({
        clientId: form.clientId,
        title: form.title.trim(),
        format: form.format,
        caption: form.caption,
        asanaTaskGid: form.asanaTaskGid.trim() || null,
      });
      setOpen(false);
      navigate(`/conteudo/${created.id}`);
    } catch (e) {
      const info = contentErrorInfo(e);
      setError(info.existingId ? `${info.message} Abra o conteúdo existente na lista.` : info.message);
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

  return (
    <div className={styles.container} data-testid="content-page">
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div style={{ minWidth: 0 }}>
            <h1 className={styles.title}>Conteúdos</h1>
            <p className={styles.subtitle}>
              Arquivos finais por cliente. Pauta, comentários e aprovação interna continuam no Asana; aqui ficam os arquivos que seguem para o cliente.
            </p>
          </div>
          {caps.create ? (
            <div className={styles.actions}>
              <Button
                onClick={() => {
                  setError(null);
                  setForm({ clientId: clientFilter || '', title: '', format: 'FEED_IMAGE', caption: '', asanaTaskGid: '' });
                  setOpen(true);
                }}
                data-testid="new-content"
              >
                <Plus size={16} /> Novo conteúdo
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <section className={styles.panel} aria-label="Filtro">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="content-client-filter">Cliente</label>
          <select
            id="content-client-filter"
            className={styles.select}
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            data-testid="client-filter"
          >
            <option value="">Todos os clientes da minha carteira</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </section>

      {loadError ? (
        <ErrorState title="Não foi possível carregar os conteúdos" description={loadError} onRetry={() => void load()} />
      ) : items === null ? (
        <LoadingState message="Carregando conteúdos..." />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileImage />}
          title="Nenhum conteúdo cadastrado"
          description={caps.create ? 'Cadastre um conteúdo e envie os arquivos finais.' : 'Ainda não há conteúdos para os clientes da sua carteira.'}
        />
      ) : (
        <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="content-list">
          {items.map((i) => (
            <li key={i.id} className={styles.card} data-testid="content-card" data-content-id={i.id}>
              <div className={styles.cardText}>
                <h2 className={styles.cardTitle}>
                  <Link className={styles.linkInline} to={`/conteudo/${i.id}`}>{i.title}</Link>
                </h2>
                <p className={styles.help}>{i.clientName || clientName.get(i.clientId) || 'Cliente'} · {formatLabel(i.format)}</p>
                <div className={styles.badges}>
                  <Badge variant="info">Versão {i.versionNumber}</Badge>
                  <Badge variant={i.mediaCount > 0 ? 'success' : 'warning'}>
                    {i.mediaCount} arquivo{i.mediaCount === 1 ? '' : 's'}
                  </Badge>
                  <Badge variant={i.editable ? 'neutral' : 'info'}>{i.editable ? 'Editável' : 'Enviada para aprovação'}</Badge>
                  {i.approvalStatus && i.approvalStatus !== 'NOT_SENT' ? (
                    <Badge variant={APPROVAL_STATUS[i.approvalStatus].tone} data-testid="approval-badge">{APPROVAL_STATUS[i.approvalStatus].label}</Badge>
                  ) : null}
                  {i.asanaTaskGid ? <Badge variant="neutral">Tarefa do Asana vinculada</Badge> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo conteúdo</DialogTitle>
            <DialogDescription>
              Cadastre o conteúdo e, na próxima tela, envie os arquivos finais. Nada é publicado ou enviado ao cliente nesta etapa.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-client">Cliente</label>
              <select id="new-client" className={styles.select} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">Escolha o cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-title">Título</label>
              <input id="new-title" className={styles.input} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className={styles.label}>Formato</legend>
              <div className={styles.choices}>
                {FORMAT_OPTIONS.map((o) => (
                  <label key={o.value} className={`${styles.choice} ${form.format === o.value ? styles.choiceOn : ''}`} title={o.hint}>
                    <input type="radio" name="new-format" value={o.value} checked={form.format === o.value} onChange={() => setForm({ ...form, format: o.value })} />
                    {o.label}
                  </label>
                ))}
              </div>
              <p className={styles.help}>{FORMAT_OPTIONS.find((o) => o.value === form.format)?.hint}</p>
            </fieldset>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-caption">Legenda (opcional)</label>
              <textarea id="new-caption" className={styles.textarea} value={form.caption} maxLength={5000} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-asana">Tarefa do Asana (opcional)</label>
              <input
                id="new-asana"
                className={styles.input}
                inputMode="numeric"
                value={form.asanaTaskGid}
                placeholder="Identificador numérico da tarefa"
                onChange={(e) => setForm({ ...form, asanaTaskGid: e.target.value })}
              />
              <p className={styles.help}>Vínculo apenas local, conferido no espelho do Asana deste cliente. O Hub não escreve no Asana.</p>
            </div>
            {error ? <p className={styles.fieldError} role="alert" data-testid="content-form-error">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={() => void submit()} disabled={busy || !form.clientId || form.title.trim().length === 0} data-testid="save-content">
              {busy ? 'Salvando...' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
