import { z } from 'zod';
import { IdSchema } from './http.js';

export const DashboardSourceLabelSchema = z.enum([
  'PROVIDER_DIRECT',
  'HUB_CALCULATED',
  'HUB_REGISTERED',
]);
export type DashboardSourceLabel = z.infer<typeof DashboardSourceLabelSchema>;

export const DashboardPeriodSchema = z.enum(['7d', '30d', '90d']);
export type DashboardPeriod = z.infer<typeof DashboardPeriodSchema>;

export const DashboardAdminQuerySchema = z.object({
  period: DashboardPeriodSchema.optional().default('30d'),
  clientId: IdSchema.optional(),
});
export type DashboardAdminQuery = z.infer<typeof DashboardAdminQuerySchema>;

export const ActiveClientsMetricSchema = z.object({
  count: z.number().int().nonnegative(),
  source: z.literal('HUB_REGISTERED'),
});
export type ActiveClientsMetric = z.infer<typeof ActiveClientsMetricSchema>;

export const MrrMetricAvailableSchema = z.object({
  available: z.literal(true),
  knownValue: z.number().nullable(),
  activeClientsCount: z.number().int().nonnegative(),
  missingContractValueCount: z.number().int().nonnegative(),
  isComplete: z.boolean(),
  source: z.literal('HUB_CALCULATED'),
});
export type MrrMetricAvailable = z.infer<typeof MrrMetricAvailableSchema>;

export const MrrMetricUnavailableSchema = z.object({
  available: z.literal(false),
  knownValue: z.null(),
  activeClientsCount: z.null(),
  missingContractValueCount: z.null(),
  isComplete: z.null(),
  reason: z.string(),
  source: z.literal('HUB_CALCULATED'),
});
export type MrrMetricUnavailable = z.infer<typeof MrrMetricUnavailableSchema>;

export const MrrMetricSchema = z.discriminatedUnion('available', [
  MrrMetricAvailableSchema,
  MrrMetricUnavailableSchema,
]);
export type MrrMetric = z.infer<typeof MrrMetricSchema>;

export const ClientsByStatusSchema = z.object({
  active: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  inactive: z.number().int().nonnegative(),
  lead: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  source: z.literal('HUB_CALCULATED'),
});
export type ClientsByStatus = z.infer<typeof ClientsByStatusSchema>;

export const DashboardFinancialSummaryAvailableSchema = z.object({
  available: z.literal(true),
  receivedInPeriod: z.number(),
  pending: z.number(),
  overdue: z.number(),
  overdueCount: z.number().int().nonnegative(),
  source: z.literal('PROVIDER_DIRECT'),
});
export type DashboardFinancialSummaryAvailable = z.infer<typeof DashboardFinancialSummaryAvailableSchema>;

export const DashboardFinancialSummaryUnavailableSchema = z.object({
  available: z.literal(false),
  receivedInPeriod: z.null(),
  pending: z.null(),
  overdue: z.null(),
  overdueCount: z.null(),
  reason: z.string(),
  source: z.literal('PROVIDER_DIRECT'),
});
export type DashboardFinancialSummaryUnavailable = z.infer<typeof DashboardFinancialSummaryUnavailableSchema>;

export const DashboardFinancialSummarySchema = z.discriminatedUnion('available', [
  DashboardFinancialSummaryAvailableSchema,
  DashboardFinancialSummaryUnavailableSchema,
]);
export type DashboardFinancialSummary = z.infer<typeof DashboardFinancialSummarySchema>;

export const DashboardAdminMetaSchema = z.object({
  period: DashboardPeriodSchema,
  clientId: IdSchema.nullable(),
  organizationId: IdSchema,
  generatedAt: z.string().datetime(),
});
export type DashboardAdminMeta = z.infer<typeof DashboardAdminMetaSchema>;

export const DashboardClientOptionSchema = z.object({
  id: IdSchema,
  name: z.string(),
});
export type DashboardClientOption = z.infer<typeof DashboardClientOptionSchema>;

export const DashboardAdminSummaryResponseSchema = z.object({
  activeClients: ActiveClientsMetricSchema,
  mrr: MrrMetricSchema,
  clientsByStatus: ClientsByStatusSchema,
  financial: DashboardFinancialSummarySchema,
  clientOptions: z.array(DashboardClientOptionSchema),
  meta: DashboardAdminMetaSchema,
});
export type DashboardAdminSummaryResponse = z.infer<typeof DashboardAdminSummaryResponseSchema>;
