import { api } from '@/lib/api';
import type {
  CreateOnboardingTemplateRequest,
  OnboardingStepInput,
  OnboardingTemplateScopeKind,
  UpdateOnboardingTemplateRequest,
} from '@zafira/contracts';

/**
 * F7-1b — Cliente da API do construtor de onboarding (DEC-F7-005).
 * Nunca devolve dados de demonstração: erros sobem para a tela. A autorização real é do backend;
 * as capacidades só decidem o que mostrar.
 */

export interface OnboardingTemplateListItem {
  id: string;
  name: string;
  description: string | null;
  scopeKind: OnboardingTemplateScopeKind;
  scopeLabel: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  publishedVersion: number | null;
  hasDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingVersionSummary {
  id: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED';
  changeNote: string | null;
  basedOnVersionId: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface OnboardingTemplateDetail {
  id: string;
  name: string;
  description: string | null;
  scopeKind: OnboardingTemplateScopeKind;
  scopeLabel: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
  versions: OnboardingVersionSummary[];
  draft: { id: string; versionNumber: number; updatedAt: string; steps: OnboardingStepInput[] } | null;
  published: { id: string; versionNumber: number; publishedAt: string | null; steps: OnboardingStepInput[] } | null;
}

export interface OnboardingProblemView {
  code: string;
  stepKey?: string;
  message: string;
}

export interface OnboardingValidation {
  versionId: string;
  publishable: boolean;
  status: 'DRAFT' | 'PUBLISHED';
  problems: OnboardingProblemView[];
}

export interface OrganizationFunctionView {
  id: string;
  name: string;
  isActive: boolean;
  memberIds: string[];
}

export interface OnboardingMemberView {
  id: string;
  name: string;
  role: string;
}

const base = '/onboarding';

export const onboardingService = {
  listTemplates: () => api.get<OnboardingTemplateListItem[]>(`${base}/templates`),
  getTemplate: (id: string) => api.get<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}`),
  createTemplate: (input: CreateOnboardingTemplateRequest) =>
    api.post<OnboardingTemplateDetail>(`${base}/templates`, input),
  updateTemplate: (id: string, input: UpdateOnboardingTemplateRequest) =>
    api.patch<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}`, input),
  duplicateTemplate: (id: string) => api.post<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}/duplicate`),
  archiveTemplate: (id: string) => api.post<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}/archive`),
  reactivateTemplate: (id: string) => api.post<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}/reactivate`),

  createDraft: (id: string) => api.post<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}/versions`),
  saveDraft: (id: string, versionId: string, expectedUpdatedAt: string, steps: OnboardingStepInput[]) =>
    api.put<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, {
      expectedUpdatedAt,
      steps,
    }),
  validateVersion: (id: string, versionId: string) =>
    api.post<OnboardingValidation>(`${base}/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/validate`),
  publish: (id: string, versionId: string, expectedUpdatedAt: string, changeNote: string) =>
    api.post<OnboardingTemplateDetail>(
      `${base}/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/publish`,
      { expectedUpdatedAt, changeNote }
    ),
  discardDraft: (id: string, versionId: string) =>
    api.delete<OnboardingTemplateDetail>(`${base}/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`),

  listFunctions: () => api.get<OrganizationFunctionView[]>(`${base}/functions`),
  createFunction: (name: string) => api.post<OrganizationFunctionView>(`${base}/functions`, { name }),
  updateFunction: (id: string, input: { name?: string; isActive?: boolean }) =>
    api.patch<OrganizationFunctionView>(`${base}/functions/${encodeURIComponent(id)}`, input),
  setFunctionMembers: (id: string, memberIds: string[]) =>
    api.put<OrganizationFunctionView>(`${base}/functions/${encodeURIComponent(id)}/members`, { memberIds }),
  listMembers: () => api.get<OnboardingMemberView[]>(`${base}/members`),
};

/** Mensagem legível de um erro da API; problemas de validação vêm em `error.data.problems`. */
export function onboardingErrorInfo(error: unknown): {
  status: number;
  code?: string;
  message: string;
  problems: OnboardingProblemView[];
} {
  const e = error as { status?: number; message?: string; data?: { code?: string; problems?: OnboardingProblemView[] } } | null;
  return {
    status: e?.status ?? 0,
    code: e?.data?.code,
    message: e?.message || 'Não foi possível concluir a operação.',
    problems: e?.data?.problems ?? [],
  };
}

export const SCOPE_KIND_LABEL: Record<OnboardingTemplateScopeKind, string> = {
  GENERAL: 'Geral',
  SERVICE: 'Serviço',
  PACKAGE: 'Pacote',
  CLIENT_TYPE: 'Tipo de cliente',
};
