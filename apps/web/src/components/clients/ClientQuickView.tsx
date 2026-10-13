import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Clock,
  Activity,
  Users,
  Calendar,
  Layers,
  FileText,
  Palette,
  CheckCircle2,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Badge,
  LoadingState,
  ErrorState,
  PermissionState,
  Button,
} from '@/components/ui/ds';
import { useNavigate } from 'react-router-dom';
import {
  clientsService,
  ClientDetail,
  ClientTimelineEvent,
  statusLabels,
} from '@/services/clients';
import { ClientIdentityCell } from './ClientIdentityCell';
import styles from './ClientPortfolio.module.css';

interface ClientQuickViewProps {
  clientId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ClientQuickView({ clientId, open, onClose }: ClientQuickViewProps) {
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [timeline, setTimeline] = useState<ClientTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState(false);

  // Contador de sequência de requisição para proteção determinística contra race condition / stale state
  const requestSequenceRef = useRef(0);

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

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } catch {
      return '—';
    }
  };

  const loadData = useCallback(async (id: string) => {
    // Nova sequência de requisição única: invalida qualquer requisição anterior em voo
    const currentSequence = ++requestSequenceRef.current;

    setLoading(true);
    setError(null);
    setClient(null);
    setTimeline([]);
    setTimelineError(false);
    setTimelineLoading(true);

    try {
      // 1. Busca sob demanda do ClientDetail
      const detail = await clientsService.getClientById(id);

      // Proteção determinística: descarta se outra requisição foi iniciada ou o drawer fechou
      if (currentSequence !== requestSequenceRef.current) {
        return;
      }

      setClient(detail);
      setLoading(false);

      // 2. Busca sob demanda da timeline isolada (falha da timeline não derruba o ClientDetail)
      try {
        const events = await clientsService.getClientTimeline(id);

        if (currentSequence !== requestSequenceRef.current) {
          return;
        }

        setTimeline(events || []);
      } catch (tErr) {
        if (currentSequence !== requestSequenceRef.current) {
          return;
        }

        console.warn('Falha ao carregar timeline do cliente:', tErr);
        setTimelineError(true);
      } finally {
        if (currentSequence === requestSequenceRef.current) {
          setTimelineLoading(false);
        }
      }
    } catch (err: any) {
      // Proteção determinística no bloco de erro: erro antigo não contamina o cliente atual
      if (currentSequence !== requestSequenceRef.current) {
        return;
      }

      console.error('Falha ao carregar detalhes do cliente no Quick View:', err);
      setError({
        status: err?.status || err?.response?.status,
        message: err?.message || 'Falha ao carregar os dados do cliente.',
      });
      setLoading(false);
      setTimelineLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && clientId) {
      loadData(clientId);
    } else {
      // Invalida requests pendentes incrementando o contador ao fechar ou deselecionar
      requestSequenceRef.current++;
      setClient(null);
      setTimeline([]);
      setError(null);
      setTimelineError(false);
      setLoading(false);
      setTimelineLoading(false);
    }

    return () => {
      // Cleanup para cancelamento/invalidação ao desmontar ou trocar dependências
      requestSequenceRef.current++;
    };
  }, [open, clientId, loadData]);

  // Contatos ordenados com prioritário no topo
  const sortedContacts = React.useMemo(() => {
    if (!client?.contacts || client.contacts.length === 0) return [];
    return [...client.contacts].sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return 0;
    });
  }, [client?.contacts]);

  // Reunião mais recente
  const latestMeeting = React.useMemo(() => {
    if (!client?.meetingNotes || client.meetingNotes.length === 0) return null;
    return [...client.meetingNotes].sort(
      (a, b) => new Date(b.meetingDate).getTime() - new Date(a.meetingDate).getTime()
    )[0];
  }, [client?.meetingNotes]);

  const handleOpenClient360 = () => {
    if (!client) return;
    onClose();
    navigate(`/clientes/${client.id}`);
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className={styles.quickViewContent}>
        <SheetHeader className="sr-only">
          <SheetTitle>{client ? client.name : 'Visualização rápida do cliente'}</SheetTitle>
          <SheetDescription>
            Ficha rápida com dados contextuais e recentes do cliente.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <LoadingState message="Carregando informações do cliente..." />
        ) : error ? (
          error.status === 403 ? (
            <PermissionState
              title="Acesso Restrito"
              description="Você não possui permissão para visualizar os detalhes deste cliente."
            />
          ) : error.status === 404 ? (
            <ErrorState
              title="Cliente indisponível"
              description="O cliente solicitado não foi encontrado ou está inacessível."
              onRetry={() => clientId && loadData(clientId)}
            />
          ) : (
            <ErrorState
              title="Erro ao carregar detalhes"
              description={error.message}
              onRetry={() => clientId && loadData(clientId)}
            />
          )
        ) : client ? (
          <div className={styles.quickViewBody}>
            {/* 1. CABEÇALHO DO QUICK VIEW */}
            <div className={styles.quickViewHeader}>
              <div className={styles.quickViewHeaderTop}>
                <ClientIdentityCell name={client.name} legalName={client.legalName} />
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Badge variant={getBadgeVariant(client.status)}>
                    {statusLabels[client.status] || client.status}
                  </Badge>
                  <Button variant="primary" size="sm" onClick={handleOpenClient360}>
                    Abrir Cliente 360
                  </Button>
                </div>
              </div>

              <div className={styles.quickViewHeaderMeta}>
                {client.responsibleUser?.name && (
                  <div className={styles.quickViewHeaderMetaItem}>
                    <Users size={14} aria-hidden="true" />
                    <span>Responsável: {client.responsibleUser.name}</span>
                  </div>
                )}
                {client.startDate && (
                  <div className={styles.quickViewHeaderMetaItem}>
                    <Calendar size={14} aria-hidden="true" />
                    <span>Início: {formatDate(client.startDate)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. ATENDIMENTO E CADASTRO */}
            <section className={styles.quickViewSection} aria-label="Atendimento e Cadastro">
              <h3 className={styles.quickViewSectionTitle}>
                <Users size={14} aria-hidden="true" />
                Atendimento & Cadastro
              </h3>

              <div className={styles.quickViewGrid}>
                <div className={styles.quickViewItem}>
                  <span className={styles.quickViewItemLabel}>Responsável</span>
                  <span className={styles.quickViewItemValue}>
                    {client.responsibleUser?.name || 'Não atribuído'}
                  </span>
                </div>

                <div className={styles.quickViewItem}>
                  <span className={styles.quickViewItemLabel}>Squad(s)</span>
                  <span className={styles.quickViewItemValue}>
                    {client.squads && client.squads.length > 0 ? (
                      <div className={styles.squadsWrapper}>
                        {client.squads.map((squad) => (
                          <span key={squad.id} className={styles.squadBadge}>
                            {squad.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </span>
                </div>

                {/* Exibição condicional de Documento (fail-closed visual se null/undefined) */}
                {client.document && (
                  <div className={styles.quickViewItem}>
                    <span className={styles.quickViewItemLabel}>Documento</span>
                    <span className={styles.quickViewItemValue}>{client.document}</span>
                  </div>
                )}

                <div className={styles.quickViewItem}>
                  <span className={styles.quickViewItemLabel}>Vigência</span>
                  <span className={styles.quickViewItemValue}>
                    {client.startDate || client.endDate
                      ? `${formatDate(client.startDate)} até ${formatDate(client.endDate)}`
                      : '—'}
                  </span>
                </div>
              </div>
            </section>

            {/* 3. CONTATOS */}
            <section className={styles.quickViewSection} aria-label="Contatos">
              <h3 className={styles.quickViewSectionTitle}>
                <Users size={14} aria-hidden="true" />
                Contatos
              </h3>

              {sortedContacts.length > 0 ? (
                <div className={styles.contactsList}>
                  {sortedContacts.slice(0, 3).map((contact) => (
                    <div
                      key={contact.id}
                      className={`${styles.contactCard} ${
                        contact.isPrimary ? styles.contactCardPrimary : ''
                      }`.trim()}
                    >
                      <div className={styles.contactCardHeader}>
                        <div className={styles.contactName}>{contact.name}</div>
                        {contact.isPrimary && (
                          <Badge variant="info">Principal</Badge>
                        )}
                      </div>
                      {contact.role && (
                        <div className={styles.contactRole}>{contact.role}</div>
                      )}
                      <div className={styles.contactDetails}>
                        {contact.email && <span>{contact.email}</span>}
                        {contact.phone && <span>{contact.phone}</span>}
                      </div>
                    </div>
                  ))}

                  {sortedContacts.length > 3 && (
                    <div className={styles.contactCountNotice}>
                      +{sortedContacts.length - 3} contato(s) adicional(is)
                    </div>
                  )}
                </div>
              ) : client.email || client.phone ? (
                <div className={styles.contactCard}>
                  <div className={styles.contactName}>Contato geral</div>
                  <div className={styles.contactDetails}>
                    {client.email && <span>{client.email}</span>}
                    {client.phone && <span>{client.phone}</span>}
                  </div>
                </div>
              ) : (
                <div className={styles.discreetNotice}>Sem contato cadastrado</div>
              )}
            </section>

            {/* 4. BRIEFING (RESUMO SIMPLES) */}
            <section className={styles.quickViewSection} aria-label="Briefing">
              <h3 className={styles.quickViewSectionTitle}>
                <FileText size={14} aria-hidden="true" />
                Briefing
              </h3>

              {client.briefing ? (
                <div className={styles.briefingWrapper}>
                  <div className={styles.quickViewItemValue}>Briefing cadastrado</div>
                  {client.briefing.objective && (
                    <p className={styles.briefingObjective}>{client.briefing.objective}</p>
                  )}
                </div>
              ) : (
                <div className={styles.discreetNotice}>Briefing não preenchido</div>
              )}
            </section>

            {/* 5. BRAND KIT (PRÉVIA MÍNIMA) */}
            <section className={styles.quickViewSection} aria-label="Brand Kit">
              <h3 className={styles.quickViewSectionTitle}>
                <Palette size={14} aria-hidden="true" />
                Brand Kit
              </h3>

              {client.brandKit ? (
                <div className={styles.brandKitWrapper}>
                  {client.brandKit.colors && client.brandKit.colors.length > 0 && (
                    <div className={styles.swatchesRow}>
                      {client.brandKit.colors.slice(0, 4).map((c, idx) => (
                        <div key={idx} className={styles.swatchItem} title={`${c.name} (${c.hex})`}>
                          <span
                            className={styles.swatchCircle}
                            style={{ backgroundColor: c.hex }}
                            aria-label={`Cor ${c.name}`}
                          />
                          <span>{c.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {client.brandKit.typography && client.brandKit.typography.length > 0 && (
                    <div className={styles.typographyInfo}>
                      Tipografia:{' '}
                      {client.brandKit.typography.map((t) => t.fontName).join(', ')}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.discreetNotice}>Brand Kit não cadastrado</div>
              )}
            </section>

            {/* 6. INTEGRAÇÕES ATIVAS */}
            <section className={styles.quickViewSection} aria-label="Integrações">
              <h3 className={styles.quickViewSectionTitle}>
                <Layers size={14} aria-hidden="true" />
                Integrações Ativas
              </h3>

              {client.activeIntegrations && client.activeIntegrations.length > 0 ? (
                <div className={styles.integrationsRow}>
                  {client.activeIntegrations.map((integration) => (
                    <div key={integration.id} className={styles.integrationChip}>
                      <span className={styles.integrationStatusDot} aria-hidden="true" />
                      <span>{integration.displayName || integration.provider}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className={styles.neutralDash}>—</span>
              )}
            </section>

            {/* 7. REUNIÕES (ÚLTIMA ATA REGISTRADA) */}
            <section className={styles.quickViewSection} aria-label="Reuniões">
              <h3 className={styles.quickViewSectionTitle}>
                <Calendar size={14} aria-hidden="true" />
                Última Reunião
              </h3>

              {latestMeeting ? (
                <div className={styles.meetingCard}>
                  <div className={styles.meetingTop}>
                    <span className={styles.meetingTitle}>{latestMeeting.title}</span>
                    <span className={styles.meetingDate}>
                      {formatDate(latestMeeting.meetingDate)}
                    </span>
                  </div>
                  <p className={styles.meetingSummary}>{latestMeeting.summary}</p>
                </div>
              ) : (
                <div className={styles.discreetNotice}>Nenhuma ata registrada</div>
              )}
            </section>

            {/* 8. ATIVIDADE RECENTE (TIMELINE) */}
            <section className={styles.quickViewSection} aria-label="Atividade Recente">
              <h3 className={styles.quickViewSectionTitle}>
                <Activity size={14} aria-hidden="true" />
                Atividade Recente
              </h3>

              {timelineLoading ? (
                <div className={styles.discreetNotice}>Carregando atividade recente...</div>
              ) : timelineError ? (
                <div className={styles.discreetNotice}>
                  Não foi possível carregar a atividade recente.
                </div>
              ) : timeline.length > 0 ? (
                <div className={styles.timelineContainer}>
                  {timeline.slice(0, 3).map((event) => (
                    <div key={event.id} className={styles.timelineItem}>
                      <span className={styles.timelineDot} aria-hidden="true" />
                      <div className={styles.timelineItemTitle}>{event.title}</div>
                      <div className={styles.timelineItemDescription}>{event.description}</div>
                      <div className={styles.timelineItemMeta}>
                        <Clock size={12} aria-hidden="true" />
                        <span>{formatDateTime(event.timestamp)}</span>
                        {event.actorName && <span>• Por {event.actorName}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.discreetNotice}>Nenhuma atividade recente registrada.</div>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
