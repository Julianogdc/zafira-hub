import { useEffect, useState } from 'react';
import { capabilitiesService } from '@/services/capabilities';

export type OnboardingCapabilityKey =
  | 'onboarding.view'
  | 'onboarding.manage_templates'
  | 'onboarding.manage_functions';

export interface OnboardingCapabilities {
  loading: boolean;
  error: boolean;
  view: boolean;
  manageTemplates: boolean;
  manageFunctions: boolean;
  start: boolean;
  execute: boolean;
  override: boolean;
  cancel: boolean;
}

/**
 * Capacidades só decidem o que MOSTRAR. Cada rota da API valida a permissão de novo (F7-1a).
 * Falha na consulta = nenhuma capacidade (negação por padrão).
 */
export function useOnboardingCapabilities(organizationId?: string | null): OnboardingCapabilities {
  const [state, setState] = useState<OnboardingCapabilities>({
    loading: true,
    error: false,
    view: false,
    manageTemplates: false,
    manageFunctions: false,
    start: false,
    execute: false,
    override: false,
    cancel: false,
  });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    capabilitiesService
      .getEffectiveCapabilities(organizationId ?? undefined)
      .then((c) => {
        if (!alive) return;
        const p = c.permissions as Record<string, boolean>;
        setState({
          loading: false,
          error: false,
          view: Boolean(p['onboarding.view']),
          manageTemplates: Boolean(p['onboarding.manage_templates']),
          manageFunctions: Boolean(p['onboarding.manage_functions']),
          start: Boolean(p['onboarding.start']),
          execute: Boolean(p['onboarding.execute']),
          override: Boolean(p['onboarding.override']),
          cancel: Boolean(p['onboarding.cancel']),
        });
      })
      .catch(() => {
        if (!alive) return;
        setState({
          loading: false,
          error: true,
          view: false,
          manageTemplates: false,
          manageFunctions: false,
          start: false,
          execute: false,
          override: false,
          cancel: false,
        });
      });
    return () => {
      alive = false;
    };
  }, [organizationId]);

  return state;
}
