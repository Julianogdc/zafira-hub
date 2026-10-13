import React, { useEffect, useMemo, useState } from 'react';
import { ContentPreview } from '@/components/content/ContentPreview';
import {
  PublicApprovalView,
  publicApprovalService,
  publicMediaUrl,
  tokenFromHash,
} from '@/services/approval';
import styles from './Aprovacao.module.css';

const FORMAT_LABEL: Record<PublicApprovalView['format'], string> = {
  FEED_IMAGE: 'Post de feed',
  CAROUSEL: 'Carrossel',
  REEL: 'Reel',
  STORY: 'Story',
};

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type Phase = 'loading' | 'unavailable' | 'error' | 'ready';

/**
 * F8-2 - Pagina PUBLICA de aprovacao do cliente (sem login).
 * O token fica no fragmento da URL; a pagina nao carrega recursos de terceiros nem envia cookies.
 * N1: a identificacao e informada pela propria pessoa (nao e identidade verificada).
 */
export default function Aprovacao() {
  const token = useMemo(() => tokenFromHash(typeof window === 'undefined' ? '' : window.location.hash), []);
  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'unavailable');
  const [view, setView] = useState<PublicApprovalView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [authority, setAuthority] = useState(false);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<'APPROVED' | 'CHANGES_REQUESTED' | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // pagina privada: sem indexacao e sem Referer, mesmo servida como app de pagina unica
  useEffect(() => {
    const metas: HTMLMetaElement[] = [];
    for (const [n, c] of [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']] as const) {
      const m = document.createElement('meta');
      m.name = n;
      m.content = c;
      document.head.appendChild(m);
      metas.push(m);
    }
    const previous = document.title;
    document.title = 'Aprovação de conteúdo';
    return () => {
      metas.forEach((m) => m.remove());
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    publicApprovalService.view(token).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setView(r.data);
        setPhase('ready');
      } else if (r.unavailable) {
        setPhase('unavailable');
      } else {
        setMessage(r.message);
        setPhase('error');
      }
    });
    return () => {
      alive = false;
    };
  }, [token]);

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <div className={styles.center} role="status" data-testid="approval-loading">Carregando conteúdo...</div>
      </div>
    );
  }
  if (phase === 'unavailable') {
    return (
      <div className={styles.page}>
        <div className={styles.center} data-testid="approval-unavailable">
          <div>
            <h1 className={styles.title}>Este link não está disponível</h1>
            <p className={styles.sub}>Ele pode ter expirado ou ter sido substituído. Peça um novo link a quem enviou o conteúdo.</p>
          </div>
        </div>
      </div>
    );
  }
  if (phase === 'error' || !view) {
    return (
      <div className={styles.page}>
        <div className={styles.center} data-testid="approval-error">
          <div>
            <h1 className={styles.title}>Não foi possível abrir o conteúdo</h1>
            <p className={styles.sub}>{message ?? 'Tente novamente em instantes.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const decided = view.status !== 'PENDING';
  const media = view.media.map((m) => ({ url: publicMediaUrl(m.path), kind: m.kind }));
  const identityOk = name.trim().length >= 2 && contact.trim().length >= 3 && authority;
  const commentOk = comment.trim().length >= 3;

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    setFormError(null);
    const r = await publicApprovalService.decide(token, {
      decision: pending,
      comment: comment.trim() || undefined,
      approverName: name.trim(),
      approverContact: contact.trim(),
      authorityDeclared: authority,
      contentHash: view.contentHash,
    });
    setBusy(false);
    if (r.ok && r.data) {
      setView(r.data);
      setPending(null);
    } else if (r.unavailable) {
      setPhase('unavailable');
    } else {
      setPending(null);
      setFormError(r.message);
      if (r.code === 'ALREADY_DECIDED' || r.code === 'INTEGRITY_MISMATCH') {
        const again = await publicApprovalService.view(token);
        if (again.ok && again.data) setView(again.data);
      }
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.wrap} data-testid="approval-page">
        <header>
          <h1 className={styles.title}>{view.brandName}: aprovação de conteúdo</h1>
          <p className={styles.sub}>
            {FORMAT_LABEL[view.format]} · versão {view.versionNumber} · link válido até {fmt(view.expiresAt)}
          </p>
        </header>

        <div className={styles.grid}>
          <ContentPreview format={view.format} brandName={view.brandName} caption={view.caption} media={media} />

          <section className={styles.panel} aria-label="Sua resposta">
            {decided && view.decision ? (
              <div className={styles.result} data-testid="approval-result" data-decision={view.decision.decision}>
                <h2>{view.decision.decision === 'APPROVED' ? 'Conteúdo aprovado' : 'Alteração solicitada'}</h2>
                <p className={styles.sub}>
                  Resposta registrada em {fmt(view.decision.decidedAt)} por {view.decision.approverName}.
                  {view.decision.decision === 'CHANGES_REQUESTED'
                    ? ' A equipe vai ajustar e enviar uma nova versão.'
                    : ' Obrigado! A equipe seguirá com o agendamento.'}
                </p>
                {view.decision.comment ? <p className={styles.notice}>Seu comentário: {view.decision.comment}</p> : null}
              </div>
            ) : (
              <>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ap-name">Seu nome</label>
                  <input id="ap-name" className={styles.input} value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ap-contact">E-mail ou telefone para contato</label>
                  <input id="ap-contact" className={styles.input} value={contact} maxLength={160} autoComplete="email" onChange={(e) => setContact(e.target.value)} />
                </div>
                <label className={styles.check}>
                  <input type="checkbox" checked={authority} onChange={(e) => setAuthority(e.target.checked)} data-testid="approval-authority" />
                  <span>Declaro que tenho autoridade para aprovar este conteúdo em nome de {view.brandName}.</span>
                </label>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ap-comment">Comentário (obrigatório para solicitar alteração)</label>
                  <textarea id="ap-comment" className={styles.textarea} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
                </div>
                <p className={styles.notice}>{view.identificationNotice}</p>
                {formError ? <p className={styles.error} role="alert" data-testid="approval-error-msg">{formError}</p> : null}

                {pending ? (
                  <div className={styles.confirm} role="alertdialog" aria-label="Confirmar resposta" data-testid="approval-confirm">
                    <p style={{ margin: '0 0 12px' }}>
                      Confirmar <strong>{pending === 'APPROVED' ? 'a aprovação' : 'o pedido de alteração'}</strong>? Esta resposta é definitiva para esta versão.
                    </p>
                    <div className={styles.actions}>
                      <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy} onClick={() => void submit()} data-testid="approval-confirm-yes">
                        {busy ? 'Enviando...' : 'Confirmar'}
                      </button>
                      <button type="button" className={styles.btn} disabled={busy} onClick={() => setPending(null)}>Voltar</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!identityOk} onClick={() => setPending('APPROVED')} data-testid="approval-approve">
                      Aprovar
                    </button>
                    <button type="button" className={styles.btn} disabled={!identityOk || !commentOk} onClick={() => setPending('CHANGES_REQUESTED')} data-testid="approval-request-changes">
                      Solicitar alteração
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
