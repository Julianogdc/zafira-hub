import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './http.js';

/* ==========================================================================
   1. IDENTIFICADORES E ENUMS BÁSICOS
   ========================================================================== */

export const ClientUuidSchema = z.string().uuid('Identificador deve ser um UUID válido');

export const ClientStatusSchema = z.enum(['LEAD', 'ACTIVE', 'PAUSED', 'INACTIVE']);
export type ClientStatus = z.infer<typeof ClientStatusSchema>;

/* ==========================================================================
   2. BRIEFING
   ========================================================================== */

export const ClientBriefingSchema = z.object({
  version: z.literal(1).default(1),
  objective: z.string().optional(),
  targetAudience: z.string().optional(),
  positioning: z.string().optional(),
  competitors: z.string().optional(),
  toneOfVoice: z.string().optional(),
  notes: z.string().optional(),
});
export type ClientBriefing = z.infer<typeof ClientBriefingSchema>;

/* ==========================================================================
   3. BRAND KIT (Provider-Agnostic)
   ========================================================================== */

export const HexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const BrandColorSchema = z.object({
  name: z.string().min(1, 'O nome da cor é obrigatório'),
  hex: z.string().regex(HexColorRegex, 'Formato HEX inválido. Use #RGB ou #RRGGBB'),
});
export type BrandColor = z.infer<typeof BrandColorSchema>;

export const BrandTypographySchema = z.object({
  role: z.string().min(1, 'A função tipográfica é obrigatória'),
  fontName: z.string().min(1, 'O nome da fonte é obrigatório'),
});
export type BrandTypography = z.infer<typeof BrandTypographySchema>;

export function isValidHttpUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const BrandExternalLinkSchema = z.object({
  label: z.string().min(1, 'O rótulo do link é obrigatório'),
  url: z.string().min(1, 'A URL é obrigatória'),
  type: z.string().optional(),
});
export type BrandExternalLink = z.infer<typeof BrandExternalLinkSchema>;

export const BrandExternalLinkInputSchema = z.object({
  label: z.string().trim().min(1, 'O rótulo do link é obrigatório'),
  url: z
    .string()
    .trim()
    .refine((val) => isValidHttpUrl(val), {
      message: 'URL do link deve ser válida e utilizar protocolo http: ou https:',
    }),
  type: z.string().trim().optional(),
});
export type BrandExternalLinkInput = z.infer<typeof BrandExternalLinkInputSchema>;

export const ClientBrandKitSchema = z.object({
  colors: z.array(BrandColorSchema).default([]),
  typography: z.array(BrandTypographySchema).default([]),
  externalLinks: z.array(BrandExternalLinkSchema).default([]),
  notes: z.string().optional(),
});
export type ClientBrandKit = z.infer<typeof ClientBrandKitSchema>;

export const ClientBrandKitInputSchema = z.object({
  colors: z.array(BrandColorSchema).default([]),
  typography: z.array(BrandTypographySchema).default([]),
  externalLinks: z.array(BrandExternalLinkInputSchema).default([]),
  notes: z.string().optional(),
});
export type ClientBrandKitInput = z.infer<typeof ClientBrandKitInputSchema>;

export const ClientAddressSchema = z.object({
  street: z.string().trim().max(200, 'Rua deve ter no máximo 200 caracteres').nullable().optional(),
  number: z.string().trim().max(40, 'Número deve ter no máximo 40 caracteres').nullable().optional(),
  complement: z.string().trim().max(120, 'Complemento deve ter no máximo 120 caracteres').nullable().optional(),
  district: z.string().trim().max(120, 'Bairro deve ter no máximo 120 caracteres').nullable().optional(),
  city: z.string().trim().max(120, 'Cidade deve ter no máximo 120 caracteres').nullable().optional(),
  state: z.string().trim().max(120, 'Estado deve ter no máximo 120 caracteres').nullable().optional(),
  postalCode: z.string().trim().max(32, 'CEP deve ter no máximo 32 caracteres').nullable().optional(),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Formato inválido. Use 2 letras (ex: BR)').nullable().optional(),
  latitude: z.number().min(-90).max(90).refine(n => !Number.isNaN(n) && Number.isFinite(n), { message: 'Latitude inválida' }).nullable().optional(),
  longitude: z.number().min(-180).max(180).refine(n => !Number.isNaN(n) && Number.isFinite(n), { message: 'Longitude inválida' }).nullable().optional(),
});
export type ClientAddress = z.infer<typeof ClientAddressSchema>;


/* ==========================================================================
   4. CLIENT CONTACT (Stakeholders)
   ========================================================================== */

