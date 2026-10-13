import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Badge, EmptyState, ErrorState, LoadingState, PermissionState } from '@/components/ui/ds';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { formatDay, stepBadges } from '@/lib/onboarding-execution-view';
import { MyStepItem, executionErrorInfo, onboardingExecutionService } from '@/services/onboardingExecution';
import { useOnboardingCapabilities } from '@/services/onboardingCapabilities';
import styles from './Onboarding.module.css';

/** F7-2b - Etapas abertas atribuidas a quem consulta, nos clientes da sua carteira. */
export default function OnboardingMinhasEtapas() {
  const { currentOrganization } = useAuthStore();
  const caps = useOnboardingCapabilities(currentOrganization?.id);
  const [items, setItems] = useState<MyStepItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await onboardingExecutionService.mySteps());
    } catch (e) {
      setError(executionErrorInfo(e).message);
      setItems(null);
    }
  }, []);

  useEffect(() => {
    if (caps.loading || !caps.view) return;
    void load();
  }, [caps.loading, caps.view, load]);

  if (caps.loading) {
    return (
      <OnboardingShell title="Minhas etapas" tabs={false}>
        <LoadingState message="Carregando permissões..." />
      </OnboardingShell>
    );
  }
  if (!caps.view) {
    return (
      <OnboardingShell title="Minhas etapas" tabs={false}>
        <PermissionState title="Sem permissão para ver o onboarding" description="Seu perfil não tem acesso ao onboarding desta organização." />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell title="Minhas etapas" subtitle="Etapas abertas atribuídas a você, nos clientes da sua carteira.">
      {error ? (
        <ErrorState title="Não foi possível carregar suas etapas" description={error} onRetry={() => void load()} />
      ) : items === null ? (
        <LoadingState message="Carregando suas etapas..." />
      ) : items.length === 0 ? (
        <EmptyState icon={<ListChecks />} title="Nenhuma etapa aberta para você" description="Quando uma etapa for atribuída a você, ela aparece aqui." />
      ) : (
        <ul className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="my-steps">
          {items.map((s) => (
            <li key={`${s.executionId}:${s.stepKey}`} className={styles.card} data-testid="my-step" data-title={s.title}>
              <div>
                <h2 className={styles.cardTitle}>
                  <Link to={`/onboarding/execucoes/${s.executionId}`}>{s.title}</Link>
                </h2>
                <p className={styles.cardText}>{s.clientName} · {s.templateName}</p>
              </div>
              <div className={styles.badges}>
                {stepBadges({ status: s.status, blocked: s.blocked, late: s.late, assigneeIssue: null }).map((b) => (
                  <Badge key={b.key} variant={b.tone}>{b.label}</Badge>
                ))}
                {s.dueDate ? <Badge variant="neutral">Prazo {formatDay(s.dueDate)}</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </OnboardingShell>
  );
}