export const ClientContactSchema = z.object({
  id: ClientUuidSchema,
  organizationId: ClientUuidSchema,
  clientId: ClientUuidSchema,
  name: z.string().min(1, 'O nome do contato é obrigatório'),
  role: z.string().nullable().optional(),
  email: z.string().email('E-mail inválido').nullable().optional().or(z.literal('')),
  phone: z.string().nullable().optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClientContact = z.infer<typeof ClientContactSchema>;

export const CreateClientContactRequestSchema = z.object({
  name: z.string().trim().min(1, 'O nome do contato é obrigatório'),
  role: z.string().trim().nullable().optional(),
  email: z.string().trim().email('E-mail inválido').nullable().optional().or(z.literal('')),
  phone: z.string().trim().nullable().optional(),
  isPrimary: z.boolean().default(false).optional(),
  notes: z.string().trim().nullable().optional(),
});
export type CreateClientContactRequest = z.infer<typeof CreateClientContactRequestSchema>;

export const UpdateClientContactRequestSchema = z.object({
  name: z.string().trim().min(1, 'O nome não pode ser vazio').optional(),
  role: z.string().trim().nullable().optional(),
  email: z.string().trim().email('E-mail inválido').nullable().optional().or(z.literal('')),
  phone: z.string().trim().nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().nullable().optional(),
});
export type UpdateClientContactRequest = z.infer<typeof UpdateClientContactRequestSchema>;

/* ==========================================================================
   5. CLIENT MEETING NOTE (Memória do Relacionamento)
   ========================================================================== */

export const SafeOptionalExternalLinkSchema = z
  .string()
  .trim()
  .refine((val) => val === '' || isValidHttpUrl(val), {
    message: 'URL da ata deve utilizar protocolo http: ou https:',
  })
  .nullable()
  .optional();

export const ClientMeetingNoteSchema = z.object({
  id: ClientUuidSchema,
  organizationId: ClientUuidSchema,
  clientId: ClientUuidSchema,
  title: z.string().min(1, 'O título da reunião é obrigatório'),
  meetingDate: IsoDateTimeSchema,
  summary: z.string().min(1, 'O resumo da reunião é obrigatório'),
  actionItems: z.string().nullable().optional(),
  externalLink: z.string().nullable().optional().or(z.literal('')),
  authorUserId: ClientUuidSchema.nullable().optional(),
  authorUserName: z.string().nullable().optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClientMeetingNote = z.infer<typeof ClientMeetingNoteSchema>;

export const CreateClientMeetingNoteRequestSchema = z.object({
  title: z.string().trim().min(1, 'O título da reunião é obrigatório'),
  meetingDate: z.coerce.date({ message: 'Data da reunião inválida' }),
  summary: z.string().trim().min(1, 'O resumo da reunião é obrigatório'),
  actionItems: z.string().trim().nullable().optional(),
  externalLink: SafeOptionalExternalLinkSchema,
});
export type CreateClientMeetingNoteRequest = z.infer<typeof CreateClientMeetingNoteRequestSchema>;

export const UpdateClientMeetingNoteRequestSchema = z.object({
  title: z.string().trim().min(1, 'O título não pode ser vazio').optional(),
  meetingDate: z.coerce.date({ message: 'Data da reunião inválida' }).optional(),
  summary: z.string().trim().min(1, 'O resumo não pode ser vazio').optional(),
  actionItems: z.string().trim().nullable().optional(),
  externalLink: SafeOptionalExternalLinkSchema,
});
export type UpdateClientMeetingNoteRequest = z.infer<typeof UpdateClientMeetingNoteRequestSchema>;

/* ==========================================================================
   6. CLIENT TIMELINE EVENT (Feed Sanitizado do Ciclo de Vida)
   ========================================================================== */

export const ClientTimelineEventTypeSchema = z.enum([
  'CLIENT_CREATED',
  'DATA_UPDATED',
  'RESPONSIBLE_CHANGED',
  'TEAM_CHANGED',
  'MEETING_RECORDED',
  'INTEGRATION_CONNECTED',
  'INTEGRATION_DISCONNECTED',
]);
export type ClientTimelineEventType = z.infer<typeof ClientTimelineEventTypeSchema>;

export const ClientTimelineEventSchema = z.object({
  id: z.string().min(1),
  timestamp: IsoDateTimeSchema,
  type: ClientTimelineEventTypeSchema,
  title: z.string(),
  description: z.string(),
  actorName: z.string().nullable().optional(),
});
export type ClientTimelineEvent = z.infer<typeof ClientTimelineEventSchema>;

/* ==========================================================================
   7. DTO DA CARTEIRA DE CLIENTES (Mínimo Necessário / Protegido)
   REGRA DE SEGURANÇA: NÃO contém contractValue, document, notes, briefing,
   brandKit, payloads técnicos ou secrets.
   ========================================================================== */

export const ClientPortfolioItemSchema = z.object({
  id: ClientUuidSchema,
  name: z.string().min(1),
  legalName: z.string().nullable().optional(),
  status: ClientStatusSchema,
  responsibleUser: z
    .object({
      id: ClientUuidSchema,
      name: z.string(),
      email: z.string(),
      avatarUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  squads: z
    .array(
      z.object({
        id: ClientUuidSchema,
        name: z.string(),
      })
    )
    .default([]),
  startDate: IsoDateTimeSchema.nullable().optional(),
  activeIntegrationsCount: z.number().int().nonnegative().default(0),
  primaryContact: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClientPortfolioItem = z.infer<typeof ClientPortfolioItemSchema>;

/* ==========================================================================
   8. DTO DE DETALHE / CLIENTE 360 (Cockpit Estruturado)
   Campos sensíveis (document, contractValue) são condicionais por autorização.
   ========================================================================== */

export const ClientActiveIntegrationSummarySchema = z.object({
  id: ClientUuidSchema,
  provider: z.string(),
  status: z.string(),
  displayName: z.string().nullable().optional(),
  lastValidatedAt: IsoDateTimeSchema.nullable().optional(),
});
export type ClientActiveIntegrationSummary = z.infer<typeof ClientActiveIntegrationSummarySchema>;

export const ClientDetailSchema = z.object({
  id: ClientUuidSchema,
  organizationId: ClientUuidSchema,
  name: z.string().min(1),
  legalName: z.string().nullable().optional(),
  document: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: ClientStatusSchema,
  responsibleUserId: ClientUuidSchema.nullable().optional(),
  responsibleUser: z
    .object({
      id: ClientUuidSchema,
      name: z.string(),
      email: z.string(),
      avatarUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  squads: z
    .array(
      z.object({
        id: ClientUuidSchema,
        name: z.string(),
      })
    )
    .default([]),
  contractValue: z.number().nullable().optional(),
  startDate: IsoDateTimeSchema.nullable().optional(),
  endDate: IsoDateTimeSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  briefing: ClientBriefingSchema.nullable().optional(),
  brandKit: ClientBrandKitSchema.nullable().optional(),
  address: ClientAddressSchema.nullable().optional(),
  contacts: z.array(ClientContactSchema).default([]),
  meetingNotes: z.array(ClientMeetingNoteSchema).default([]),
  activeIntegrations: z.array(ClientActiveIntegrationSummarySchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClientDetail = z.infer<typeof ClientDetailSchema>;

/* ==========================================================================
   9. REQUEST SCHEMAS (Criação e Atualização)
   ========================================================================== */

export const CreateClientRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'O nome é obrigatório'),
    legalName: z.string().trim().optional(),
    document: z.string().trim().optional(),
    email: z
      .string()
      .trim()
      .email('Formato de e-mail inválido')
      .optional()
      .or(z.literal('')),
    phone: z.string().trim().optional(),
    status: ClientStatusSchema.default('ACTIVE'),
    responsibleUserId: ClientUuidSchema.optional(),
    contractValue: z
      .number({ message: 'O valor do contrato deve ser numérico' })
      .nonnegative('O valor do contrato não pode ser negativo')
      .optional(),
    startDate: z.coerce.date({ message: 'Data inicial inválida' }).optional(),
    endDate: z.coerce.date({ message: 'Data final inválida' }).optional(),
    notes: z.string().optional(),
    briefing: ClientBriefingSchema.optional(),
    brandKit: ClientBrandKitInputSchema.optional(),
    address: ClientAddressSchema.optional(),
    teamIds: z.array(ClientUuidSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'A data final deve ser posterior ou igual à data de início',
      path: ['endDate'],
    }
  );
export type CreateClientRequest = z.infer<typeof CreateClientRequestSchema>;

export const UpdateClientRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'O nome não pode ser vazio').optional(),
    legalName: z.string().trim().optional().nullable(),
    document: z.string().trim().optional().nullable(),
    email: z
      .string()
      .trim()
      .email('Formato de e-mail inválido')
      .optional()
      .nullable()
      .or(z.literal('')),
    phone: z.string().trim().optional().nullable(),
    status: ClientStatusSchema.optional(),
    responsibleUserId: ClientUuidSchema.optional().nullable(),
    contractValue: z
      .number({ message: 'O valor do contrato deve ser numérico' })
      .nonnegative('O valor do contrato não pode ser negativo')
      .optional()
      .nullable(),
    startDate: z.coerce.date({ message: 'Data inicial inválida' }).optional().nullable(),
    endDate: z.coerce.date({ message: 'Data final inválida' }).optional().nullable(),
    notes: z.string().optional().nullable(),
    briefing: ClientBriefingSchema.optional().nullable(),
    brandKit: ClientBrandKitInputSchema.optional().nullable(),
    address: ClientAddressSchema.optional().nullable(),
    teamIds: z.array(ClientUuidSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate >= data.startDate;
      }
      return true;
    },
    {
      message: 'A data final deve ser posterior ou igual à data de início',
      path: ['endDate'],
    }
  );
export type UpdateClientRequest = z.infer<typeof UpdateClientRequestSchema>;

/* ==========================================================================
   10. DTO DE RESULTADO DE MUTAÇÃO (Criação e Atualização)
   REGRA DE SEGURANÇA: MUTAÇÃO NÃO É LEITURA DETALHADA.
   NÃO devolve document, contractValue, legalName, briefing, brandKit, notes, etc.
   ========================================================================== */

export const ClientMutationResultSchema = z.object({
  id: ClientUuidSchema,
  name: z.string().min(1),
  status: ClientStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ClientMutationResult = z.infer<typeof ClientMutationResultSchema>;

